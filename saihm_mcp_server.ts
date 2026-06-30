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
import { SaihmRuntimeClient } from './saihm_runtime_client.js';
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

server.registerTool(
  'saihm_remember',
  {
    title: 'Remember',
    description:
      'Store information to SAIHM persistent encrypted memory. Use this when an agent or user wants a fact, decision, or piece of context to persist across sessions.',
    inputSchema: { content: z.string().describe('Information to remember') },
    outputSchema: {
      cellId: z.string(),
      cellNonce: z.string(),
      tier: z.string(),
      kekVersion: z.string(),
      epoch: z.string(),
      feeNcoti: z.string(),
      signaturePrefix: z.string(),
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
    const r = await getRuntime().remember(content);
    return {
      content: [
        {
          type: 'text' as const,
          text: `REMEMBERED [${r.cellId}] nonce=${r.cellNonce} tier=${r.tier} kekV=${r.kekVersion} epoch=${r.epoch} fee=${r.feeNcoti}nCOTI sig=${r.signaturePrefix}…`,
        },
      ],
      structuredContent: {
        cellId: r.cellId,
        cellNonce: String(r.cellNonce),
        tier: String(r.tier),
        kekVersion: String(r.kekVersion),
        epoch: String(r.epoch),
        feeNcoti: String(r.feeNcoti),
        signaturePrefix: String(r.signaturePrefix),
      },
    };
  },
);

server.registerTool(
  'saihm_recall',
  {
    title: 'Recall',
    description:
      'Retrieve and decrypt memories from SAIHM encrypted store. Use this at the start of a session or whenever past context is needed; pass a keyword to filter, or leave empty to load all.',
    inputSchema: { query: z.string().optional().describe('Filter by keyword (empty = all)') },
    outputSchema: {
      count: z.number(),
      memories: z.array(
        z.object({
          cellId: z.string(),
          kekVersion: z.string(),
          cellNonce: z.string(),
          timestamp: z.string(),
          tier: z.string(),
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
    const memories = cells.map((c) => ({
      cellId: c.cellId,
      kekVersion: String(c.kekVersion),
      cellNonce: String(c.cellNonce),
      timestamp: String(c.timestamp),
      tier: String(c.tier),
      plaintext: c.plaintext,
    }));
    if (cells.length === 0)
      return {
        content: [{ type: 'text' as const, text: 'No memories stored.' }],
        structuredContent: { count: 0, memories },
      };
    const lines = [`RECALL ${cells.length} memories`];
    for (const c of cells)
      lines.push(
        `  [${c.cellId}] kekV=${c.kekVersion} nonce=${c.cellNonce} ${c.timestamp} (${c.tier}) | ${c.plaintext}`,
      );
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
    if (!r.success)
      return {
        content: [{ type: 'text' as const, text: `Entry ${id} not found or already destroyed.` }],
      };
    return {
      content: [
        {
          type: 'text' as const,
          text: `FORGOTTEN [${r.cellId}] DEK destroyed (anchor=${r.destructionAnchor?.slice(0, 32)}…) epoch=${r.epoch}`,
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
      'Show SAIHM session status (PRS, BFSI, storage by tier, sharing, PHI). Use this to check the agent identity, reputation, storage, and sharing state of the current SAIHM session.',
    inputSchema: {},
    outputSchema: {
      agentIdHash: z.string(),
      prsScore: z.string(),
      prsLevel: z.string(),
      bfsiScore: z.number(),
      feeDiscountPct: z.number(),
      activeShardCount: z.number(),
      activeSharingContracts: z.number(),
      phi: z.number(),
      snapshotEpoch: z.string(),
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
    const d = await getRuntime().status();
    const tiers = Object.entries(d.storageByTier)
      .map(([t, b]) => `${t}=${b}B`)
      .join(' ');
    return {
      content: [
        {
          type: 'text' as const,
          text: `SAIHM Session\n  agent=${d.agentIdHashHex.slice(0, 16)}…\n  PRS=${d.prsScore} (${d.prsLevel})  BFSI=${d.bfsiScore.toFixed(3)}  feeDiscount=${(d.feeDiscountPct * 100).toFixed(1)}%\n  shards=${d.activeShardCount}  ${tiers}\n  staking=${d.stakingPosition.amountNcoti}nCOTI yield=${d.stakingPosition.accruedYieldNcoti}nCOTI\n  sharing=${d.activeSharingContracts}  PHI=${d.phi.toFixed(3)}  epoch=${d.snapshotEpoch}\n  §3.4: prs=${d.prs.toFixed(3)} bfsi=${d.bfsi.toFixed(3)} (R=${d.bfsi_R} M=${d.bfsi_M} win=${d.bfsi_window_start_ts}) contracts=${d.contracts.length} governance=${d.governance.length}`,
        },
      ],
      structuredContent: {
        agentIdHash: d.agentIdHashHex,
        prsScore: String(d.prsScore),
        prsLevel: String(d.prsLevel),
        bfsiScore: d.bfsiScore,
        feeDiscountPct: d.feeDiscountPct,
        activeShardCount: Number(d.activeShardCount),
        activeSharingContracts: Number(d.activeSharingContracts),
        phi: d.phi,
        snapshotEpoch: String(d.snapshotEpoch),
      },
    };
  },
);

const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2 !== 0) throw new Error(`hex length odd: ${h}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};

server.registerTool(
  'saihm_share',
  {
    title: 'Share',
    description:
      'Create a sharing contract (TEMPORARY/PERMANENT/SYNDICATE) over one or more shards. Use this to grant another agent access to specific memories.',
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
    const grantees = granteeIdHashesHex.map(hexToBytes);
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
      expiryEpoch ? BigInt(expiryEpoch) : null,
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `SHARED contract=${r.contractId} type=${r.type} grantees=${r.granteeCount} fee=${r.creationFeeNcoti}nCOTI epoch=${r.epoch}`,
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
    return {
      content: [
        {
          type: 'text' as const,
          text: `REVOKED contract=${contractId} revoked=${r.revoked} epoch=${r.epoch}`,
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
    const p = await getRuntime().governancePropose({
      scope,
      paramKey: paramKey ?? null,
      proposedValue: proposedValue ?? null,
    });
    return {
      content: [
        {
          type: 'text' as const,
          text: `PROPOSED [${p.proposalId}] scope=${p.scope} paramKey=${p.paramKey ?? '—'} proposedValue=${p.proposedValue ?? '—'} snapshotEpoch=${p.snapshotEpoch} proposer=${p.proposerHash.slice(0, 16)}…`,
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
    return {
      content: [
        {
          type: 'text' as const,
          text: `VOTED [${v.proposalId}] voter=${v.voterHash.slice(0, 16)}… approve=${v.approve} weight=${v.weight} epoch=${v.castAtEpoch}`,
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
function invokedDirectly(): boolean {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? '')).href;
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
