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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SaihmRuntimeClient } from './saihm_runtime_client.js';
import { SharingContractType, type SharingContractScope } from './types.js';

// Source the MCP-server version string from package.json so the
// version reported via `initialize`'s `serverInfo` always matches the
// npm-published version. The compiled output lives at
// `dist/saihm_mcp_server.js`; `package.json` is one directory up.
const PACKAGE_VERSION: string = (
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
      'utf-8',
    ),
  ) as { version: string }
).version;

const server = new McpServer(
  { name: 'saihm', version: PACKAGE_VERSION },
  { capabilities: { tools: {} } },
);

let runtime: SaihmRuntimeClient | null = null;
function getRuntime(): SaihmRuntimeClient {
  if (!runtime) runtime = SaihmRuntimeClient.bootFromEnv();
  return runtime;
}

server.tool(
  'saihm_remember',
  'Store information to SAIHM persistent encrypted memory.',
  { content: z.string().describe('Information to remember') },
  async ({ content }) => {
    const r = await getRuntime().remember(content);
    return {
      content: [
        {
          type: 'text' as const,
          text: `REMEMBERED [${r.cellId}] nonce=${r.cellNonce} tier=${r.tier} kekV=${r.kekVersion} epoch=${r.epoch} fee=${r.feeNcoti}nCOTI sig=${r.signaturePrefix}…`,
        },
      ],
    };
  },
);

server.tool(
  'saihm_recall',
  'Retrieve and decrypt memories from SAIHM encrypted store.',
  { query: z.string().optional().describe('Filter by keyword (empty = all)') },
  async ({ query }) => {
    const cells = await getRuntime().recall(query);
    if (cells.length === 0)
      return { content: [{ type: 'text' as const, text: 'No memories stored.' }] };
    const lines = [`RECALL ${cells.length} memories`];
    for (const c of cells)
      lines.push(
        `  [${c.cellId}] kekV=${c.kekVersion} nonce=${c.cellNonce} ${c.timestamp} (${c.tier}) | ${c.plaintext}`,
      );
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
);

server.tool(
  'saihm_forget',
  'Cryptographically erase a memory (GDPR Art. 17 erasure).',
  { id: z.string().describe('Memory entry ID (hex cellId) to erase') },
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

server.tool(
  'saihm_status',
  'Show SAIHM session status (PRS, BFSI, storage by tier, sharing, PHI).',
  {},
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

server.tool(
  'saihm_share',
  'Create a sharing contract (TEMPORARY/PERMANENT/SYNDICATE) over one or more shards.',
  {
    granteeIdHashesHex: z.array(z.string()).describe('Hex-encoded grantee agent ID hashes'),
    shardIds: z.array(z.string()).describe('Shard IDs to include in the contract'),
    type: z.enum(['temporary', 'permanent', 'syndicate']).describe('Contract type'),
    scope: z.enum(['read', 'write', 'readwrite']).describe('Access scope'),
    expiryEpoch: z.string().optional().describe('Optional expiry epoch (decimal string)'),
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

server.tool(
  'saihm_revoke_share',
  'Revoke an existing sharing contract by its contractId.',
  { contractId: z.string().describe('Sharing contract ID to revoke') },
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

server.tool(
  'saihm_governance_propose',
  "Submit a gSAIHM-governance proposal. Scope MUST be 'emission_param' or 'protocol_upgrade'.",
  {
    scope: z.enum(['emission_param', 'protocol_upgrade']).describe('Governable scope'),
    paramKey: z.string().optional().describe('Parameter key (when scope=emission_param)'),
    proposedValue: z.string().optional().describe('Proposed value as string'),
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

server.tool(
  'saihm_governance_vote',
  'Cast a vote on an open gSAIHM-governance proposal. Vote weight is derived from gSAIHM balance at proposal.snapshotEpoch.',
  {
    proposalId: z.string().describe('Hex proposalId returned by saihm_governance_propose'),
    approve: z.boolean().describe('true = approve, false = reject'),
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(String(e));
  process.exit(1);
});
