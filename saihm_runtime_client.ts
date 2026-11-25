// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SAIHM, Inc.
/**
 * SAIHM MCP — runtime client.
 *
 * Forwards MCP tool calls to a SAIHM operator endpoint over HTTPS. The endpoint
 * is operator-supplied and runs the full SAIHM protocol stack behind the 8 MCP tools.
 * This client forwards each call as an HTTPS POST with the configured
 * Authorization header and lets the endpoint do the protocol work. It holds no
 * keys, does no signing and keeps no storage.
 *
 * Configure via env:
 *   SAIHM_ENDPOINT_URL  HTTPS endpoint, e.g. https://operator.example.com/mcp
 *                       Must be `https://` unless the host is `127.0.0.1` or
 *                       `localhost` (dev exception), and must not carry a user
 *                       name or password. Both are checked when the client is
 *                       constructed, on the first tool call.
 *                       Redirects are refused rather than followed, so the
 *                       scheme checked at construction is the scheme actually
 *                       used — otherwise a 307 would carry both the request
 *                       body and the connection to a host nobody validated.
 *   SAIHM_AUTH_HEADER   Authorization header value per the operator's auth scheme
 *                       (e.g. "Bearer <token>"). This client is
 *                       authentication-agnostic; never send raw private keys.
 *                       A value that cannot be sent as an HTTP header is refused
 *                       at construction.
 *
 * Defensive limits:
 *   REQUEST_TIMEOUT_MS  per-call abort window (30s)
 *   MAX_RESPONSE_BYTES  stop reading a response once it exceeds 16 MB
 */

import { SharingContractType, type SharingContractScope } from './types.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

// First-run pointer: a freshly installed client has no operator endpoint
// configured, so the first tool call throws here. Surface every onward path —
// the free tier (which activates through the non-custodial companion client,
// since this package stays crypto-free), an operator endpoint for this client,
// and the offline demos — instead of a bare "env var required" dead-end.
/**
 * An endpoint URL is safe to quote in an error ONLY after userinfo, query and fragment are
 * dropped. SAIHM_ENDPOINT_URL is operator-supplied and may carry a token in the query string,
 * or credentials as userinfo (https://user:pass@host), which the constructor refuses; an
 * error message is read by an agent and lands in a transcript, so echoing it raw would
 * publish exactly what this client exists to keep private. Scheme, host and path are what
 * identify a mistyped endpoint.
 */
export function safeEndpoint(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '(unparseable endpoint URL)';
  }
}

/**
 * The hosted SAIHM service is non-custodial and pairs with @saihm/mcp-server-pro, not
 * this crypto-free client. Both hostnames are the same operator: the original host,
 * saihm.coti.global, is served until 2026-12-31, and saihm.net is the canonical host.
 */
const HOSTED_NON_CUSTODIAL_HOSTS: ReadonlySet<string> = new Set(['saihm.coti.global', 'saihm.net']);
export function isHostedNonCustodial(endpoint: string): boolean {
  try {
    return HOSTED_NON_CUSTODIAL_HOSTS.has(new URL(endpoint).host.toLowerCase());
  } catch {
    return false;
  }
}

const SETUP_HINT =
  ' Start free, no card: `npx -y @saihm/mcp-server-pro free-join` — the' +
  ' non-custodial companion client, which seals on your own machine; see its' +
  ' README for the one-time setup. That is also the client for the hosted SAIHM' +
  ' service at https://saihm.net: it is non-custodial and stores only' +
  ' ciphertext, so this crypto-free client cannot read memory held there. To use' +
  ' THIS client, set SAIHM_ENDPOINT_URL and SAIHM_AUTH_HEADER for a custodial' +
  ' operator that performs cryptography server-side. To evaluate the protocol' +
  ' offline first (no' +
  ' account, about a minute), run the demos at https://saihm-admin.github.io/saihm-demos/';

/*
 * Node's fetch quotes the offending value in two of its errors, and here both values are
 * credentials:
 *
 *   an Authorization value with a line break or NUL inside it:
 *     Headers.append: "Bearer X\nY" is an invalid header value.
 *   an endpoint URL with a user name or password in it:
 *     Request cannot be constructed from a URL that includes credentials: http://user:PASS@host/
 *
 * A thrown message becomes the text of an isError tool result, so either would copy the
 * secret into the model's context and the transcript. The constructor refuses both shapes
 * with the fixed messages below, so neither value reaches fetch, and call() replaces any
 * other error fetch raises while building the request.
 */
const AUTH_HEADER_INVALID =
  'SAIHM_AUTH_HEADER contains a character that cannot be sent in an HTTP header, such as' +
  ' a line break or another control character inside the value. The value is not quoted' +
  ' back here, because it is a credential. Set it to the value your operator issued, on' +
  ' one line (for example "Bearer <token>").';
const ENDPOINT_HAS_USERINFO =
  'SAIHM_ENDPOINT_URL includes a user name or password (the user:password@ part before' +
  ' the host). A request cannot carry credentials in its URL, and the URL is not quoted' +
  ' back here, because that part is a credential. Remove it and send the credential in' +
  ' SAIHM_AUTH_HEADER, as your operator specifies.';
const REQUEST_NOT_BUILT =
  'The HTTP library could not build the request from SAIHM_ENDPOINT_URL and' +
  ' SAIHM_AUTH_HEADER. Its message is not quoted here, because it can contain either' +
  ' value. Check both variables.';

/**
 * Whether fetch can send this as a header value. fetch first trims leading and trailing
 * tabs, spaces and line breaks (a token read from a file often ends in a newline), and
 * those values work, so they are trimmed here too rather than refused. What remains may
 * hold only tab, visible ASCII, space and the Latin-1 range: a line break, NUL, other
 * control character or DEL inside the value, or any character above U+00FF, makes fetch
 * throw. That is the field-value grammar of RFC 9110 §5.5, and the same test undici
 * applies before it sends a header.
 */
function isSendableHeaderValue(value: string): boolean {
  return !/[^\t\x20-\x7e\x80-\xff]/.test(value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, ''));
}

function hasUserinfo(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.username !== '' || url.password !== '';
  } catch {
    return false;
  }
}

function assertEndpointUrl(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    // The value is not quoted back. This branch is reached only by a string that
    // failed to parse as a URL, so every value that arrives here is the wrong value,
    // and the likeliest wrong value is the contents of SAIHM_AUTH_HEADER put in the
    // neighboring variable. A thrown message becomes the text of an isError tool
    // result, which is handed to the model and written to the transcript, so quoting
    // it would copy a bearer token into both. Name the variable and the shape it
    // should have instead — which is what the https branch below already does, and
    // what both SAIHM_AUTH_HEADER errors do.
    throw new Error(
      'SAIHM_ENDPOINT_URL is not a valid URL, and is not quoted back here in case it' +
        ' holds a credential. Expected an operator endpoint of the form' +
        ' https://operator.example.com/mcp. Check the variable directly, and check it' +
        ' does not hold the value meant for SAIHM_AUTH_HEADER.' +
        SETUP_HINT,
    );
  }
  if (url.username !== '' || url.password !== '') throw new Error(ENDPOINT_HAS_USERINFO);
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'))
    return;
  throw new Error(
    `SAIHM_ENDPOINT_URL must use https:// (got ${url.protocol}//). ` +
      `Plain http:// is only allowed for 127.0.0.1 or localhost (dev).`,
  );
}

export interface RememberResult {
  cellId: string;
  /**
   * 16-byte per-cell nonce (hex). Surfaced to the agent so it can keep
   * a verifiable record of which nonce was bound to this cell at
   * creation time. Per draft-saihm-memory-protocol-03 §2.1 the nonce
   * is a public field of the cell tuple.
   */
  cellNonce: string;
  tier: string;
  kekVersion: number;
  epoch: string;
  feeNcoti: string;
  signaturePrefix: string;
}

export interface RecalledCell {
  cellId: string;
  /** 16-byte per-cell nonce (hex). See {@link RememberResult.cellNonce}. */
  cellNonce: string;
  /** KEK generation in force when the cell was written. Spec §2.1. */
  kekVersion: number;
  /** 32-byte hex of the holder's ML-DSA-65 public-key hash. Spec §2.1. */
  holderIdHex: string;
  /**
   * Short prefix (hex) of the holder's ML-DSA-65 signature. Per spec
   * §2.3 the signature is computed over (cellId ‖ holderId ‖
   * kekVersion_be32 ‖ timestamp_be64). Full signature is ~3309 bytes;
   * surfacing the prefix lets agents log a compact integrity-witness
   * without inflating recall payloads. The signature is verified at
   * the operator endpoint as part of cell read.
   */
  holderSignaturePrefix: string;
  timestamp: string;
  tier: string;
  plaintext: string;
}

export interface ForgetResult {
  success: boolean;
  cellId?: string;
  destructionAnchor?: string;
  epoch?: string;
}

export interface StakingPosition {
  amountNcoti: string;
  accruedYieldNcoti: string;
}

/**
 * One element of the `contracts` array returned by `saihm_status`.
 * Spec: draft-saihm-memory-protocol-03 §4.5 (a sharing contract
 * visible to this holder), a JSON object. The spec does not narrow
 * the array to active-only contracts; operators MAY include expired
 * entries, and MUST NOT include revoked ones.
 */
export interface ContractEntry {
  /** 32-byte hex contract identifier. Spec §4.5. */
  contractId: string;
  /**
   * Sharing-contract mode. Per spec §2.6 / §4.5 the on-wire string
   * enum is `"TEMPORARY"`, `"PERMANENT"`, or `"SYNDICATE"`. This
   * is the spec-aligned uppercase form; it is independent of the
   * `SharingContractType` enum used by `saihm_share` parameters,
   * which is lowercase for legacy reasons.
   */
  mode: 'TEMPORARY' | 'PERMANENT' | 'SYNDICATE';
  /** Grantee agent ID hashes (each 32-byte hex). Spec §4.5. */
  granteeIds: string[];
  /**
   * Expiry as UNIX epoch seconds (decimal string). Spec §4.5
   * specifies an unsigned integer, so the value is surfaced as
   * `string` to preserve precision for values beyond the JS
   * Number safe-integer ceiling (2^53 - 1). Per spec §2.6 the
   * permitted range depends on `mode`: `TEMPORARY` caps expiry at
   * `timestamp + 86400` seconds (24 hours); `PERMANENT` requires
   * the sentinel value `"0"` (no time bound); `SYNDICATE` permits
   * either `"0"` or any future timestamp. Enforcement is the
   * operator's responsibility.
   */
  expiresAt: string;
}

/**
 * One element of the `governance` array returned by `saihm_status`.
 * Spec: draft-saihm-memory-protocol-03 §4.5 (a governance proposal
 * visible to the holder), a JSON object. Field names use snake_case
 * verbatim from the spec. The spec does not narrow the array to a
 * particular state (active / closed / decided); operators MAY
 * include closed proposals.
 */
export interface GovernanceEntry {
  /** 32-byte hex proposal identifier. Spec §4.5. */
  propId: string;
  /**
   * Proposal scope string. The set of permitted scope values is
   * defined by the operator's published governance form (spec
   * §4.10 item (f)), not by the protocol itself. The
   * `saihm_governance_propose` input (spec §4.8) offers
   * `"emission_param"` and `"protocol_upgrade"`; see the
   * `governancePropose` parameter type on `SaihmRuntimeClient`.
   */
  scope: string;
  /** Voting-window open, UNIX epoch seconds (decimal string). Spec §4.5. */
  opens_ts: string;
  /** Voting-window close, UNIX epoch seconds (decimal string). Spec §4.5. */
  closes_ts: string;
  /**
   * Vote-weight tally in favor (decimal string). Spec §4.5
   * specifies unsigned integer; surfaced as `string` so unbounded
   * weight aggregates beyond 2^53 - 1 remain exact.
   */
  tally_for: string;
  /** Vote-weight tally against (decimal string). Spec §4.5. */
  tally_against: string;
  /** Vote-weight tally abstaining (decimal string). Spec §4.5. */
  tally_abstain: string;
}

export interface StatusSnapshot {
  // ────────── operator-extension fields (0.1.x / 0.2.x; retained) ──────────
  agentIdHashHex: string;
  /**
   * The operator's custody model, when it declares one. `"non-custodial"` means
   * the operator holds ciphertext and no keys — it therefore cannot report
   * stored-byte totals or return plaintext, and the fields below that depend on
   * reading cell contents will be absent. Optional: operators that predate this
   * field, or that are custodial, simply omit it.
   */
  custody?: string;
  prsScore: number;
  prsLevel: string;
  bfsiScore: number;
  feeDiscountPct: number;
  activeShardCount: number;
  storageByTier: Record<string, number>;
  stakingPosition: StakingPosition;
  activeSharingContracts: number;
  phi: number;
  snapshotEpoch: string;

  // ────────── draft -03 §4.5 fields (added 0.3.0) ──────────
  /**
   * Process Reliability Score. Spec §4.5: a number in [0.0, 1.0],
   * the fraction of tool calls answered within the operator's
   * published service window over a rolling 30-day window.
   */
  prs: number;
  /**
   * Receipt-match index. Spec §4.5: bfsi = 1 - (M / R), and 1.0 by
   * convention when R = 0. M comes from the holder's own log of tool
   * calls, which the operator cannot see, so an operator returns
   * `bfsi` and `bfsi_M` only when the holder has given it M.
   */
  bfsi: number;
  /**
   * Start of the rolling 30-day window over which `bfsi` (and
   * `prs`) is computed, as UNIX epoch seconds (decimal string).
   * Spec §4.5 specifies unsigned integer; surfaced as `string`
   * for forward-compat with values beyond 2^53 - 1.
   */
  bfsi_window_start_ts: string;
  /**
   * Count of receipts in the audit log attributed to the holder
   * over the window, as a decimal string. Spec §4.5 specifies
   * unsigned integer; `string` preserves precision for unbounded
   * receipt counts.
   */
  bfsi_R: string;
  /**
   * Count of those receipts with no matching call in the holder's
   * own log, as a decimal string. Spec §4.5 specifies unsigned
   * integer; `string` preserves precision.
   */
  bfsi_M: string;
  /**
   * Shards held under each tier, keyed by tier name, value = cell
   * count. Spec §4.5 ("an object keyed by tier name; each value is
   * the number of the holder's cells under that tier"). This is
   * conceptually a per-cell-count view; the
   * pre-existing `storageByTier` field surfaces a per-tier byte
   * total and is retained alongside. The value type is `number`
   * (not `string`) because a per-tier cell count is bounded in
   * practice by storage-substrate capacity — well below the JS
   * Number safe-integer ceiling (2^53 - 1) — and using `number`
   * here matches the convention of the pre-existing
   * `storageByTier` field.
   */
  shards: Record<string, number>;
  /** Sharing-contract entries visible to this holder. Spec §4.5. */
  contracts: ContractEntry[];
  /** Governance-proposal entries visible to this holder. Spec §4.5. */
  governance: GovernanceEntry[];
}

export interface ShareResult {
  contractId: string;
  type: SharingContractType;
  granteeCount: number;
  creationFeeNcoti: string;
  epoch: string;
}

export interface RevokeShareResult {
  revoked: boolean;
  epoch: string;
}

export interface GovernanceProposeResult {
  proposalId: string;
  scope: string;
  paramKey: string | null;
  proposedValue: string | null;
  snapshotEpoch: string;
  proposerHash: string;
}

export interface GovernanceVoteResult {
  proposalId: string;
  voterHash: string;
  approve: boolean;
  weight: string;
  castAtEpoch: string;
}

/**
 * Read a response body with a hard byte cap, returning it as text.
 *
 * The Content-Length check at the call site is an early-out, not the enforcement.
 * A chunked response carries no Content-Length at all — which is what Node's own
 * http server sends whenever it does not set the length itself — so the header
 * lookup yields null, `Number(null ?? '0')` is 0, and the check waves it through.
 * Counting bytes as they arrive is therefore what bounds memory for a streamed
 * reply, and canceling mid-stream means a hostile endpoint is cut off rather than
 * downloaded in full and rejected afterwards.
 *
 * Decoding is streamed too: a UTF-8 character can straddle a chunk boundary, and
 * decoding each chunk independently would corrupt it into replacement characters.
 */
async function readCapped(res: Response, method: string): Promise<string> {
  if (res.body === null) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw new Error(
          `SAIHM endpoint ${method} response too large: exceeded the ${MAX_RESPONSE_BYTES}B` +
            ' cap while still streaming, so the response was cut off and not read.',
        );
      }
      out += decoder.decode(value, { stream: true });
    }
  } catch (err) {
    // Cancel, don't just release. releaseLock leaves the body undrained and the
    // socket open until the abort timer or the GC gets to it — so the guard meant
    // to stop an oversized download would let the sender keep the connection. On
    // the normal path the stream is already done and there is nothing to cancel.
    await reader.cancel().catch(() => {});
    throw err;
  } finally {
    reader.releaseLock();
  }
  return out + decoder.decode();
}

export class SaihmRuntimeClient {
  /**
   * `timeoutMs` defaults to the shipped 30s window. It is a parameter so the test suite
   * can exercise the abort path with a short window instead of waiting 30 seconds, which
   * keeps the availability control covered by a real test.
   */
  constructor(
    private readonly endpoint: string,
    private readonly authHeader: string,
    private readonly timeoutMs: number = REQUEST_TIMEOUT_MS,
  ) {
    assertEndpointUrl(endpoint);
    if (!isSendableHeaderValue(authHeader)) throw new Error(AUTH_HEADER_INVALID);
  }

  static bootFromEnv(): SaihmRuntimeClient {
    const endpoint = process.env.SAIHM_ENDPOINT_URL;
    const auth = process.env.SAIHM_AUTH_HEADER;
    if (!endpoint) throw new Error('SAIHM_ENDPOINT_URL env var required.' + SETUP_HINT);
    if (!auth)
      throw new Error(
        "SAIHM_AUTH_HEADER env var required (per operator's auth scheme)." + SETUP_HINT,
      );
    return new SaihmRuntimeClient(endpoint, auth);
  }

  private async call<T>(method: string, params: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let answered = false;
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: this.authHeader,
        },
        body: JSON.stringify({ method, params }),
        signal: ctrl.signal,
        // assertEndpointUrl checks the CONFIGURED url and nothing after it. fetch
        // follows redirects by default, so an endpoint answering 307 sent this exact
        // POST — method and body preserved — to whatever host it named, and the
        // https:// guarantee held only as far as the first hop. PROVEN against a local
        // pair of servers: `saihm_remember` delivered its `content` verbatim to the
        // redirect target over plain http. undici does strip Authorization across
        // origins, so the token survives; the body does not, and for saihm_remember the
        // body IS the memory plaintext — the one thing this client exists to protect.
        // A JSON-RPC POST endpoint has no reason to redirect, so any redirect is an
        // error rather than something to follow.
        redirect: 'error',
      });
      answered = true;
      if (!res.ok) {
        // A 401 from the hosted service is the SAME SYMPTOM as a bad operator token and a
        // completely different problem: that service is non-custodial, so no token makes a
        // crypto-free client able to read ciphertext it cannot open. Undifferentiated, the
        // reader re-issues a token that can never work. MEASURED 2026-09-23: pointing this
        // client at the hosted endpoint returns exactly 401 Unauthorized.
        const hostedAuthFailure =
          (res.status === 401 || res.status === 403) && isHostedNonCustodial(this.endpoint);
        throw new Error(
          `SAIHM endpoint ${method} failed: ${res.status} ${res.statusText}` +
            (hostedAuthFailure
              ? '. That endpoint is the hosted SAIHM service, which is non-custodial: it holds' +
                ' only ciphertext, so this crypto-free client cannot read memory there and no' +
                ' token will change that. Use `npx -y @saihm/mcp-server-pro free-join` instead.'
              : ''),
        );
      }
      const cl = Number(res.headers.get('content-length') ?? '0');
      if (cl > MAX_RESPONSE_BYTES) {
        throw new Error(
          `SAIHM endpoint ${method} response too large: ${cl}B (max ${MAX_RESPONSE_BYTES}B)`,
        );
      }
      const raw = await readCapped(res, method);
      try {
        return JSON.parse(raw) as T;
      } catch {
        // A 200 that is not JSON is usually an intermediary talking, not the
        // operator: a captive portal, a proxy error page, an HTML login redirect.
        // The raw parser error ("Unexpected token <") names none of that, so quote
        // the opening bytes and say where they came from.
        const head = raw.slice(0, 120).replace(/\s+/g, ' ').trim();
        throw new Error(
          `SAIHM endpoint ${method} returned a non-JSON response` +
            `${head === '' ? ' (empty body)' : `, starting: ${head}`}. The endpoint URL may` +
            ' be wrong, or something between this client and the operator answered instead.',
        );
      }
    } catch (err) {
      // An aborted fetch throws "This operation was aborted", which names neither the
      // endpoint nor the reason. Only rewritten when the signal actually fired, so a
      // redirect refusal and a transport error keep their own messages.
      if (ctrl.signal.aborted) {
        throw new Error(
          `SAIHM endpoint ${method} timed out after ${this.timeoutMs}ms with no response,` +
            ' so the call was aborted. It is unknown whether the operator acted on it.',
        );
      }
      // fetch throws a TypeError other than "fetch failed" when it cannot build the
      // request, before anything is sent, and that message can quote SAIHM_ENDPOINT_URL or
      // SAIHM_AUTH_HEADER. The constructor refuses the values known to cause one; this
      // replaces any other with a fixed message. The original is dropped rather than kept
      // as the cause, because the cause would carry the value along. The prefix test keeps
      // a value that happens to contain "fetch failed" from passing as a transport error.
      if (!answered && err instanceof TypeError && !/^fetch failed/i.test(err.message)) {
        throw new Error(
          `SAIHM endpoint ${method} was not sent. ` +
            (!isSendableHeaderValue(this.authHeader)
              ? AUTH_HEADER_INVALID
              : hasUserinfo(this.endpoint)
                ? ENDPOINT_HAS_USERINFO
                : REQUEST_NOT_BUILT),
        );
      }
      // A transport failure throws TypeError('fetch failed') and puts the real reason on
      // .cause (DNS, refused connection, TLS). Neither half names the endpoint, so an
      // engineer who mistyped SAIHM_ENDPOINT_URL sees only "fetch failed" and has nothing
      // to act on. Rewritten ONLY for that case, so the redirect refusal above and every
      // message built in this method keep their own wording.
      if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
        const cause = (err as { cause?: { code?: string; message?: string } }).cause;
        const why = cause?.code ?? cause?.message ?? 'no further detail available';
        throw new Error(
          `SAIHM endpoint ${method} could not reach ${safeEndpoint(this.endpoint)} (${why}).` +
            ' Check that SAIHM_ENDPOINT_URL is correct and reachable from this machine.',
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  remember(content: string): Promise<RememberResult> {
    return this.call('saihm_remember', { content });
  }

  recall(query?: string): Promise<RecalledCell[]> {
    return this.call('saihm_recall', { query });
  }

  forget(id: string): Promise<ForgetResult> {
    return this.call('saihm_forget', { id });
  }

  status(): Promise<StatusSnapshot> {
    return this.call('saihm_status', {});
  }

  share(
    granteeIdHashes: Uint8Array[],
    shardIds: string[],
    type: SharingContractType,
    scope: SharingContractScope,
    expiryEpoch: bigint | null,
  ): Promise<ShareResult> {
    const granteeIdHashesHex = granteeIdHashes.map((g) => Buffer.from(g).toString('hex'));
    return this.call('saihm_share', {
      granteeIdHashesHex,
      shardIds,
      type,
      scope,
      expiryEpoch: expiryEpoch === null ? null : expiryEpoch.toString(),
    });
  }

  revokeShare(contractId: string): Promise<RevokeShareResult> {
    return this.call('saihm_revoke_share', { contractId });
  }

  governancePropose(args: {
    scope: 'emission_param' | 'protocol_upgrade';
    paramKey: string | null;
    proposedValue: string | null;
  }): Promise<GovernanceProposeResult> {
    return this.call('saihm_governance_propose', args);
  }

  governanceVote(args: { proposalId: string; approve: boolean }): Promise<GovernanceVoteResult> {
    return this.call('saihm_governance_vote', args);
  }
}
