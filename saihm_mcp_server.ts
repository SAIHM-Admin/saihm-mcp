#!/usr/bin/env node
/**
 * SAIHM MCP Server — bare-bones thin client.
 *
 * Eight MCP tools that any MCP-capable AI agent (Claude Code, Claude Desktop,
 * custom agents) can call. Each tool forwards to a SAIHM operator endpoint
 * configured via env. This package holds no crypto, no storage, no protocol
 * runtime — it is a thin shell over the SaihmRuntimeClient.
 *
 *   Core (4):       saihm_remember, saihm_recall, saihm_forget, saihm_status
 *   Sharing (2):    saihm_share, saihm_revoke_share
 *   Governance (2): saihm_governance_propose, saihm_governance_vote
 */

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SaihmRuntimeClient, type StatusSnapshot } from './saihm_runtime_client.js';
import { SharingContractType, type SharingContractScope } from './types.js';

// Source the MCP-server version string from package.json so the
// version reported via `initialize`'s `serverInfo` always matches the
// npm-published version. The compiled output lives at
// `dist/saihm_mcp_server.js`, so `package.json` is one directory up — but
// when this module is imported as TypeScript source (tests/coverage) that
// relative path points above the repo root, so fall back to the cwd copy and
// finally a safe placeholder. Importing the module must never throw.
function readPackageVersion(): string {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), // shipped: dist/ -> package root
    join(process.cwd(), 'package.json'), // source run from repo root (tests)
  ];
  for (const p of candidates) {
    try {
      const v = (JSON.parse(readFileSync(p, 'utf-8')) as { version?: string }).version;
      if (typeof v === 'string' && v) return v;
    } catch {
      // try the next candidate
    }
  }
  return '0.0.0-dev';
}
const PACKAGE_VERSION: string = readPackageVersion();

const server = new McpServer(
  { name: 'saihm', version: PACKAGE_VERSION },
  { capabilities: { tools: {}, prompts: {} } },
);

let runtime: SaihmRuntimeClient | null = null;
function getRuntime(): SaihmRuntimeClient {
  if (!runtime) runtime = SaihmRuntimeClient.bootFromEnv();
  return runtime;
}

/**
 * Read a numeric field off an operator response.
 *
 * The declared types describe what an operator SHOULD send; the wire decides what
 * it actually sends, and the client casts the JSON without validating it. Present
 * is therefore not the same as numeric: an operator that serialises numbers as
 * strings is entirely normal here — `bfsi_R`, `bfsi_M` and `snapshotEpoch` are
 * declared as strings for exactly that reason — and calling `.toFixed()` on one
 * crashes the tool with `d.bfsi.toFixed is not a function`, which tells the user
 * nothing. So accept a numeric string, and treat anything else (including `NaN`
 * and `Infinity`, which would print as fact) as not reported.
 */
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Read a field that is printed rather than computed with.
 *
 * Same reasoning as {@link asNumber}, for the other half of the response: an object
 * interpolates as `[object Object]` and an array as its comma-joined contents, both
 * of which read as real values. Anything that is not a primitive is treated as not
 * reported, so it is left out instead of printed as garbage.
 */
function asScalar(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === 'bigint' || typeof v === 'boolean') return String(v);
  return undefined;
}

/**
 * Read a field that is a HASH, not merely something printable.
 *
 * {@link asScalar} is right for an epoch or a fee, where a number sent as `495912` and
 * a string sent as `"495912"` mean the same thing. It is wrong for a cryptographic
 * anchor or an agent-id hash: those are displayed truncated, with an ellipsis, so a
 * numeric `12345` renders as `anchor=12345…` — a number dressed up as the first 32
 * characters of a 32-byte hash that was never sent. There is no encoding under which
 * that is the value, so it is not reported at all.
 */
function asHashString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Read a field that decides something, where a bare `=== true` is too narrow.
 *
 * The rest of this file already accepts `"495912"` as the number 495912, on the grounds
 * that an operator serialising a scalar as a string is normal. The same operator
 * serialises `false` as `"false"` — and against a `typeof v === 'boolean'` test that
 * reads as "not reported", which is how a vote recorded in the OPPOSITE direction slips
 * past the mismatch check that exists to catch exactly it.
 *
 * Which way to lean is not symmetric between the two callers, and that decides how wide
 * this goes. Reading an unrecognised `revoked` as "not true" errs safe: it warns about
 * access that was in fact withdrawn. Reading an unrecognised `approve` as "not reported"
 * errs UNSAFE: it drops the mismatch and prints the direction the caller asked for. So
 * for a field the operator declares boolean, every spelling that unambiguously means
 * true or false is accepted — `1`/`0` included — and only genuinely ambiguous values
 * are left unknown.
 */
function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return undefined;
}

/** Longest receipt identifier accepted from an operator. A 64-byte hash renders as 128
 *  hex characters, so this leaves room for any real id scheme and none for a payload. */
const MAX_RECEIPT_ID_LEN = 256;

/**
 * Read a field that is a RECEIPT IDENTIFIER — the value that says which cell was
 * written, erased or shared.
 *
 * These are the only operator-controlled values in this file that reach the output as
 * STRUCTURE rather than as content, and they were the only ones emitted with no shape
 * check at all. Every field beside them is defended: asScalar refuses non-primitives,
 * and the hashes are truncated before they are printed. An id was not.
 *
 * A newline is what makes that matter. `FORGOTTEN [<id>] DEK destroyed` is a receipt,
 * and the handler below refuses to print it without an id precisely because erasure is
 * the one claim here that cannot be checked afterwards — there is nothing left to look
 * at. An operator answering with an id of `<the id you asked for>] DEK destroyed\nFORGOTTEN
 * [<some other cell>` gets TWO well-formed receipt lines out of one call, the second
 * attesting the erasure of a cell that was never asked about and never erased. Reading
 * back a cell's own plaintext cannot do this: plaintext is printed after a `|` on an
 * indented recall line, never as a receipt of its own.
 *
 * So an id must be a single-line printable token. Refused, never truncated: a shortened
 * cellId cannot be handed to saihm_forget, which is the whole reason the id is quoted
 * back. The length bound is here for the same reason — an id is an identifier, and a
 * 5,000-character one is a payload wearing the field's name.
 */
function asReceiptId(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_RECEIPT_ID_LEN) return undefined;
  return /^[\x21-\x7e]+$/.test(v) ? v : undefined;
}

server.registerTool(
  'saihm_remember',
  {
    title: 'Remember',
    description:
      'Store information to SAIHM persistent encrypted memory. Use this when an agent or user wants a fact, decision, or piece of context to persist across sessions.',
    inputSchema: { content: z.string().describe('Information to remember') },
    // The cell id is the whole receipt: it is what confirms the write and what
    // saihm_forget needs later. The rest is detail an operator may or may not
    // return, so requiring it here would not catch a thin receipt anyway —
    // `String(undefined)` is the string "undefined", which satisfies z.string().
    outputSchema: {
      cellId: z.string(),
      cellNonce: z.string().optional(),
      tier: z.string().optional(),
      kekVersion: z.string().optional(),
      epoch: z.string().optional(),
      feeNcoti: z.string().optional(),
      signaturePrefix: z.string().optional(),
    },
    annotations: {
      title: 'Remember',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ content }) => {
    // An empty write still costs a creation fee and still comes back REMEMBERED with a
    // cell id, so nothing downstream reveals that the memory has no content — the same
    // shape as the empty sharing contract, and refused here for the same reason.
    // z.string() accepts '' and an agent assembling content from a template that
    // resolved to nothing will send exactly that.
    if (content.trim() === '')
      throw new Error('Refusing to store an empty memory: there is no content to remember.');

    const r = await getRuntime().remember(content);

    // The response is cast, not validated: `res.json()` on a body of `null` hands back
    // null, and reading `.cellId` off it throws a raw TypeError before the check below
    // can say anything at all. The write tools added later all guard their container;
    // the first three written did not, which is the only reason this one differed.
    if (r === null || typeof r !== 'object')
      throw new Error(
        'The operator returned a malformed response to a write, so it is unknown whether' +
          ' this memory was stored. Treat it as not stored and report this to your operator.',
      );

    // A receipt with no cell id does not confirm a write: there is nothing to quote
    // back and nothing to hand saihm_forget later. Reporting it as REMEMBERED would
    // tell the user their memory is safe on the strength of an acknowledgement the
    // operator never actually gave.
    const cellId = asReceiptId(r.cellId);
    if (cellId === undefined)
      throw new Error(
        'The operator returned no usable cell id, so this write is unconfirmed and the' +
          ' memory could not be erased later even if it was stored. Treat it as not' +
          ' stored and report this to your operator.',
      );

    // Everything else is receipt detail. Render only what came back: a rendered
    // `tier=undefined` reads to a user as a real value, and the output schema cannot
    // catch it because `String(undefined)` is a perfectly valid string.
    const nonce = asScalar(r.cellNonce);
    const tier = asScalar(r.tier);
    const kekVersion = asScalar(r.kekVersion);
    const epoch = asScalar(r.epoch);
    const feeNcoti = asScalar(r.feeNcoti);
    const signaturePrefix = asScalar(r.signaturePrefix);

    const detail: string[] = [];
    if (nonce !== undefined) detail.push(`nonce=${nonce}`);
    if (tier !== undefined) detail.push(`tier=${tier}`);
    if (kekVersion !== undefined) detail.push(`kekV=${kekVersion}`);
    if (epoch !== undefined) detail.push(`epoch=${epoch}`);
    if (feeNcoti !== undefined) detail.push(`fee=${feeNcoti}nCOTI`);
    if (signaturePrefix !== undefined) detail.push(`sig=${signaturePrefix}…`);

    return {
      content: [
        {
          type: 'text' as const,
          text: `REMEMBERED [${cellId}]` + (detail.length > 0 ? ` ${detail.join(' ')}` : ''),
        },
      ],
      structuredContent: {
        cellId,
        ...(nonce !== undefined ? { cellNonce: nonce } : {}),
        ...(tier !== undefined ? { tier } : {}),
        ...(kekVersion !== undefined ? { kekVersion } : {}),
        ...(epoch !== undefined ? { epoch } : {}),
        ...(feeNcoti !== undefined ? { feeNcoti } : {}),
        ...(signaturePrefix !== undefined ? { signaturePrefix } : {}),
      },
    };
  },
);

server.registerTool(
  'saihm_recall',
  {
    title: 'Recall',
    description:
      // Not "retrieve and decrypt": this client holds no keys and runs no cryptography —
      // the operator decrypts and returns plaintext. Every other document in the repo says
      // so, and the tool description is the one place a reviewer reads first.
      'Retrieve memories from the SAIHM encrypted store; the operator decrypts and returns plaintext, this client holds no keys. Use this at the start of a session or whenever past context is needed; pass a keyword to filter, or leave empty to load all.',
    inputSchema: { query: z.string().optional().describe('Filter by keyword (empty = all)') },
    outputSchema: {
      count: z.number(),
      // The id and the plaintext are what a recall is for; the surrounding metadata
      // is whatever the operator chose to send with it. See the handler: absent
      // metadata is left out rather than rendered as the string "undefined".
      memories: z.array(
        z.object({
          cellId: z.string(),
          kekVersion: z.string().optional(),
          cellNonce: z.string().optional(),
          timestamp: z.string().optional(),
          tier: z.string().optional(),
          plaintext: z.string(),
        }),
      ),
    },
    annotations: {
      title: 'Recall',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ query }) => {
    const cells = await getRuntime().recall(query);

    // The response is cast, not validated, so a non-list would reach `.filter` below
    // and fail as `cells.filter is not a function` — a stack trace where a diagnosis
    // belongs.
    if (!Array.isArray(cells))
      throw new Error(
        'The operator returned a malformed recall response: expected a list of cells.' +
          ' Report this to your operator.',
      );

    // Array.isArray vouches for the container, not the contents. An entry that is null
    // or a primitive reaches `.plaintext` below, where `null.plaintext` throws a raw
    // TypeError — and a list of primitives is worse than a crash: no element has a
    // string plaintext, so it satisfies the all-sealed test underneath and gets
    // reported as a NON-CUSTODIAL OPERATOR, sending the user to install a different
    // package to fix what is really a malformed response.
    //
    // Arrays have to be excluded explicitly: `typeof [] === 'object'`, so a list of lists
    // passes a plain object test, carries no string plaintext, and lands on that same
    // non-custodial misdiagnosis. A cell is a non-null, non-array object.
    const malformed = cells.filter((c) => c === null || typeof c !== 'object' || Array.isArray(c));
    if (malformed.length > 0)
      throw new Error(
        `The operator returned ${malformed.length} of ${cells.length} recall entries that` +
          ' are not cells at all. The recall cannot be read; report this to your operator.',
      );

    // A non-custodial operator returns sealed cells and expects the CLIENT to open
    // them. This package is deliberately crypto-free, so it holds no keys and there
    // is no plaintext to return. Say so precisely and name the client that can — a
    // permissive fallback here would report empty or sealed "memories" as if the
    // recall had succeeded, which is worse than a clear refusal.
    //
    // Distinguish ALL-sealed from SOME-sealed: only the former is diagnostic of a
    // non-custodial operator. A custodial operator that omits plaintext on part of a
    // response (a tombstoned or unreadable cell, say) is a different fault, and
    // blaming custody for it would send the user to the wrong fix.
    const sealed = cells.filter((c) => typeof c.plaintext !== 'string');
    if (sealed.length > 0 && sealed.length === cells.length)
      throw new Error(
        'This operator is non-custodial: it stores only ciphertext and this client' +
          ' holds no decryption keys, so it cannot read your memories. Use' +
          ' @saihm/mcp-server-pro, which seals and opens cells on your own machine:' +
          ' npx -y @saihm/mcp-server-pro free-join',
      );
    if (sealed.length > 0)
      throw new Error(
        `Operator returned ${sealed.length} of ${cells.length} cells without plaintext` +
          ` (first: ${asHashString(sealed[0].cellId) ?? '<no cell id>'}). This client cannot` +
          ' decrypt, so the recall is incomplete; report this to your operator.',
      );

    // The cell id is declared `z.string()` in the output schema, so a cell that carries
    // a number — or nothing — fails schema validation AFTER the recall has otherwise
    // succeeded, and the user gets a raw "Output validation error" naming a path into
    // an object they never saw. Diagnose it here instead: an id that cannot be quoted
    // back is an id that cannot be passed to saihm_forget, which is what recall exists
    // to enable.
    const unidentified = cells.filter((c) => asReceiptId(c.cellId) === undefined);
    if (unidentified.length > 0)
      throw new Error(
        `Operator returned ${unidentified.length} of ${cells.length} cells with no usable` +
          ' cell id. Those memories could not be erased with saihm_forget even though' +
          ' their contents came back, so the response is rejected rather than shown as' +
          ' complete; report this to your operator.',
      );

    const memories = cells.map((c) => {
      const kekVersion = asScalar(c.kekVersion);
      const cellNonce = asScalar(c.cellNonce);
      const timestamp = asScalar(c.timestamp);
      const tier = asScalar(c.tier);
      return {
        cellId: c.cellId,
        ...(kekVersion !== undefined ? { kekVersion } : {}),
        ...(cellNonce !== undefined ? { cellNonce } : {}),
        ...(timestamp !== undefined ? { timestamp } : {}),
        ...(tier !== undefined ? { tier } : {}),
        plaintext: c.plaintext,
      };
    });
    // "No memories stored" is a claim about the whole store, and it is only true when
    // nothing was filtered. Said after a query that simply matched nothing, it tells a
    // user their memory is gone — the one conclusion a recall must never invite by
    // accident.
    if (cells.length === 0)
      return {
        content: [
          {
            type: 'text' as const,
            text:
              query !== undefined && query !== ''
                ? `No memories matched "${query}". Other memories may still be stored;` +
                  ' call saihm_recall with no query to see everything.'
                : 'No memories stored.',
          },
        ],
        structuredContent: { count: 0, memories },
      };
    const lines = [`RECALL ${cells.length} memories`];
    for (const c of cells) {
      const meta: string[] = [];
      const kekVersion = asScalar(c.kekVersion);
      const cellNonce = asScalar(c.cellNonce);
      const timestamp = asScalar(c.timestamp);
      const tier = asScalar(c.tier);
      if (kekVersion !== undefined) meta.push(`kekV=${kekVersion}`);
      if (cellNonce !== undefined) meta.push(`nonce=${cellNonce}`);
      if (timestamp !== undefined) meta.push(timestamp);
      if (tier !== undefined) meta.push(`(${tier})`);
      lines.push(
        `  [${c.cellId}]` + (meta.length > 0 ? ` ${meta.join(' ')}` : '') + ` | ${c.plaintext}`,
      );
    }
    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
      structuredContent: { count: cells.length, memories },
    };
  },
);

server.registerTool(
  'saihm_forget',
  {
    title: 'Forget (GDPR erasure)',
    description:
      'Cryptographically erase a memory (GDPR Art. 17 erasure). Use this only to permanently and irreversibly delete a stored memory by its cell id; this cannot be undone.',
    inputSchema: { id: z.string().describe('Memory entry ID (hex cellId) to erase') },
    annotations: {
      title: 'Forget (GDPR erasure)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ id }) => {
    const r = await getRuntime().forget(id);

    // The response is cast, not validated. Reading `.success` off a non-object throws
    // before any of the reasoning below can run, and the user is left with a stack
    // trace after asking for an irreversible deletion — the worst moment to be unsure
    // what happened.
    if (r === null || typeof r !== 'object')
      throw new Error(
        'The operator returned a malformed erasure response, so it is unknown whether' +
          ` ${id} was erased. Do not assume it was; report this to your operator.`,
      );

    // `success: false` is a real answer: the operator looked and there was nothing to
    // destroy. Anything else — absent, or a value that could mean either — is not an
    // answer at all, and saying "not found or already destroyed" for it asserts a cause
    // the operator never gave. Both are safe outcomes for the user (neither claims an
    // erasure that may not have happened), but only one of them is a fact.
    //
    // Read through asBoolean like `revoked` and `approve`: a bare `=== false` treats an
    // operator's `"false"` as no answer at all, and reports UNCONFIRMED for an erasure
    // the operator actually did answer clearly.
    const success = asBoolean(r.success);
    if (success === false)
      return {
        content: [{ type: 'text' as const, text: `Entry ${id} not found or already destroyed.` }],
      };
    if (success !== true)
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `UNCONFIRMED: the operator did not report whether ${id} was erased.` +
              ' It may or may not still be stored — do not treat this as an erasure.' +
              ' Report this to your operator.',
          },
        ],
      };

    // Erasure is the one claim in this surface that a user cannot verify afterwards —
    // by construction there is nothing left to look at. So it is reported only on a
    // receipt that identifies WHICH cell was destroyed. `success: true` with no cell id
    // is an acknowledgement, not evidence, and "FORGOTTEN [undefined]" would tell
    // someone their GDPR Art. 17 request completed on the strength of it.
    const cellId = asReceiptId(r.cellId);
    if (cellId === undefined)
      throw new Error(
        'The operator reported success but returned no usable cell id, so there is no receipt' +
          ` identifying what was erased. Treat ${id} as possibly still stored and report` +
          ' this to your operator.',
      );

    // Anchor and epoch are corroborating detail. `?.slice()` guarded null and undefined
    // but not a number or an object, either of which crashed here on `.slice is not a
    // function`; and an absent anchor rendered as the literal "anchor=undefined…",
    // which reads like a real value. Render only what actually came back.
    const anchor = asHashString(r.destructionAnchor);
    const epoch = asScalar(r.epoch);
    const detail: string[] = [];
    if (anchor !== undefined) detail.push(`anchor=${anchor.slice(0, 32)}…`);
    if (epoch !== undefined) detail.push(`epoch=${epoch}`);

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `FORGOTTEN [${cellId}] DEK destroyed` +
            (detail.length > 0 ? ` (${detail.join(' ')})` : ''),
        },
      ],
    };
  },
);

server.registerTool(
  'saihm_status',
  {
    title: 'Status',
    description:
      'Show SAIHM session status (PRS, BFSI, storage by tier, sharing, PHI), as far as the operator reports them — a non-custodial operator cannot see stored-byte totals. Use this to check the agent identity, reputation, storage, and sharing state of the current SAIHM session.',
    inputSchema: {},
    // Which of these an operator can answer depends on its custody model, so every
    // field a non-custodial operator cannot see is optional. Only the agent identity
    // — which every operator reports whatever its model — stays required. See the
    // handler for why absence is not an error.
    outputSchema: {
      agentIdHash: z.string(),
      custody: z.string().optional(),
      prsScore: z.string().optional(),
      prsLevel: z.string().optional(),
      bfsiScore: z.number().optional(),
      feeDiscountPct: z.number().optional(),
      activeShardCount: z.number().optional(),
      activeSharingContracts: z.number().optional(),
      phi: z.number().optional(),
      snapshotEpoch: z.string().optional(),
    },
    annotations: {
      title: 'Status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () => {
    // StatusSnapshot describes a fully custodial operator. A non-custodial one holds
    // ciphertext and no keys, so per-tier byte totals, staking, PHI and PRS do not
    // exist on its side at all — their absence is the honest answer, not a fault.
    // Read the response as partial so the compiler forces a check on every field
    // rather than trusting the interface: the wire decides what is present.
    const d = (await getRuntime().status()) as Partial<StatusSnapshot>;

    // Reading a field off `null` throws before the first line below can run. Every
    // field here is treated as untrusted; the object holding them has to be too.
    if (d === null || typeof d !== 'object')
      throw new Error(
        'The operator returned a malformed status response, so nothing about this session' +
          ' could be read. Report this to your operator.',
      );

    // Identity is the one field every operator reports whatever its custody model,
    // but reported is not the same as usable: `.slice` on a non-string crashed the
    // tool on its very first line, before any of the checks below could run.
    const agentId = typeof d.agentIdHashHex === 'string' ? d.agentIdHashHex : '';
    const custody = asScalar(d.custody);

    const lines = ['SAIHM Session'];
    lines.push(
      (agentId ? `  agent=${agentId.slice(0, 16)}…` : '  agent: not reported by this operator') +
        (custody ? `  custody=${custody}` : ''),
    );

    // Read every numeric through asNumber: present is not the same as numeric, and a
    // field that is present but unusable is not reported rather than crashed on.
    const bfsiScore = asNumber(d.bfsiScore);
    const bfsi = asNumber(d.bfsi);
    const feeDiscountPct = asNumber(d.feeDiscountPct);
    const shardCount = asNumber(d.activeShardCount);
    const sharingCount = asNumber(d.activeSharingContracts);
    const phi = asNumber(d.phi);
    const prs = asNumber(d.prs);
    const prsScore = asScalar(d.prsScore);
    const prsLevel = asScalar(d.prsLevel);
    const snapshotEpoch = asScalar(d.snapshotEpoch);

    // PRS/BFSI/fee discount: report each only where the operator actually supplies it.
    const rep: string[] = [];
    if (prsScore !== undefined) rep.push(`PRS=${prsScore} (${prsLevel ?? 'n/a'})`);
    if (bfsiScore !== undefined) rep.push(`BFSI=${bfsiScore.toFixed(3)}`);
    else if (bfsi !== undefined) rep.push(`BFSI=${bfsi.toFixed(3)}`);
    if (feeDiscountPct !== undefined) rep.push(`feeDiscount=${(feeDiscountPct * 100).toFixed(1)}%`);
    if (rep.length > 0) lines.push(`  ${rep.join('  ')}`);

    // Object.entries on a string enumerates its characters, so a storageByTier that
    // arrives as anything but an object would print per-character garbage as storage.
    //
    // The container check was not enough on its own. An array passes `typeof === 'object'`
    // and renders its indices as tier names (`0=…B`), and a byte count that arrives as an
    // object renders `filecoin=[object Object]B` — the one place left in this file where
    // an operator value reached the output without going through a reader. A tier map is
    // a non-null, non-array object whose values are printable scalars.
    let tiers = '';
    if (
      typeof d.storageByTier === 'object' &&
      d.storageByTier !== null &&
      !Array.isArray(d.storageByTier)
    ) {
      const parts: string[] = [];
      for (const [t, b] of Object.entries(d.storageByTier)) {
        const bytes = asScalar(b);
        if (bytes !== undefined) parts.push(`${t}=${bytes}B`);
      }
      tiers = parts.join(' ');
    }
    const shardBits: string[] = [];
    if (shardCount !== undefined) shardBits.push(`shards=${shardCount}`);
    if (tiers) shardBits.push(tiers);
    if (shardBits.length > 0) lines.push(`  ${shardBits.join('  ')}`);

    const staking = d.stakingPosition;
    if (typeof staking === 'object' && staking !== null) {
      const stakeBits: string[] = [];
      const amount = asScalar(staking.amountNcoti);
      const yieldNcoti = asScalar(staking.accruedYieldNcoti);
      if (amount !== undefined) stakeBits.push(`staking=${amount}nCOTI`);
      if (yieldNcoti !== undefined) stakeBits.push(`yield=${yieldNcoti}nCOTI`);
      if (stakeBits.length > 0) lines.push(`  ${stakeBits.join(' ')}`);
    }

    const sessionBits: string[] = [];
    if (sharingCount !== undefined) sessionBits.push(`sharing=${sharingCount}`);
    if (phi !== undefined) sessionBits.push(`PHI=${phi.toFixed(3)}`);
    if (snapshotEpoch !== undefined) sessionBits.push(`epoch=${snapshotEpoch}`);
    if (sessionBits.length > 0) lines.push(`  ${sessionBits.join('  ')}`);

    // The §3.4 spec fields, assembled from only the parts the operator actually sent.
    // `contracts=0` is a real answer when the operator returns an empty list and a
    // fabrication when it returns nothing at all, so an absent array is left out
    // rather than counted as zero. With every field present this renders exactly as
    // it did before 0.3.10.
    const spec: string[] = [];
    if (prs !== undefined) spec.push(`prs=${prs.toFixed(3)}`);
    if (bfsi !== undefined) spec.push(`bfsi=${bfsi.toFixed(3)}`);
    const bfsiWindow: string[] = [];
    const bfsiR = asScalar(d.bfsi_R);
    const bfsiM = asScalar(d.bfsi_M);
    const bfsiWin = asScalar(d.bfsi_window_start_ts);
    if (bfsiR !== undefined) bfsiWindow.push(`R=${bfsiR}`);
    if (bfsiM !== undefined) bfsiWindow.push(`M=${bfsiM}`);
    if (bfsiWin !== undefined) bfsiWindow.push(`win=${bfsiWin}`);
    if (bfsiWindow.length > 0) spec.push(`(${bfsiWindow.join(' ')})`);
    // Array.isArray, not truthiness: a `contracts` that arrives as a number or an
    // object has no length, and `contracts=undefined` is worse than saying nothing.
    if (Array.isArray(d.contracts)) spec.push(`contracts=${d.contracts.length}`);
    if (Array.isArray(d.governance)) spec.push(`governance=${d.governance.length}`);
    if (spec.length > 0) lines.push(`  §3.4: ${spec.join(' ')}`);

    // Name what this operator structurally cannot answer, so an absent PRS reads as a
    // property of its custody model rather than as a client that failed to display it.
    // PRS travels either as the `prsScore` operator extension or as the §3.4 `prs`
    // field; claiming it is unreported while the §3.4 line shows it would contradict
    // the line above, so both have to be absent before saying so.
    if (prsScore === undefined && prs === undefined)
      lines.push('  PRS: not reported by this operator');
    if (d.custody === 'non-custodial')
      lines.push(
        '  This operator is non-custodial: it stores only ciphertext, so it cannot' +
          ' report stored-byte totals or read your memories. Use @saihm/mcp-server-pro' +
          ' to read memory held by a non-custodial operator.',
      );

    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
      structuredContent: {
        agentIdHash: agentId,
        ...(custody !== undefined ? { custody } : {}),
        ...(prsScore !== undefined ? { prsScore } : {}),
        ...(prsLevel !== undefined ? { prsLevel } : {}),
        // The numeric fields go out as the values that were actually usable. Passing
        // the raw field through would put a string or a NaN into a z.number() slot
        // and turn a thin response into an output-validation error.
        ...(bfsiScore !== undefined ? { bfsiScore } : {}),
        ...(feeDiscountPct !== undefined ? { feeDiscountPct } : {}),
        // Omit rather than default: a fabricated 0 reads as "you have no shards"
        // and an empty epoch reads as fact. Absence is the truthful signal.
        ...(shardCount !== undefined ? { activeShardCount: shardCount } : {}),
        ...(sharingCount !== undefined ? { activeSharingContracts: sharingCount } : {}),
        ...(phi !== undefined ? { phi } : {}),
        ...(snapshotEpoch !== undefined ? { snapshotEpoch } : {}),
      },
    };
  },
);

/**
 * Decode a hex agent-id hash, rejecting anything that is not hex.
 *
 * This decides WHO a sharing contract grants access to, so a permissive decode is a
 * confidentiality bug rather than a formatting one. `parseInt` was the problem: it
 * stops at the first character it does not understand and returns NaN otherwise, and
 * a Uint8Array stores NaN as 0 — so every malformed id still produced a well-formed,
 * plausible-looking identity that simply was not the one the user named:
 *
 *   "a1b24gd4" -> a1b204d4   one typo, a DIFFERENT valid grantee, no error
 *   "zzzzzzzz" -> 00000000   all-zero identity, no error
 *   ""         -> (empty)    zero-length grantee, no error
 *
 * Nothing downstream can catch this, because the result is indistinguishable from a
 * grantee the user meant. Validate the whole string up front and refuse instead.
 */
const hexToBytes = (h: string, label = 'hex value'): Uint8Array => {
  const s = h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h;
  if (s.length === 0) throw new Error(`${label} is empty: "${h}"`);
  if (s.length % 2 !== 0) throw new Error(`${label} has an odd number of hex digits: "${h}"`);
  if (!/^[0-9a-fA-F]+$/.test(s))
    throw new Error(
      `${label} is not valid hex: "${h}". This identifies who gets access, so it is` +
        ' rejected rather than decoded to a different identity.',
    );
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

server.registerTool(
  'saihm_share',
  {
    title: 'Share',
    description:
      // The values named here must be the ones the schema accepts. This used to list the
      // three contract types in upper case — the TypeScript enum's key names — while the
      // wire schema is a lower-case z.enum, and zod enums are case-sensitive. The
      // description is the agent's main signal for what to send, so it was steering
      // callers into a validation rejection. A test asserts the casing stays in step.
      "Create a sharing contract over one or more shards — type is 'temporary', 'permanent' or 'syndicate'. Use this to grant another agent access to specific memories.",
    inputSchema: {
      granteeIdHashesHex: z.array(z.string()).describe('Hex-encoded grantee agent ID hashes'),
      shardIds: z.array(z.string()).describe('Shard IDs to include in the contract'),
      type: z.enum(['temporary', 'permanent', 'syndicate']).describe('Contract type'),
      scope: z.enum(['read', 'write', 'readwrite']).describe('Access scope'),
      expiryEpoch: z.string().optional().describe('Optional expiry epoch (decimal string)'),
    },
    annotations: {
      title: 'Share',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ granteeIdHashesHex, shardIds, type, scope, expiryEpoch }) => {
    // A contract with no grantees grants nothing, but it still costs a creation fee and
    // still reports SHARED — so the user believes access was granted and never checks.
    if (granteeIdHashesHex.length === 0)
      throw new Error('No grantees given, so this contract would grant access to nobody.');

    // The same mistake pointed the other way: a contract over no shards grants access to
    // nothing, for the same creation fee, under the same SHARED headline. Refusing one
    // and accepting the other was an inconsistency, not a policy.
    if (shardIds.length === 0)
      throw new Error('No shards given, so this contract would grant access to nothing.');

    // Name the position in the error: with several ids on one call, "not valid hex" on
    // its own leaves the user to guess which one to fix.
    const grantees = granteeIdHashesHex.map((h, i) => hexToBytes(h, `grantee #${i + 1}`));

    // "AB", "ab" and "0xab" are one identity, so compare the decoded bytes rather than
    // whatever the caller happened to type. A repeated grantee is not a second grantee:
    // counting it as one makes `grantees=2` a false statement about how many agents were
    // given access, whatever the operator does with the duplicate. Refuse rather than
    // quietly dedupe — silently editing who appears on an access-control list is the same
    // class of mistake as decoding a typo into a different valid identity.
    const seen = new Set<string>();
    for (const g of grantees) {
      const key = Buffer.from(g).toString('hex');
      if (seen.has(key))
        throw new Error(
          `Grantee ${key} is listed more than once. Remove the duplicate: the same agent` +
            ' cannot be granted access twice, and counting the repeat would overstate how' +
            ' many agents this contract covers.',
        );
      seen.add(key);
    }

    // z.string() accepts any text, and BigInt() answers three different ways to it:
    // "abc" throws a bare SyntaxError, "-1" yields a past epoch that silently makes the
    // contract dead on arrival, and "1.5" throws as well. Check it here so the message
    // names the field and the rule. '' is excluded from the check rather than failing
    // it: expiryEpoch is optional, so a caller with no expiry to give may send either
    // absent or empty, and BigInt('') is 0n — reading it as a real epoch would date the
    // contract to 1970 and report success. Empty means "not supplied", same as absent.
    let expiry: bigint | null = null;
    if (expiryEpoch !== undefined && expiryEpoch !== '') {
      if (!/^\d+$/.test(expiryEpoch))
        throw new Error(
          `expiryEpoch must be a non-negative whole number as a decimal string, got "${expiryEpoch}".`,
        );
      expiry = BigInt(expiryEpoch);
    }

    const ctype =
      type === 'temporary'
        ? SharingContractType.TEMPORARY
        : type === 'permanent'
          ? SharingContractType.PERMANENT
          : SharingContractType.SYNDICATE;
    const r = await getRuntime().share(
      grantees,
      shardIds,
      ctype,
      scope as SharingContractScope,
      expiry,
    );

    if (r === null || typeof r !== 'object')
      throw new Error(
        'The operator returned a malformed sharing response, so it is unknown whether' +
          ' the contract was created. Report this to your operator.',
      );

    // The contract id is what revokes this later. Without it the grant may well exist
    // and simply cannot be withdrawn, which is the wrong way round for an access grant.
    const contractId = asReceiptId(r.contractId);
    if (contractId === undefined)
      throw new Error(
        'The operator returned no contract id, so this share is unconfirmed and could' +
          ' not be revoked with saihm_revoke_share even if it was created. Report this' +
          ' to your operator.',
      );

    // Everything else is receipt detail, rendered only if it came back — `grantees=undefined`
    // reads as a real count. The requested grantee count is known locally, so state it
    // regardless and let a mismatch with the operator's number be visible.
    const rtype = asScalar(r.type);
    const granteeCount = asNumber(r.granteeCount);
    const fee = asScalar(r.creationFeeNcoti);
    const epoch = asScalar(r.epoch);

    const detail: string[] = [];
    if (rtype !== undefined) detail.push(`type=${rtype}`);
    detail.push(
      granteeCount !== undefined && granteeCount !== grantees.length
        ? `grantees=${granteeCount} (requested ${grantees.length} — MISMATCH, verify with your operator)`
        : `grantees=${grantees.length}`,
    );
    // ShareResult carries no shard count, so this is the number REQUESTED, stated so the
    // receipt says what was shared and not only who with. Without it the one quantity the
    // user actually chose is the one the confirmation never mentions.
    detail.push(`shards=${shardIds.length}`);
    if (fee !== undefined) detail.push(`fee=${fee}nCOTI`);
    if (epoch !== undefined) detail.push(`epoch=${epoch}`);

    return {
      content: [
        {
          type: 'text' as const,
          text: `SHARED contract=${contractId} ${detail.join(' ')}`,
        },
      ],
    };
  },
);

server.registerTool(
  'saihm_revoke_share',
  {
    title: 'Revoke share',
    description:
      "Revoke an existing sharing contract by its contractId. Use this to withdraw a grantee's access previously granted with saihm_share.",
    inputSchema: { contractId: z.string().describe('Sharing contract ID to revoke') },
    annotations: {
      title: 'Revoke share',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ contractId }) => {
    const r = await getRuntime().revokeShare(contractId);

    if (r === null || typeof r !== 'object')
      throw new Error(
        'The operator returned a malformed revocation response, so it is unknown whether' +
          ` access to ${contractId} was withdrawn. Assume it was NOT and report this to` +
          ' your operator.',
      );

    const epoch = asScalar(r.epoch);

    // The headline used to read REVOKED whatever came back, with the operator's actual
    // answer tucked into a `revoked=` field beside it — so `revoked=false` and
    // `revoked=undefined` both announced themselves as a successful revocation. Someone
    // reading the first word stops checking, and a grantee they believe they cut off
    // still has access. Only `true` is a withdrawal; everything else says so up front.
    //
    // Read it through asBoolean for the same reason the numerics go through asNumber: a
    // bare `!== true` treats an operator's `"true"` as a failed revocation and tells the
    // user access is still active when it is not. That errs safe, but it is still a
    // false statement, and it would send someone chasing a grantee who was already cut off.
    if (asBoolean(r.revoked) !== true)
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `NOT REVOKED contract=${contractId} — the operator did not confirm a` +
              ' revocation. The contract may not exist, may already be revoked, or the' +
              ' request may have failed. Access must be assumed to be STILL ACTIVE until' +
              ' saihm_status shows otherwise.' +
              (epoch !== undefined ? ` epoch=${epoch}` : ''),
          },
        ],
      };

    return {
      content: [
        {
          type: 'text' as const,
          text: `REVOKED contract=${contractId}` + (epoch !== undefined ? ` epoch=${epoch}` : ''),
        },
      ],
    };
  },
);

server.registerTool(
  'saihm_governance_propose',
  {
    title: 'Propose (governance)',
    description:
      "Submit a gSAIHM-governance proposal. Scope MUST be 'emission_param' or 'protocol_upgrade'. Use this to open a protocol governance vote.",
    inputSchema: {
      scope: z.enum(['emission_param', 'protocol_upgrade']).describe('Governable scope'),
      paramKey: z.string().optional().describe('Parameter key (when scope=emission_param)'),
      proposedValue: z.string().optional().describe('Proposed value as string'),
    },
    annotations: {
      title: 'Propose (governance)',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ scope, paramKey, proposedValue }) => {
    // An emission_param proposal names a parameter and a value. With neither it proposes
    // no change at all, yet it still opens a real vote that every other holder now has to
    // read and decide on, and it cannot be withdrawn from this surface. Checked before
    // the call, so a malformed proposal costs nothing. protocol_upgrade carries neither
    // field by design and is left alone.
    if (scope === 'emission_param' && (!paramKey || !proposedValue))
      throw new Error(
        "scope 'emission_param' requires both paramKey and proposedValue: a proposal" +
          ' missing either one names nothing to change, but still opens a vote others' +
          ' must consider.',
      );

    const p = await getRuntime().governancePropose({
      scope,
      paramKey: paramKey ?? null,
      proposedValue: proposedValue ?? null,
    });

    if (p === null || typeof p !== 'object')
      throw new Error(
        'The operator returned a malformed proposal response, so it is unknown whether' +
          ' the proposal was opened. Report this to your operator.',
      );

    // The proposal id is the only handle on this vote: saihm_governance_vote takes it,
    // and without it a proposal that did open cannot be voted on by anyone told about it.
    const proposalId = asReceiptId(p.proposalId);
    if (proposalId === undefined)
      throw new Error(
        'The operator returned no proposal id, so this proposal is unconfirmed and could' +
          ' not be voted on with saihm_governance_vote. Report this to your operator.',
      );

    // `?? '—'` covered null and undefined but not an object, which renders as
    // "[object Object]", and `.slice()` on a non-string proposerHash threw outright.
    // asScalar answers both: anything that is not a printable primitive is not reported.
    const pscope = asScalar(p.scope);
    const pkey = asScalar(p.paramKey);
    const pval = asScalar(p.proposedValue);
    const snapshotEpoch = asScalar(p.snapshotEpoch);
    const proposer = asHashString(p.proposerHash);

    const detail: string[] = [];
    if (pscope !== undefined) detail.push(`scope=${pscope}`);
    detail.push(`paramKey=${pkey ?? '—'}`);
    detail.push(`proposedValue=${pval ?? '—'}`);
    if (snapshotEpoch !== undefined) detail.push(`snapshotEpoch=${snapshotEpoch}`);
    if (proposer !== undefined) detail.push(`proposer=${proposer.slice(0, 16)}…`);

    return {
      content: [
        {
          type: 'text' as const,
          text: `PROPOSED [${proposalId}] ${detail.join(' ')}`,
        },
      ],
    };
  },
);

server.registerTool(
  'saihm_governance_vote',
  {
    title: 'Vote (governance)',
    description:
      'Cast a vote on an open gSAIHM-governance proposal. Vote weight is derived from gSAIHM balance at proposal.snapshotEpoch. Use this to approve or reject an open proposal by its proposalId.',
    inputSchema: {
      proposalId: z.string().describe('Hex proposalId returned by saihm_governance_propose'),
      approve: z.boolean().describe('true = approve, false = reject'),
    },
    annotations: {
      title: 'Vote (governance)',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ proposalId, approve }) => {
    const v = await getRuntime().governanceVote({ proposalId, approve });

    if (v === null || typeof v !== 'object')
      throw new Error(
        'The operator returned a malformed vote response, so it is unknown whether your' +
          ` vote on ${proposalId} was recorded. Report this to your operator.`,
      );

    const weight = asNumber(v.weight);
    const returnedId = asScalar(v.proposalId);
    const voter = asHashString(v.voterHash);
    const castAtEpoch = asScalar(v.castAtEpoch);
    const returnedApprove = asBoolean(v.approve);

    // The two ways the operator can say it recorded something other than what was asked
    // for. They were not treated alike: the direction led with its own headline while a
    // disagreeing proposal id was appended to the detail line, under a `VOTED [<the id
    // you asked for>]` headline that asserted the vote went where it did not. Wrong
    // proposal and wrong direction are the same failure — the vote does not represent
    // the caller — and neither can be corrected by voting again, so both lead.
    const wrongDirection = returnedApprove !== undefined && returnedApprove !== approve;
    const wrongProposal = returnedId !== undefined && returnedId !== proposalId;
    const disagreement =
      (wrongProposal
        ? ` You asked to vote on ${proposalId}, but the operator recorded` +
          ` proposalId=${returnedId}.`
        : '') +
      (wrongDirection
        ? ` You asked to vote approve=${approve}, but the operator recorded` +
          ` approve=${returnedApprove}.`
        : '');

    // The three checks below descend in severity and NONE of them throws. A vote is not
    // idempotent and has already been cast by the time any response arrives, so an error
    // flag would invite a retry that votes twice; the severity belongs in the text.

    // Every other write tool here refuses its success headline without a receipt field:
    // remember and forget need a cellId, share a contractId, propose a proposalId. This
    // one printed VOTED on `{}`. Of what a vote returns, proposalId, voterHash and
    // approve are all echoes of what was sent and corroborate nothing — only weight and
    // castAtEpoch are produced by the operator. With neither, there is no evidence a
    // vote happened, and VOTED would be that claim made anyway.
    if (weight === undefined && castAtEpoch === undefined)
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `UNCONFIRMED [${proposalId}] approve=${approve} — the operator returned no` +
              ' evidence that this vote was recorded: no weight and no epoch. It may or' +
              ' may not have been cast. Do not re-send it — a vote cannot be recast, so a' +
              ' retry is either rejected or counted twice. Check saihm_status and report' +
              ' this to your operator.' +
              // It said nothing about recording the vote, but if what it did echo back
              // disagrees with the request, say so. The mismatch branch below never runs
              // on this path, and dropping the one substantive thing the operator
              // returned would waste the clearest sign that something is wrong with it.
              (disagreement !== '' ? ` It also disagreed with the request.${disagreement}` : ''),
          },
        ],
      };

    // A vote recorded as something other than what was asked for is the worst outcome
    // this tool can report, so it leads: the headline is what gets read.
    if (disagreement !== '')
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `VOTE MISMATCH [${proposalId}] — the operator did not record the vote that` +
              ` was requested.${disagreement} A vote cannot be recast, so voting again will` +
              ' not correct this. Verify with your operator before treating your position' +
              ' as represented.' +
              (weight !== undefined ? ` weight=${weight}` : '') +
              (castAtEpoch !== undefined ? ` epoch=${castAtEpoch}` : ''),
          },
        ],
      };

    // A vote with no weight behind it changes no outcome, and reporting a bare VOTED for
    // one lets a caller believe a governance position is represented when it is not.
    if (weight === 0)
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `VOTED [${proposalId}] approve=${approve} weight=0 — WARNING: this vote` +
              ' carries zero weight and does not affect the outcome. Weight comes from' +
              ' the gSAIHM balance at the proposal snapshot epoch; a balance acquired' +
              ' afterwards does not count and the vote cannot be recast. Do not re-send' +
              ' it; raise this with your operator if you expected weight here.',
          },
        ],
      };

    const detail: string[] = [];
    if (voter !== undefined) detail.push(`voter=${voter.slice(0, 16)}…`);
    detail.push(`approve=${approve}`);
    if (weight !== undefined) detail.push(`weight=${weight}`);
    if (castAtEpoch !== undefined) detail.push(`epoch=${castAtEpoch}`);
    // No disagreement clause here: reaching this line means both echoes agreed, so the
    // requested id in the headline is also the one the operator reported.

    return {
      content: [
        {
          type: 'text' as const,
          text: `VOTED [${proposalId}] ${detail.join(' ')}`,
        },
      ],
    };
  },
);

// Session-bootstrap prompt (an MCP Prompt, not a tool — the 8-tool surface is unchanged).
// Hosts surface this so an agent loads its persistent memory before other work.
server.registerPrompt(
  'saihm_session_bootstrap',
  {
    title: 'Load SAIHM memory',
    description: 'Load your SAIHM persistent memory at the start of a session, before other work.',
  },
  () => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: 'Before anything else, call the saihm_recall tool (no query, or a keyword if you have one) to load my SAIHM persistent memory for this session, then briefly summarise what you recalled.',
        },
      },
    ],
  }),
);

export { server };

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run as a bin only when invoked directly, not when imported (e.g. by tests).
// Symlink-robust: npx/.bin launch via a symlink, so resolve argv[1] to its
// realpath before comparing to this module's URL (guards main()-on-import).
//
// Both forms are compared, because the two sides can disagree about symlinks. Node's
// ESM loader resolves to the realpath by default, so the resolved form is what matches
// — but under --preserve-symlinks import.meta.url keeps the symlink path instead, and
// comparing only the resolved form made `npx saihm-mcp-server` exit 0 having started no
// server and printed nothing, which is the worst way for a launcher to fail. Comparing
// both is still safe against main()-on-import: a test runner's argv[1] is its own path
// and matches neither form of this module.
function invokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined || argv1 === '') return false;
  if (import.meta.url === pathToFileURL(argv1).href) return true;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((e) => {
    process.stderr.write(String(e));
    process.exit(1);
  });
}
