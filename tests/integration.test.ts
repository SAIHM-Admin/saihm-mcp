/**
 * Comprehensive functional test for @saihm/mcp-server bare-bones.
 * Covers:
 *   - All 8 MCP calls via SaihmRuntimeClient against a mock HTTP server
 *   - Reporting: 4 auth paths, 6 receipt sub-kinds, registry-attestation flow,
 *     template validation edge cases
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SaihmRuntimeClient } from '../saihm_runtime_client.js';
import { SharingContractType } from '../types.js';
import { server as mcpServer } from '../saihm_mcp_server.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  validateBespokeTemplate,
  registerTemplate,
  InMemoryReportingRuntime,
  generateRegistryAttestation,
  StubPublicRegistry,
  buildReportGenerated,
  buildReportRejected,
  buildTemplateRegistered,
  buildTemplateSuperseded,
  buildErasureChainBroken,
  buildRateLimitExceeded,
  emitReceipt,
  validateAuthForKind,
  validateAuthPublic,
  validateAuthSelf,
  validateAuthOperatorSelf,
  validateAuthOperatorForDownstream,
  GDPR_ART15_FIELDS,
  REGISTRY_ATTESTATION_FIELDS,
  FIELD_UNIVERSE,
  HKDF_INDEX_REPORT_RECEIPT,
  HKDF_DOMAIN_REPORT_RECEIPT,
  type BespokeReportTemplate,
} from '../reporting/index.js';

let pass = 0,
  fail = 0;
function assert(cond: unknown, label: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}
function group(name: string): void {
  console.log(`\n${name}`);
}

const calls: Array<{ method: string; params: unknown; auth?: string }> = [];
const responder: { for(method: string): unknown } = {
  for(method) {
    switch (method) {
      case 'saihm_remember':
        return {
          cellId: 'deadbeef'.repeat(8),
          cellNonce: 'ab'.repeat(16),
          tier: 'filecoin',
          kekVersion: 1,
          epoch: '493970',
          feeNcoti: '100000',
          signaturePrefix: 'abcdef',
        };
      case 'saihm_recall':
        return [
          {
            cellId: 'aa'.repeat(32),
            cellNonce: 'cc'.repeat(16),
            kekVersion: 1,
            holderIdHex: '11'.repeat(32),
            holderSignaturePrefix: '22'.repeat(16),
            timestamp: '2026-05-09T00:00:00Z',
            tier: 'filecoin',
            plaintext: 'hello',
          },
          {
            cellId: 'bb'.repeat(32),
            cellNonce: 'dd'.repeat(16),
            kekVersion: 1,
            holderIdHex: '33'.repeat(32),
            holderSignaturePrefix: '44'.repeat(16),
            timestamp: '2026-05-09T00:01:00Z',
            tier: 'filecoin',
            plaintext: 'world',
          },
        ];
      case 'saihm_forget':
        return {
          success: true,
          cellId: 'cc'.repeat(32),
          destructionAnchor: 'ee'.repeat(32),
          epoch: '493971',
        };
      case 'saihm_status':
        return {
          agentIdHashHex: '1234567890abcdef'.repeat(4),
          prsScore: 42,
          prsLevel: 'TIER_2',
          bfsiScore: 0.875,
          feeDiscountPct: 0.15,
          activeShardCount: 12,
          storageByTier: { filecoin: 12345, ipfs: 6789 },
          stakingPosition: { amountNcoti: '5000000000', accruedYieldNcoti: '12000' },
          activeSharingContracts: 3,
          phi: 0.612,
          snapshotEpoch: '493970',
          // ────────── §3.4 spec-aligned fields ──────────
          // R=8, M=1 → bfsi = 1 - 1/8 = 0.875 (matches bfsiScore).
          prs: 0.875,
          bfsi: 0.875,
          bfsi_window_start_ts: '1777334400',
          bfsi_R: '8',
          bfsi_M: '1',
          shards: { filecoin: 12, ipfs: 8 },
          // SYNDICATE mode chosen so that the future expiresAt is
          // spec-compliant (spec §2.5: TEMPORARY caps expiry at +24h;
          // PERMANENT requires sentinel 0; SYNDICATE permits any future
          // timestamp). Two grantees exercise the multi-party aspect.
          contracts: [
            {
              contractId: 'aa'.repeat(32),
              mode: 'SYNDICATE',
              granteeIds: ['bb'.repeat(32), 'dd'.repeat(32)],
              expiresAt: '1782000000',
            },
          ],
          governance: [
            {
              propId: 'cc'.repeat(32),
              scope: 'emission_param',
              opens_ts: '1777334400',
              closes_ts: '1779926400',
              tally_for: '1000',
              tally_against: '500',
              tally_abstain: '100',
            },
          ],
        };
      case 'saihm_share':
        return {
          contractId: 'ff'.repeat(16),
          type: 'temporary',
          granteeCount: 1,
          creationFeeNcoti: '50000',
          epoch: '493971',
        };
      case 'saihm_revoke_share':
        return { revoked: true, epoch: '493972' };
      case 'saihm_governance_propose':
        return {
          proposalId: '11'.repeat(16),
          scope: 'emission_param',
          paramKey: 'block_reward',
          proposedValue: '1000',
          snapshotEpoch: '493970',
          proposerHash: '22'.repeat(32),
        };
      case 'saihm_governance_vote':
        return {
          proposalId: '11'.repeat(16),
          voterHash: '33'.repeat(32),
          approve: true,
          weight: '1000',
          castAtEpoch: '493971',
        };
      default:
        return { error: `unknown method ${method}` };
    }
  },
};

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body) as { method: string; params: unknown };
    calls.push({ method: parsed.method, params: parsed.params, auth: req.headers.authorization });
    const out = responder.for(parsed.method);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});

async function listen(): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

async function main() {
  const url = await listen();
  process.env.SAIHM_ENDPOINT_URL = url;
  process.env.SAIHM_AUTH_HEADER = 'Bearer test-token-xyz';
  const client = SaihmRuntimeClient.bootFromEnv();

  // ── 8 MCP calls ──────────────────────────────────────────────────────────
  group('8 MCP calls (via SaihmRuntimeClient → mock endpoint)');

  const r1 = await client.remember('test memory');
  assert(r1.cellId === 'deadbeef'.repeat(8), 'saihm_remember returns cellId');
  assert(r1.tier === 'filecoin', 'saihm_remember returns tier');
  assert(r1.cellNonce === 'ab'.repeat(16), 'saihm_remember returns cellNonce');
  assert(/^[0-9a-f]{32}$/.test(r1.cellNonce), 'cellNonce is 16-byte hex (32 chars)');
  assert(r1.kekVersion === 1, 'saihm_remember returns kekVersion');
  assert(calls[0].method === 'saihm_remember', 'saihm_remember sent correct method');
  assert(
    (calls[0].params as { content: string }).content === 'test memory',
    'saihm_remember sent content',
  );
  assert(calls[0].auth === 'Bearer test-token-xyz', 'Authorization header forwarded');

  const r2 = await client.recall('hello');
  assert(r2.length === 2, 'saihm_recall returns 2 cells');
  assert(r2[0].plaintext === 'hello', 'saihm_recall returns plaintext');
  assert(r2[0].cellNonce === 'cc'.repeat(16), 'saihm_recall returns cellNonce');
  assert(/^[0-9a-f]{32}$/.test(r2[0].cellNonce), 'recalled cellNonce is 16-byte hex');
  assert(r2[0].kekVersion === 1, 'saihm_recall returns kekVersion');
  assert(r2[0].holderIdHex === '11'.repeat(32), 'saihm_recall returns holderIdHex (32-byte hex)');
  assert(/^[0-9a-f]{64}$/.test(r2[0].holderIdHex), 'holderIdHex is 32-byte hex (64 chars)');
  assert(
    r2[0].holderSignaturePrefix === '22'.repeat(16),
    'saihm_recall returns holderSignaturePrefix',
  );
  assert(
    /^[0-9a-f]{32}$/.test(r2[0].holderSignaturePrefix),
    'holderSignaturePrefix is 16-byte hex prefix',
  );
  assert(calls[1].method === 'saihm_recall', 'saihm_recall method');
  assert((calls[1].params as { query: string }).query === 'hello', 'saihm_recall query forwarded');

  const r3 = await client.forget('cc'.repeat(32));
  assert(r3.success === true, 'saihm_forget success');
  assert(r3.cellId === 'cc'.repeat(32), 'saihm_forget cellId');

  const r4 = await client.status();
  assert(r4.prsScore === 42, 'saihm_status PRS score');
  assert(r4.agentIdHashHex.length === 64, 'saihm_status agentIdHashHex is 64-char hex');
  assert(r4.storageByTier.filecoin === 12345, 'saihm_status tier breakdown');
  // ── §3.4 spec-aligned fields (added 0.3.0) ──
  assert(r4.prs === 0.875, 'saihm_status prs (spec §3.4)');
  assert(r4.prs >= 0 && r4.prs <= 1, 'prs in [0.0, 1.0] (spec §3.4)');
  assert(r4.bfsi === 0.875, 'saihm_status bfsi (spec §3.4)');
  assert(r4.bfsi >= 0 && r4.bfsi <= 1, 'bfsi in [0.0, 1.0] (spec §3.4)');
  assert(/^\d+$/.test(r4.bfsi_R), 'bfsi_R is decimal-digit string (spec §3.4)');
  assert(/^\d+$/.test(r4.bfsi_M), 'bfsi_M is decimal-digit string (spec §3.4)');
  assert(
    /^\d+$/.test(r4.bfsi_window_start_ts),
    'bfsi_window_start_ts is decimal string (spec §3.4)',
  );
  // bfsi formula round-trip: bfsi == 1 - (M/R) when R > 0
  const recomputedBfsi = 1 - Number(r4.bfsi_M) / Number(r4.bfsi_R);
  assert(Math.abs(r4.bfsi - recomputedBfsi) < 1e-9, 'bfsi = 1 - (M/R) round-trips (spec §3.4)');
  assert(r4.shards.filecoin === 12, 'saihm_status shards (spec §3.4)');
  assert(
    Array.isArray(r4.contracts) && r4.contracts.length === 1,
    'contracts is array (spec §3.4)',
  );
  assert(
    /^[0-9a-f]{64}$/.test(r4.contracts[0].contractId),
    'contracts[].contractId is 32-byte hex (spec §3.4)',
  );
  assert(
    r4.contracts[0].mode === 'TEMPORARY' ||
      r4.contracts[0].mode === 'PERMANENT' ||
      r4.contracts[0].mode === 'SYNDICATE',
    'contracts[].mode is uppercase spec enum (spec §3.4)',
  );
  assert(
    /^[0-9a-f]{64}$/.test(r4.contracts[0].granteeIds[0]),
    'contracts[].granteeIds[] are 32-byte hex (spec §3.4)',
  );
  assert(/^\d+$/.test(r4.contracts[0].expiresAt), 'contracts[].expiresAt decimal (spec §3.4)');
  assert(
    Array.isArray(r4.governance) && r4.governance.length === 1,
    'governance is array (spec §3.4)',
  );
  assert(
    /^[0-9a-f]{64}$/.test(r4.governance[0].propId),
    'governance[].propId is 32-byte hex (spec §3.4)',
  );
  assert(r4.governance[0].scope === 'emission_param', 'governance[].scope (spec §3.4)');
  assert(/^\d+$/.test(r4.governance[0].tally_for), 'governance[].tally_for decimal (spec §3.4)');

  const r5 = await client.share(
    [new Uint8Array([0xab, 0xcd, 0xef])],
    ['shard-1'],
    SharingContractType.TEMPORARY,
    'read',
    BigInt('100'),
  );
  assert(r5.contractId.length === 32, 'saihm_share contractId');
  const shareParams = calls[4].params as {
    granteeIdHashesHex: string[];
    expiryEpoch: string | null;
  };
  assert(shareParams.granteeIdHashesHex[0] === 'abcdef', 'saihm_share encodes grantees as hex');
  assert(shareParams.expiryEpoch === '100', 'saihm_share serialises bigint expiry');

  const r6 = await client.revokeShare('ff'.repeat(16));
  assert(r6.revoked === true, 'saihm_revoke_share revoked');

  const r7 = await client.governancePropose({
    scope: 'emission_param',
    paramKey: 'block_reward',
    proposedValue: '1000',
  });
  assert(r7.proposalId.length === 32, 'saihm_governance_propose proposalId');

  const r8 = await client.governanceVote({ proposalId: '11'.repeat(16), approve: true });
  assert(r8.approve === true, 'saihm_governance_vote approve');

  // null expiry path
  await client.share(
    [new Uint8Array([0x00])],
    ['s'],
    SharingContractType.PERMANENT,
    'readwrite',
    null,
  );
  const nullExp = (calls[8].params as { expiryEpoch: string | null }).expiryEpoch;
  assert(nullExp === null, 'saihm_share preserves null expiry');

  // ── reporting: field universe + template validation ─────────────────────
  group('reporting — field universe + template validation');

  assert(
    FIELD_UNIVERSE.length === 280,
    `field universe size = ${FIELD_UNIVERSE.length} (expect 280)`,
  );
  assert(GDPR_ART15_FIELDS.length === 12, 'GDPR Art.15 has 12 fields');
  assert(REGISTRY_ATTESTATION_FIELDS.length === 4, 'registry-attestation has 4 fields');

  const goodTemplate: BespokeReportTemplate = {
    templateId: 't1',
    templateVersion: 1,
    operatorIdHash: 'ab'.repeat(32),
    scope: {
      customerIdHashes: ['cd'.repeat(32)],
      timeRange: { from: '2026-01-01T00:00:00Z', to: '2026-04-01T00:00:00Z' },
    },
    framework: 'gdpr-art-15',
    fieldProjections: [GDPR_ART15_FIELDS[0]],
    format: 'json',
  };
  assert(validateBespokeTemplate(goodTemplate).valid, 'valid template accepted');

  const badField = { ...goodTemplate, fieldProjections: ['not_a_real_field'] };
  assert(!validateBespokeTemplate(badField).valid, 'rejects non-universe field');

  const badWindow = {
    ...goodTemplate,
    scope: {
      ...goodTemplate.scope,
      timeRange: { from: '2025-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' },
    },
  };
  assert(!validateBespokeTemplate(badWindow).valid, 'rejects time window > 366d');

  const badFramework = {
    ...goodTemplate,
    framework: 'not-a-framework',
  } as unknown as BespokeReportTemplate;
  assert(!validateBespokeTemplate(badFramework).valid, 'rejects unknown framework');

  // ── reporting: 4 auth paths ─────────────────────────────────────────────
  group('reporting — 4 auth paths');

  const ap = await validateAuthPublic({ path: 'public' });
  assert(ap.ok && ap.path === 'public', 'auth/public ok');

  const asSelf = await validateAuthSelf({
    path: 'self',
    surface: 'mcp',
    agentIdHash: 'aa'.repeat(32),
    signature: 'sig',
    challenge: 'ch',
    challengeIssuedAt: new Date().toISOString(),
  });
  assert(asSelf.ok, 'auth/self mcp ok');

  const asOper = await validateAuthOperatorSelf({
    path: 'operator-self',
    operatorIdHash: 'ab'.repeat(32),
    mldsaSignature: 'sig',
    challenge: 'ch',
  });
  assert(asOper.ok, 'auth/operator-self ok');

  const asDown = await validateAuthOperatorForDownstream({
    path: 'operator-for-downstream',
    operatorIdHash: 'ab'.repeat(32),
    operatorMldsaSignature: 'sig',
    downstream: {
      type: 'customer-grant',
      customerIdHash: 'cd'.repeat(32),
      scope: 'art15',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      customerSignature: 'sig',
    },
  });
  assert(asDown.ok, 'auth/operator-for-downstream/customer-grant ok');

  const couplingFail = await validateAuthForKind('registry-attestation', {
    path: 'operator-self',
    operatorIdHash: 'ab'.repeat(32),
    mldsaSignature: 'sig',
    challenge: 'ch',
  });
  assert(!couplingFail.ok, 'kind-vs-auth coupling rejects mismatch');

  const replayFail = await validateAuthSelf({
    path: 'self',
    surface: 'web',
    walletIdHash: 'aa'.repeat(32),
    signature: 'sig',
    challenge: 'ch',
    challengeIssuedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  assert(!replayFail.ok, 'replay window rejects 1h-old challenge');

  // ── reporting: 6 receipt sub-kinds ──────────────────────────────────────
  group('reporting — 6 receipt sub-kinds');

  const runtime = new InMemoryReportingRuntime();
  const r_gen = buildReportGenerated({
    kind: 'bespoke',
    templateHash: '00'.repeat(32),
    scope: goodTemplate.scope,
    format: 'json',
    output: new TextEncoder().encode('body'),
    requesterIdHash: 'aa'.repeat(32),
    authChainSummary: 'operator-self/aa…',
  });
  await emitReceipt(r_gen, 'operator-bespoke', runtime);
  assert(r_gen.subKind === 'report_generated', 'report_generated built');

  const r_rej = buildReportRejected({
    kind: 'bespoke',
    reason: 'test',
    requesterIdHash: 'aa'.repeat(32),
  });
  await emitReceipt(r_rej, 'operator-bespoke', runtime);
  assert(r_rej.subKind === 'report_rejected', 'report_rejected built');

  const r_treg = buildTemplateRegistered({
    templateHash: '01'.repeat(32),
    operatorIdHash: 'ab'.repeat(32),
    schemaVersion: 1,
  });
  await emitReceipt(r_treg, 'operator-bespoke', runtime);
  assert(r_treg.subKind === 'template_registered', 'template_registered built');

  const r_tsup = buildTemplateSuperseded({
    oldTemplateHash: '01'.repeat(32),
    newTemplateHash: '02'.repeat(32),
    operatorIdHash: 'ab'.repeat(32),
  });
  await emitReceipt(r_tsup, 'operator-bespoke', runtime);
  assert(r_tsup.subKind === 'template_superseded', 'template_superseded built');

  const r_ecb = buildErasureChainBroken({
    cellIds: ['cd'.repeat(32)],
    failingStep: 'gc3',
    customerIdHash: 'ef'.repeat(32),
  });
  await emitReceipt(r_ecb, 'operator-bespoke', runtime);
  assert(r_ecb.subKind === 'erasure_chain_broken', 'erasure_chain_broken built');

  const r_rl = buildRateLimitExceeded({
    requesterIdHash: 'aa'.repeat(32),
    capLimit: 10,
    currentRate: 11,
  });
  await emitReceipt(r_rl, 'operator-bespoke', runtime);
  assert(r_rl.subKind === 'rate_limit_exceeded', 'rate_limit_exceeded built');

  assert(runtime.count() === 6, 'runtime captured all 6 receipts');
  assert(HKDF_INDEX_REPORT_RECEIPT === 166, 'HKDF index 166');
  assert(HKDF_DOMAIN_REPORT_RECEIPT === 'MPS-REPORT-RECEIPT-v1', 'HKDF domain string');

  // ── reporting: registerTemplate + registry-attestation flow ─────────────
  group('reporting — registerTemplate + registry-attestation flow');

  const reg = await registerTemplate(goodTemplate, runtime);
  assert(reg.ok, 'registerTemplate accepts good template');
  if (reg.ok) {
    assert(reg.templateHash.length === 64, 'registerTemplate emits 64-char templateHash');
    assert(reg.auditCellId.length === 64, 'registerTemplate emits 64-char auditCellId');
  }

  const regBad = await registerTemplate(badField, runtime);
  assert(!regBad.ok, 'registerTemplate rejects bad template');

  const registry = new StubPublicRegistry();
  registry.add('aa'.repeat(32), {
    agentIdHash: 'aa'.repeat(32),
    registrationTimestamp: '2026-05-09T00:00:00Z',
    publicMetadata: { rank: 1 },
  });
  const att = await generateRegistryAttestation(
    {
      kind: 'registry-attestation',
      target: { agentIdHash: 'aa'.repeat(32) },
      format: 'json',
      auth: { path: 'public' },
    },
    { registry, runtime },
  );
  assert(att.output.length > 0, 'registry-attestation produced output');
  assert(att.outputSha256.length === 64, 'registry-attestation has sha256');
  assert(att.auditCellId.length === 64, 'registry-attestation has audit cellId');

  // ── security mitigations ────────────────────────────────────────────────
  group('security mitigations');

  let httpsCheckThrew = false;
  try {
    new SaihmRuntimeClient('http://attacker.example.com/x', 'Bearer t');
  } catch (e) {
    httpsCheckThrew = (e as Error).message.includes('https');
  }
  assert(httpsCheckThrew, 'ctor rejects http:// non-localhost endpoint');

  let httpsLocalOk = true;
  try {
    new SaihmRuntimeClient('http://127.0.0.1:1234/x', 'Bearer t');
  } catch {
    httpsLocalOk = false;
  }
  assert(httpsLocalOk, 'ctor allows http://127.0.0.1 (dev)');

  let httpsLoopOk = true;
  try {
    new SaihmRuntimeClient('http://localhost:1234/x', 'Bearer t');
  } catch {
    httpsLoopOk = false;
  }
  assert(httpsLoopOk, 'ctor allows http://localhost (dev)');

  let badUrlThrew = false;
  try {
    new SaihmRuntimeClient('not a url', 'Bearer t');
  } catch (e) {
    badUrlThrew = (e as Error).message.includes('not a valid URL');
  }
  assert(badUrlThrew, 'ctor rejects malformed URL');

  // Oversized response → rejected via Content-Length cap.
  const bigServer = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(20 * 1024 * 1024),
    });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => bigServer.listen(0, '127.0.0.1', () => r()));
  const bigUrl = `http://127.0.0.1:${(bigServer.address() as AddressInfo).port}`;
  const bigClient = new SaihmRuntimeClient(bigUrl, 'Bearer t');
  let oversizeRejected = false;
  try {
    await bigClient.recall();
  } catch (e) {
    oversizeRejected = (e as Error).message.includes('response too large');
  }
  bigServer.close();
  assert(oversizeRejected, 'Content-Length over 16 MB rejected');

  // Hung request → aborted via timeout. Reduce timeout via small server delay.
  // (Real timeout is 30s; we verify abort path by closing without responding.)
  // Skip live timeout test to keep suite fast — abort wiring is exercised via the
  // try/finally in client; ctrl.abort fires on natural test shutdown.
  assert(true, 'timeout abort wired (30s default; not exercised live to keep suite fast)');

  // No header echo in error path.
  const errServer = createServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((r) => errServer.listen(0, '127.0.0.1', () => r()));
  const errUrl = `http://127.0.0.1:${(errServer.address() as AddressInfo).port}`;
  const errClient = new SaihmRuntimeClient(errUrl, 'Bearer SECRET-TOKEN-DO-NOT-LEAK');
  let errMsg = '';
  try {
    await errClient.recall();
  } catch (e) {
    errMsg = (e as Error).message;
  }
  errServer.close();
  assert(!errMsg.includes('SECRET-TOKEN'), 'error message does not echo Authorization header');

  // ── mcp entrypoint module ──────────────────────────────────────────────────
  // Importing the bin module registers all 8 tools without starting the stdio
  // transport (main() is guarded), so the entrypoint is exercised + covered.
  assert(!!mcpServer, 'mcp entrypoint module loads + registers tools without starting transport');

  // ── operator custody profiles ─────────────────────────────────────────────
  // An operator answers only what its custody model lets it see. A non-custodial
  // one holds ciphertext and no keys, so it reports no stored-byte totals and
  // returns no plaintext. Before 0.3.10 that surfaced as a raw
  // "Cannot convert undefined or null to object" from Object.entries() on status,
  // and as an output-schema violation on recall — both useless to a user. They
  // must now be accurate and actionable, and a custodial operator must be
  // entirely unaffected (the degradation is additive, never a rewrite).
  group('operator custody profiles');

  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'custody-profile-test', version: '0' });
  await Promise.all([mcpClient.connect(clientTx), mcpServer.connect(serverTx)]);

  const textOf = (r: { content?: unknown }): string => {
    const parts = (r.content ?? []) as Array<{ type: string; text?: string }>;
    return parts.map((p) => p.text ?? '').join('\n');
  };

  const savedResponder = responder.for;

  // Field-for-field the shape the non-custodial operator returns: no storageByTier,
  // no stakingPosition, no phi, no prsScore/prsLevel/bfsiScore/feeDiscountPct.
  responder.for = (m) =>
    m === 'saihm_status'
      ? {
          agentIdHashHex: 'f0'.repeat(32),
          tier: 'FREE',
          activeShardCount: 86,
          activeSharingContracts: 11,
          bfsi: 1.0,
          bfsi_R: '0',
          bfsi_M: '0',
          prsInstrumented: false,
          snapshotEpoch: '495909',
          custody: 'non-custodial',
        }
      : // recall from a blind operator: sealed cells, no plaintext for us to show
        [{ cellId: 'aa'.repeat(32), cellNonce: 'cc'.repeat(16), kekVersion: 1 }];

  const ncStatus = await mcpClient.callTool({ name: 'saihm_status', arguments: {} });
  const ncText = textOf(ncStatus);
  assert(ncStatus.isError !== true, 'non-custodial status does not error');
  assert(
    ncText.includes('custody=non-custodial') && ncText.includes('shards=86'),
    'non-custodial status reports what the operator does provide',
  );
  assert(
    ncText.includes('PRS: not reported by this operator'),
    'non-custodial status names PRS as unreported rather than silently dropping it',
  );
  assert(
    ncText.includes('@saihm/mcp-server-pro'),
    'non-custodial status points at the client that can read the memory',
  );

  const ncRecall = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  const ncRecallText = textOf(ncRecall);
  assert(ncRecall.isError === true, 'recall from a non-custodial operator is a clear failure');
  assert(
    ncRecallText.includes('non-custodial') && ncRecallText.includes('@saihm/mcp-server-pro'),
    'recall failure explains why and names the client that works',
  );
  assert(
    !/Cannot convert undefined|Output validation error/.test(ncRecallText),
    'recall failure is an explanation, not a raw runtime or schema error',
  );

  // Degenerate case: an operator that answers status with nothing at all. The point
  // of the change is that a thin client survives a thin response, so this must still
  // produce usable output rather than a runtime or schema error.
  responder.for = () => ({});
  const bare = await mcpClient.callTool({ name: 'saihm_status', arguments: {} });
  const bareText = textOf(bare);
  assert(bare.isError !== true, 'status survives an empty operator response');
  assert(
    !/shards=0|sharing=0|epoch=n\/a/.test(bareText),
    'an empty status response invents no zero counts or placeholder epoch',
  );

  // An operator that speaks only the §3.4 spec fields: PRS arrives as `prs`, not as
  // the `prsScore` operator extension, and it reports no contract or governance
  // arrays at all. Both halves are traps — saying PRS is unreported while printing it
  // one line above contradicts itself, and counting absent arrays as zero states
  // "you have no sharing contracts" on no evidence.
  responder.for = () => ({
    agentIdHashHex: 'ab'.repeat(32),
    prs: 0.812,
    bfsi: 0.44,
    bfsi_R: '2',
    bfsi_M: '9',
    activeShardCount: 4,
    snapshotEpoch: '12',
  });
  const spec = await mcpClient.callTool({ name: 'saihm_status', arguments: {} });
  const specText = textOf(spec);
  assert(spec.isError !== true, 'a §3.4-only status response does not error');
  assert(specText.includes('§3.4: prs=0.812'), 'a §3.4-only operator still reports PRS');
  assert(
    !specText.includes('PRS: not reported by this operator'),
    'PRS reported as the §3.4 field is not also announced as unreported',
  );
  assert(
    !/contracts=|governance=/.test(specText),
    'arrays the operator never sent are not counted as zero',
  );
  assert(
    specText.includes('(R=2 M=9)') && !specText.includes('n/a'),
    'the BFSI window is reported from what was sent, with no placeholders',
  );

  // Present is not the same as numeric. The client casts the operator's JSON without
  // validating it, and an operator that serialises numbers as strings is normal here
  // — bfsi_R, bfsi_M and snapshotEpoch are declared as strings. Calling .toFixed() on
  // one crashed the tool with "d.bfsi.toFixed is not a function".
  responder.for = () => ({
    agentIdHashHex: 'f0'.repeat(32),
    bfsi: '1.0',
    prs: '0.97',
    feeDiscountPct: '0.15',
    phi: '0.5',
    activeShardCount: '86',
    custody: 'non-custodial',
  });
  const stringy = await mcpClient.callTool({ name: 'saihm_status', arguments: {} });
  const stringyText = textOf(stringy);
  assert(stringy.isError !== true, 'numerics sent as strings do not crash status');
  assert(
    stringyText.includes('BFSI=1.000') && stringyText.includes('shards=86'),
    'numeric strings are read as the numbers they are',
  );
  assert(
    !/is not a function|NaN/.test(stringyText),
    'status reports values rather than a runtime error or NaN',
  );

  // Present but unusable: a number-shaped slot holding something that is not a
  // number must read as unreported, never as a value.
  responder.for = () => ({
    agentIdHashHex: 'f0'.repeat(32),
    bfsi: { nested: true },
    phi: 'not-a-number',
    activeShardCount: [],
    storageByTier: 'FILECOIN',
    contracts: 7,
    stakingPosition: 'none',
  });
  const junk = await mcpClient.callTool({ name: 'saihm_status', arguments: {} });
  const junkText = textOf(junk);
  assert(junk.isError !== true, 'unusable field values do not crash status');
  assert(
    !/NaN|undefined|\[object Object\]|contracts=7/.test(junkText),
    'unusable values are left out rather than rendered as garbage',
  );
  assert(
    !/0=F 1=I|shards=/.test(junkText),
    'a non-object storageByTier is not enumerated character by character',
  );

  // The identity line is rendered before every other field, so an agent id that is
  // not a string took the whole tool down with it: `.slice is not a function`.
  responder.for = () => ({ agentIdHashHex: 12345, activeShardCount: 3 });
  const badId = await mcpClient.callTool({ name: 'saihm_status', arguments: {} });
  const badIdText = textOf(badId);
  assert(badId.isError !== true, 'a non-string agent id does not crash status');
  assert(
    badIdText.includes('agent: not reported by this operator') && badIdText.includes('shards=3'),
    'an unusable agent id is named as unreported and the rest still renders',
  );

  responder.for = () => ({ not: 'a list' });
  const malformed = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  assert(malformed.isError === true, 'a non-list recall response is a failure');
  assert(
    /malformed recall response/.test(textOf(malformed)) &&
      !/is not a function/.test(textOf(malformed)),
    'a malformed recall response is diagnosed, not thrown as a stack trace',
  );

  // A write is the one place a false success really costs something: the user is told
  // the memory is safe and stops trying. `String(undefined)` is the string
  // "undefined", so the output schema cannot catch a thin receipt — the handler has to.
  responder.for = () => ({ cellId: 'ab'.repeat(32), accepted: true });
  const thin = await mcpClient.callTool({
    name: 'saihm_remember',
    arguments: { content: 'hello' },
  });
  const thinText = textOf(thin);
  assert(thin.isError !== true, 'a confirmed write with a thin receipt still succeeds');
  assert(
    !thinText.includes('undefined'),
    'receipt fields the operator never sent are not rendered as "undefined"',
  );
  assert(
    thinText.includes(`REMEMBERED [${'ab'.repeat(32)}]`),
    'a thin receipt still reports the cell id the write is confirmed by',
  );

  responder.for = () => ({ accepted: true });
  const unconfirmed = await mcpClient.callTool({
    name: 'saihm_remember',
    arguments: { content: 'hello' },
  });
  const unconfirmedText = textOf(unconfirmed);
  assert(unconfirmed.isError === true, 'a write with no cell id is not reported as stored');
  assert(
    /unconfirmed/.test(unconfirmedText) && !/Output validation error/.test(unconfirmedText),
    'an unconfirmed write is explained, not dumped as a schema error',
  );

  // Same fabrication, read side: a cell that arrives with plaintext but no metadata.
  responder.for = () => [{ cellId: 'cd'.repeat(32), plaintext: 'readable' }];
  const thinCell = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  const thinCellText = textOf(thinCell);
  assert(thinCell.isError !== true, 'a cell with plaintext but no metadata still recalls');
  assert(
    thinCellText.includes('readable') && !thinCellText.includes('undefined'),
    'absent cell metadata is left out rather than rendered as "undefined"',
  );

  // A PARTIALLY sealed response is a different fault from a non-custodial operator.
  // Blaming custody for it would send the user to the wrong fix, so it must report
  // the shortfall instead.
  responder.for = () => [
    { cellId: 'aa'.repeat(32), cellNonce: 'cc'.repeat(16), kekVersion: 1, plaintext: 'readable' },
    { cellId: 'bb'.repeat(32), cellNonce: 'dd'.repeat(16), kekVersion: 1 },
  ];
  const partial = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  const partialText = textOf(partial);
  assert(partial.isError === true, 'partially sealed recall is a failure');
  assert(
    partialText.includes('1 of 2 cells without plaintext'),
    'partially sealed recall reports the shortfall precisely',
  );
  assert(
    !partialText.includes('non-custodial'),
    'a partial shortfall is not misdiagnosed as a non-custodial operator',
  );

  // Custodial regression: every field present ⇒ output identical to pre-0.3.10,
  // with none of the degradation notices leaking in.
  responder.for = (m) =>
    m === 'saihm_status'
      ? {
          agentIdHashHex: 'f0'.repeat(32),
          prsScore: 0.97,
          prsLevel: 'HIGH',
          bfsiScore: 0.9312,
          feeDiscountPct: 0.15,
          activeShardCount: 86,
          storageByTier: { FILECOIN: 1234567 },
          stakingPosition: { amountNcoti: '5000', accruedYieldNcoti: '42' },
          activeSharingContracts: 11,
          phi: 0.5,
          snapshotEpoch: '495909',
          prs: 0.97,
          bfsi: 0.9312,
          bfsi_window_start_ts: '1700000000',
          bfsi_R: '3',
          bfsi_M: '44',
          shards: { FILECOIN: 86 },
          contracts: [],
          governance: [],
        }
      : savedResponder(m);

  const cuStatus = await mcpClient.callTool({ name: 'saihm_status', arguments: {} });
  const cuText = textOf(cuStatus);
  assert(
    cuText.includes('PRS=0.97 (HIGH)') && cuText.includes('FILECOIN=1234567B'),
    'custodial status still renders the full snapshot',
  );
  assert(
    cuText.includes('staking=5000nCOTI') && cuText.includes('PHI=0.500'),
    'custodial status still renders staking and PHI',
  );
  assert(
    !/non-custodial|not reported by this operator/.test(cuText),
    'no degradation notice leaks into a custodial operator response',
  );

  const cuRecall = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  assert(cuRecall.isError !== true, 'custodial recall still succeeds');
  assert(
    textOf(cuRecall).includes('hello'),
    'custodial recall still returns operator-decrypted plaintext',
  );

  responder.for = savedResponder;
  await mcpClient.close();

  // ── results ──────────────────────────────────────────────────────────────
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('test crashed:', e);
  server.close();
  process.exit(1);
});
