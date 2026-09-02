/**
 * Comprehensive functional test for @saihm/mcp-server bare-bones.
 * Covers:
 *   - All 8 MCP calls via SaihmRuntimeClient against a mock HTTP server
 *   - Reporting: 4 auth paths, 6 receipt sub-kinds, registry-attestation flow,
 *     template validation edge cases
 */

import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  resolveTargetSubject,
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
  operatorDownstreamMessage,
  selfChallengeMessage,
  operatorSelfChallengeMessage,
  checkKindAuthCoupling,
  chainSummaryIsUnverified,
  UNVERIFIED_MARKERS,
  GDPR_ART15_FIELDS,
  REGISTRY_ATTESTATION_FIELDS,
  FIELD_UNIVERSE,
  MAX_FIELD_PROJECTIONS,
  MAX_CUSTOMER_IDS_PER_SCOPE,
  MAX_TIME_WINDOW_DAYS,
  HKDF_INDEX_REPORT_RECEIPT,
  HKDF_DOMAIN_REPORT_RECEIPT,
  type BespokeReportTemplate,
  type AuditEmitResult,
  type AuthResult,
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

// Test-only gate on the operator's reply. The default returns undefined, so every
// case but the concurrent-dispatch one keeps the immediate reply path it has always
// had; that one case installs a real gate and restores this afterwards.
let holdOperatorReply: (method: string) => Promise<void> | undefined = () => undefined;

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body) as { method: string; params: unknown };
    calls.push({ method: parsed.method, params: parsed.params, auth: req.headers.authorization });
    const out = responder.for(parsed.method);
    const send = (): void => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    };
    const held = holdOperatorReply(parsed.method);
    if (held === undefined) send();
    else void held.then(send);
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

  // ---- R14-C/D/E/F: reporting auth ------------------------------------------
  // chainSummary is copied into the report_generated receipt as authChainSummary,
  // so a pass with no verifier wired must not be recorded the same way as a pass
  // where signatures were actually checked.
  assert(
    asDown.ok && asDown.chainSummary.includes('/customer-sig-unverified'),
    'R14-F an unverified customer grant is marked unverified in the audit summary',
  );
  assert(
    asOper.ok && asOper.chainSummary.includes('UNVERIFIED-shape-only'),
    'R14-F shape-only operator-self is marked unverified',
  );
  assert(
    asOper.ok && asOper.chainSummary.includes('/no-replay-window'),
    'R14-C an operator-self challenge with no issuedAt records that it was unbounded',
  );

  const downGrant = {
    path: 'operator-for-downstream' as const,
    operatorIdHash: 'ab'.repeat(32),
    operatorMldsaSignature: 'sig',
    downstream: {
      type: 'customer-grant' as const,
      customerIdHash: 'cd'.repeat(32),
      scope: 'art15',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      customerSignature: 'csig',
    },
  };

  // R14-D. The operator signature must commit to the claim. Capture the message the
  // verifier is handed and confirm the downstream fields are inside it — signing the
  // operator's own id made the signature a constant, valid for any later claim.
  let signedMessage = '';
  const capture = {
    verifyMlDsa: async (_s: string, m: string) => {
      signedMessage = m;
      return true;
    },
  };
  const bound = await validateAuthOperatorForDownstream(downGrant, capture);
  assert(bound.ok, 'R14-D operator-for-downstream still passes with a wired verifier');
  assert(
    signedMessage !== 'ab'.repeat(32),
    'R14-D operator no longer signs its own id as the whole message',
  );
  assert(
    signedMessage.includes('cd'.repeat(32)) &&
      signedMessage.includes('art15') &&
      signedMessage.includes('csig'),
    'R14-D the signed message binds customer, scope and the customer signature',
  );

  // Swapping the data subject must change the bytes, or one signature covers both.
  const swapped = {
    ...downGrant,
    downstream: { ...downGrant.downstream, customerIdHash: 'ef'.repeat(32) },
  };
  assert(
    operatorDownstreamMessage(swapped) !== operatorDownstreamMessage(downGrant),
    'R14-D re-pointing a grant at another data subject changes the signed bytes',
  );
  assert(
    operatorDownstreamMessage({
      path: 'operator-for-downstream',
      operatorIdHash: 'ab'.repeat(32),
      operatorMldsaSignature: 'sig',
      downstream: {
        type: 'legal-basis',
        subpoenaHash: 'cd'.repeat(32),
        jurisdiction: 'SG',
        publicRecordUrl: 'https://example.test/x',
      },
    }).includes('SG'),
    'R14-D a legal-basis claim is bound too, not only customer grants',
  );

  // R14-E. The customer half was checked for length and then thrown away.
  let customerAsked = false;
  const twoOfTwo = await validateAuthOperatorForDownstream(downGrant, {
    verifyMlDsa: async () => true,
    verifyCustomerGrant: async () => {
      customerAsked = true;
      return true;
    },
  });
  assert(customerAsked, 'R14-E the customer signature is actually verified');
  assert(
    twoOfTwo.ok && !twoOfTwo.chainSummary.includes('unverified'),
    'R14-E a real two-of-two carries no unverified marker',
  );

  const badCustomer = await validateAuthOperatorForDownstream(downGrant, {
    verifyMlDsa: async () => true,
    verifyCustomerGrant: async () => false,
  });
  assert(
    !badCustomer.ok && badCustomer.reason.includes('customer-grant signature'),
    'R14-E a bad customer signature fails closed',
  );

  // A legal-basis claim has no customer to sign, so it must not be marked as if it did.
  const legal = await validateAuthOperatorForDownstream(
    {
      path: 'operator-for-downstream',
      operatorIdHash: 'ab'.repeat(32),
      operatorMldsaSignature: 'sig',
      downstream: {
        type: 'legal-basis',
        subpoenaHash: 'cd'.repeat(32),
        jurisdiction: 'SG',
        publicRecordUrl: 'https://example.test/x',
      },
    },
    { verifyMlDsa: async () => true },
  );
  assert(
    legal.ok && !legal.chainSummary.includes('customer-sig-unverified'),
    'R14-E legal-basis is not flagged for a customer signature it never has',
  );

  // R29-D. A customer-grant expires on its own expiresAt. A legal-basis claim commits to
  // no point in time, so this path — the only operator route to an erasure-confirmation —
  // had no replay bound at all and, unlike operator-self, emitted no marker saying so.
  const legalAt = (issuedAt: string | undefined, now: number) =>
    validateAuthOperatorForDownstream(
      {
        path: 'operator-for-downstream',
        operatorIdHash: 'ab'.repeat(32),
        operatorMldsaSignature: 'sig',
        downstream: {
          type: 'legal-basis',
          subpoenaHash: 'cd'.repeat(32),
          jurisdiction: 'SG',
          publicRecordUrl: 'https://example.test/x',
        },
        ...(issuedAt === undefined ? {} : { challengeIssuedAt: issuedAt }),
      },
      { verifyMlDsa: async () => true },
      now,
    );
  const T0 = Date.parse('2026-08-26T00:00:00.000Z');
  assert(
    legal.ok && legal.chainSummary.includes('/no-replay-window'),
    'R29-D an unbounded legal-basis claim records that it is unbounded, as operator-self does',
  );
  const staleLegal = await legalAt(new Date(T0 - 31 * 60 * 1000).toISOString(), T0);
  assert(
    !staleLegal.ok && staleLegal.reason.includes('replay window'),
    'R29-D a legal-basis approval older than the replay window is refused, not honoured forever',
  );
  const freshLegal = await legalAt(new Date(T0 - 60 * 1000).toISOString(), T0);
  assert(
    freshLegal.ok && !freshLegal.chainSummary.includes('/no-replay-window'),
    'R29-D a bounded claim is accepted inside the window and is not marked unbounded',
  );
  assert(
    JSON.parse(
      operatorDownstreamMessage({
        path: 'operator-for-downstream',
        operatorIdHash: 'ab'.repeat(32),
        operatorMldsaSignature: 'sig',
        downstream: {
          type: 'legal-basis',
          subpoenaHash: 'cd'.repeat(32),
          jurisdiction: 'SG',
          publicRecordUrl: 'https://example.test/x',
        },
        challengeIssuedAt: '2026-08-26T00:00:00.000Z',
      }) as string,
    ).includes('2026-08-26T00:00:00.000Z'),
    'R29-D the time the claim was issued is inside the bytes the operator signs',
  );

  // R15-A. emitAudit is operator-supplied; its result is copied into the report as
  // auditCellId/auditSealHex. A runtime that returns nothing used to yield a report
  // asserting an audit anchor that was never created.
  const emptyReceipt = buildReportRejected({
    kind: 'registry-attestation',
    reason: 'test',
    requesterIdHash: '0'.repeat(64),
  });
  for (const [label, bad] of [
    ['null', null],
    ['an empty object', {}],
    ['a blank cellId', { cellId: '', sealHex: 'ab' }],
    ['a non-string sealHex', { cellId: 'ab', sealHex: 7 }],
  ] as ReadonlyArray<readonly [string, unknown]>) {
    let msg = '';
    try {
      await emitReceipt(emptyReceipt, 'framework-smoke', {
        emitAudit: async () => bad as AuditEmitResult,
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    assert(
      msg.includes('report_rejected') && msg.includes('unrecorded'),
      `R15-A an audit runtime returning ${label} is treated as unrecorded, not anchored`,
    );
  }

  const goodEmit = await emitReceipt(emptyReceipt, 'framework-smoke', {
    emitAudit: async () => ({ cellId: 'ab'.repeat(32), sealHex: 'cd'.repeat(32) }),
  });
  assert(
    goodEmit.cellId === 'ab'.repeat(32) && goodEmit.sealHex === 'cd'.repeat(32),
    'R15-A a well-formed audit result still passes through unchanged',
  );

  // R14-C. A stale operator challenge is now refused when it is dated at all.
  const staleOper = await validateAuthOperatorSelf({
    path: 'operator-self',
    operatorIdHash: 'ab'.repeat(32),
    mldsaSignature: 'sig',
    challenge: 'ch',
    challengeIssuedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
  });
  assert(
    !staleOper.ok && staleOper.reason.includes('replay window'),
    'R14-C an operator-self challenge older than the replay window is refused',
  );

  const freshOper = await validateAuthOperatorSelf(
    {
      path: 'operator-self',
      operatorIdHash: 'ab'.repeat(32),
      mldsaSignature: 'sig',
      challenge: 'ch',
      challengeIssuedAt: new Date().toISOString(),
    },
    { verifyMlDsa: async () => true },
  );
  assert(
    freshOper.ok && !freshOper.chainSummary.includes('no-replay-window'),
    'R14-C a dated, verified operator-self carries neither marker',
  );

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

  // ── R30-A. The refusal branches of the three signed auth paths ──────────
  // 52 lines across 23 blocks of reporting/auth.ts had never executed, and every one
  // of them is a refusal return. c8 passed the file at 91.14/78.26/100/91.14 against
  // an 80/65/80/80 gate, so coverage policy was never going to raise it. On a release
  // themed "treat operator and caller input as untrusted", nothing drove a single
  // refusal of the `self` path. Each case varies ONE field of a known-good payload
  // and asserts the reason that came back, not merely that it failed: a test that
  // checks only !ok still passes when an earlier guard fires for the wrong cause,
  // which is exactly how a reordered or collapsed check would hide from this suite.
  group('R30-A auth refusal paths');

  const reasonOf = (r: Awaited<ReturnType<typeof validateAuthSelf>>): string =>
    r.ok ? '<accepted>' : ((r as { reason?: string }).reason ?? '<no reason>');
  const soon = (ms: number): string => new Date(Date.now() + ms).toISOString();

  const selfOk = {
    path: 'self' as const,
    surface: 'web' as const,
    walletIdHash: 'aa'.repeat(32),
    signature: 'sig',
    challenge: 'ch',
    challengeIssuedAt: new Date().toISOString(),
  };
  assert(
    (await validateAuthSelf(selfOk)).ok,
    'R30-A positive control — the unmodified self payload is accepted, so each refusal below is caused by its own patch',
  );

  const selfCases: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    ['an unknown surface', { surface: 'api' }, 'invalid surface'],
    ['an empty signature', { signature: '' }, 'missing signature'],
    ['an empty challenge', { challenge: '' }, 'missing challenge'],
    [
      'an unparseable challengeIssuedAt',
      { challengeIssuedAt: 'the day before' },
      'invalid challengeIssuedAt',
    ],
    [
      'a challengeIssuedAt past the skew allowance',
      { challengeIssuedAt: soon(10 * 60 * 1000) },
      'challengeIssuedAt in future',
    ],
    ['a non-hex walletIdHash', { walletIdHash: 'zz'.repeat(32) }, 'missing or malformed'],
    [
      'a blank walletIdHash with no agentIdHash beside it',
      { walletIdHash: '' },
      'missing or malformed',
    ],
  ];
  for (const [label, patch, expected] of selfCases) {
    const r = await validateAuthSelf({ ...selfOk, ...patch } as never);
    assert(
      !r.ok && reasonOf(r).includes(expected),
      `R30-A self refuses ${label} as '${expected}' (got '${reasonOf(r)}')`,
    );
  }

  // The surface the caller names selects the verifier, so it also selects which
  // refusal they get. Both arms, and the fact that they differ — an operator reading
  // an audit log has to be able to tell which of the two verifiers did the rejecting.
  const refuseBoth = { verifyEip712: async () => false, verifyMlDsa: async () => false };
  const webFail = await validateAuthSelf(selfOk, refuseBoth);
  const mcpFail = await validateAuthSelf({ ...selfOk, surface: 'mcp' as const }, refuseBoth);
  assert(
    !webFail.ok && reasonOf(webFail).includes('EIP-712 signature verify failed'),
    `R30-A a wired EIP-712 verifier returning false refuses the web surface (got '${reasonOf(webFail)}')`,
  );
  assert(
    !mcpFail.ok && reasonOf(mcpFail).includes('ML-DSA signature verify failed'),
    `R30-A a wired ML-DSA verifier returning false refuses the mcp surface (got '${reasonOf(mcpFail)}')`,
  );
  assert(
    reasonOf(webFail) !== reasonOf(mcpFail),
    'R30-A the two surfaces refuse under distinct reasons, so the audit trail names the verifier that rejected',
  );

  const operOk = {
    path: 'operator-self' as const,
    operatorIdHash: 'ab'.repeat(32),
    mldsaSignature: 'sig',
    challenge: 'ch',
    challengeIssuedAt: new Date().toISOString(),
  };
  assert(
    (await validateAuthOperatorSelf(operOk)).ok,
    'R30-A positive control — the unmodified operator-self payload is accepted',
  );

  const operCases: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    [
      'a non-hex operatorIdHash',
      { operatorIdHash: 'zz'.repeat(32) },
      'operatorIdHash must be 64-hex',
    ],
    ['an empty mldsaSignature', { mldsaSignature: '' }, 'missing mldsaSignature'],
    ['an empty challenge', { challenge: '' }, 'missing challenge'],
    [
      'an unparseable challengeIssuedAt',
      { challengeIssuedAt: 'last tuesday' },
      'invalid challengeIssuedAt',
    ],
    [
      'a challengeIssuedAt past the skew allowance',
      { challengeIssuedAt: soon(10 * 60 * 1000) },
      'challengeIssuedAt in future',
    ],
  ];
  for (const [label, patch, expected] of operCases) {
    const r = await validateAuthOperatorSelf({ ...operOk, ...patch } as never);
    assert(
      !r.ok && reasonOf(r).includes(expected),
      `R30-A operator-self refuses ${label} as '${expected}' (got '${reasonOf(r)}')`,
    );
  }

  const downOk = {
    path: 'operator-for-downstream' as const,
    operatorIdHash: 'ab'.repeat(32),
    operatorMldsaSignature: 'sig',
    downstream: {
      type: 'customer-grant' as const,
      customerIdHash: 'cd'.repeat(32),
      scope: 'art15',
      expiresAt: soon(86_400_000),
      customerSignature: 'csig',
    },
  };
  assert(
    (await validateAuthOperatorForDownstream(downOk)).ok,
    'R30-A positive control — the unmodified operator-for-downstream payload is accepted',
  );

  const downTop: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    [
      'a non-hex operatorIdHash',
      { operatorIdHash: 'zz'.repeat(32) },
      'operatorIdHash must be 64-hex',
    ],
    [
      'an empty operatorMldsaSignature',
      { operatorMldsaSignature: '' },
      'missing operatorMldsaSignature',
    ],
    [
      'an unparseable challengeIssuedAt',
      { challengeIssuedAt: 'whenever' },
      'invalid challengeIssuedAt',
    ],
    [
      'a challengeIssuedAt past the skew allowance',
      { challengeIssuedAt: soon(10 * 60 * 1000) },
      'challengeIssuedAt in future',
    ],
  ];
  for (const [label, patch, expected] of downTop) {
    const r = await validateAuthOperatorForDownstream({ ...downOk, ...patch } as never);
    assert(
      !r.ok && reasonOf(r).includes(expected),
      `R30-A operator-for-downstream refuses ${label} as '${expected}' (got '${reasonOf(r)}')`,
    );
  }

  const grantCases: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    [
      'a non-hex customerIdHash',
      { customerIdHash: 'zz'.repeat(32) },
      'customerIdHash must be 64-hex',
    ],
    ['an empty scope', { scope: '' }, 'missing customer-grant scope'],
    ['an unparseable expiresAt', { expiresAt: 'never' }, 'invalid customer-grant expiresAt'],
    ['an expiresAt already in the past', { expiresAt: soon(-1000) }, 'customer-grant expired'],
    [
      'an empty customerSignature',
      { customerSignature: '' },
      'missing customer-grant customerSignature',
    ],
  ];
  for (const [label, patch, expected] of grantCases) {
    const r = await validateAuthOperatorForDownstream({
      ...downOk,
      downstream: { ...downOk.downstream, ...patch },
    } as never);
    assert(
      !r.ok && reasonOf(r).includes(expected),
      `R30-A a customer-grant carrying ${label} is refused as '${expected}' (got '${reasonOf(r)}')`,
    );
  }

  const legalOk = {
    ...downOk,
    downstream: {
      type: 'legal-basis' as const,
      subpoenaHash: 'cd'.repeat(32),
      jurisdiction: 'US-NY',
      publicRecordUrl: 'https://courts.example/1',
    },
  };
  assert(
    (await validateAuthOperatorForDownstream(legalOk)).ok,
    'R30-A positive control — the unmodified legal-basis payload is accepted',
  );
  for (const [label, patch, expected] of [
    ['a non-hex subpoenaHash', { subpoenaHash: 'zz'.repeat(32) }, 'subpoenaHash must be 64-hex'],
    ['no jurisdiction', { jurisdiction: '' }, 'missing legal-basis jurisdiction'],
  ] as ReadonlyArray<[string, Record<string, unknown>, string]>) {
    const r = await validateAuthOperatorForDownstream({
      ...legalOk,
      downstream: { ...legalOk.downstream, ...patch },
    } as never);
    assert(
      !r.ok && reasonOf(r).includes(expected),
      `R30-A a legal-basis claim with ${label} is refused as '${expected}' (got '${reasonOf(r)}')`,
    );
  }

  const operSigFail = await validateAuthOperatorForDownstream(downOk, {
    verifyMlDsa: async () => false,
    verifyCustomerGrant: async () => true,
  });
  assert(
    !operSigFail.ok && reasonOf(operSigFail).includes('operator ML-DSA signature verify failed'),
    `R30-A a wired operator verifier returning false refuses the disclosure (got '${reasonOf(operSigFail)}')`,
  );

  // B1-A. One condition — `now - issuedMs > REPLAY_WINDOW_MS` — is applied at three
  // sites, and until this release two of them said 'challenge expired (replay window
  // 30min)' while the third said 'challengeIssuedAt outside replay window'. An operator
  // classifying refusals had to match two strings for one cause. The divergent one was
  // introduced unreleased in this same hardening pass, so aligning it broke no shipped
  // contract; the surviving wording is the one that has been shipped since v0.1.0. This
  // asserts the three agree, so the next path to grow a replay check has a reference.
  // Deliberately literal. auth.ts derives this message from REPLAY_WINDOW_MS, so this
  // is the only place the window is written out by hand — retuning the constant fails
  // here, which is the point. Deriving it on both sides would agree with itself forever.
  const expiredReason = 'challenge expired (replay window 30min)';
  const expiredSelf = await validateAuthSelf({
    ...selfOk,
    challengeIssuedAt: soon(-31 * 60 * 1000),
  });
  const expiredOper = await validateAuthOperatorSelf({
    ...operOk,
    challengeIssuedAt: soon(-31 * 60 * 1000),
  });
  const expiredDown = await validateAuthOperatorForDownstream({
    ...downOk,
    challengeIssuedAt: soon(-31 * 60 * 1000),
  });
  for (const [label, r] of [
    ['self', expiredSelf],
    ['operator-self', expiredOper],
    ['operator-for-downstream', expiredDown],
  ] as ReadonlyArray<[string, Awaited<ReturnType<typeof validateAuthSelf>>]>) {
    assert(
      !r.ok && reasonOf(r) === expiredReason,
      `B1-A ${label} refuses a stale challenge under the one shared reason (got '${reasonOf(r)}')`,
    );
  }

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

  // R15-C. Registry records are free-form data from a PUBLIC registry, so whoever
  // registered the agent chooses them. In CSV they used to be interpolated bare.
  // registrationTimestamp is typed `string` and never date-validated, so it becomes a
  // whole cell — which is what makes a leading '=' executable when an auditor opens
  // the export. A formula nested inside the metadata object is inert by comparison,
  // because that cell starts with '{'; the top-level string field is the real vector.
  registry.add('bb'.repeat(32), {
    agentIdHash: 'bb'.repeat(32),
    registrationTimestamp: "=cmd|' /c calc'!A1",
    publicMetadata: { note: 'plain', other: 'a,b"c' },
  });
  const csvAtt = await generateRegistryAttestation(
    {
      kind: 'registry-attestation',
      target: { agentIdHash: 'bb'.repeat(32) },
      format: 'csv',
      auth: { path: 'public' },
    },
    { registry, runtime },
  );
  const csv = new TextDecoder().decode(csvAtt.output);
  const metaRow = csv
    .split('\n')
    .find((l) => l.startsWith('"registry_attestation_public_metadata"'));
  assert(metaRow !== undefined, 'R15-C the metadata row is still present and keyed');
  assert(
    csv.includes(`"'=cmd`) && !/,"=cmd/.test(csv),
    'R15-C a formula-leading cell is neutralised, not left executable',
  );
  // Every field quoted and every embedded quote doubled is exactly RFC 4180, and it
  // is what stops a comma inside a value from spilling into an extra column.
  assert(
    /^"(?:[^"]|"")*","(?:[^"]|"")*"$/.test(metaRow ?? ''),
    'R15-C the metadata row is two properly quoted fields, not more',
  );
  assert(csv.includes('""'), 'R15-C embedded quotes are doubled per RFC 4180');

  // The JSON form must be unaffected — only the CSV framing was broken.
  const jsonAtt = await generateRegistryAttestation(
    {
      kind: 'registry-attestation',
      target: { agentIdHash: 'bb'.repeat(32) },
      format: 'json',
      auth: { path: 'public' },
    },
    { registry, runtime },
  );
  assert(
    JSON.parse(new TextDecoder().decode(jsonAtt.output))
      .registry_attestation_registration_timestamp === "=cmd|' /c calc'!A1",
    'R15-C the JSON attestation still carries the value verbatim',
  );

  // R16-A. Which identifier identifies a target used to be decided three times with
  // two different notions of present: the guard tested truthiness, the resolver and
  // the receipt scope used `??`, which treats '' as a value. So an empty agentIdHash
  // alongside a real cellId passed the guard and was then resolved — and recorded —
  // under '' instead of the cellId.
  assert(
    resolveTargetSubject({ agentIdHash: '', cellId: 'cc'.repeat(32) }) === 'cc'.repeat(32) &&
      resolveTargetSubject({ agentIdHash: 'aa'.repeat(32), cellId: 'cc'.repeat(32) }) ===
        'aa'.repeat(32) &&
      resolveTargetSubject({ agentIdHash: '', cellId: '' }) === undefined &&
      resolveTargetSubject({}) === undefined,
    'R16-A an empty-string identifier is absent, not a value, and agentIdHash still wins',
  );

  registry.add('cc'.repeat(32), {
    cellId: 'cc'.repeat(32),
    registrationTimestamp: '2026-05-09T00:00:00Z',
    publicMetadata: { rank: 2 },
  });
  const blankAgent = await generateRegistryAttestation(
    {
      kind: 'registry-attestation',
      target: { agentIdHash: '', cellId: 'cc'.repeat(32) },
      format: 'json',
      auth: { path: 'public' },
    },
    { registry, runtime },
  );
  assert(
    blankAgent.receipt.subKind === 'report_generated' &&
      blankAgent.receipt.scope.customerIdHashes[0] === 'cc'.repeat(32),
    'R16-A the receipt scope names the identifier actually used, never an empty string',
  );

  let blankBothMsg = '';
  try {
    await generateRegistryAttestation(
      {
        kind: 'registry-attestation',
        target: { agentIdHash: '', cellId: '' },
        format: 'json',
        auth: { path: 'public' },
      },
      { registry, runtime },
    );
  } catch (e) {
    blankBothMsg = (e as Error).message;
  }
  assert(
    blankBothMsg.includes('invalid target'),
    'R16-A two empty identifiers are rejected as an invalid target, not looked up',
  );

  // R16-B. The reject paths emit a receipt and then throw. Once emitReceipt was made
  // to throw on an unusable audit result (R15-A), an unguarded await there replaced
  // the rejection reason outright — so an operator with a broken audit ledger saw
  // "audit emission failed" for every bad credential and never learned it was bad.
  const brokenAudit = { emitAudit: async () => ({}) as AuditEmitResult };
  let maskedMsg = '';
  try {
    await generateRegistryAttestation(
      {
        kind: 'registry-attestation',
        target: { agentIdHash: 'aa'.repeat(32) },
        format: 'json',
        auth: { path: 'self', customerIdHash: 'aa'.repeat(32) } as never,
      },
      { registry, runtime: brokenAudit },
    );
  } catch (e) {
    maskedMsg = (e as Error).message;
  }
  assert(
    maskedMsg.startsWith('registry-attestation: auth rejected:'),
    'R16-B the auth rejection is still the primary error when the audit ledger is broken',
  );
  assert(
    maskedMsg.includes('rejection receipt could not be recorded'),
    'R16-B and the audit failure is reported too, as context rather than as the cause',
  );

  // R16-C. The rejection message used to say "262-field universe" while enforcement
  // ran against all 280 (262 framework + 18 ledger), so an operator debugging a
  // rejection counted the wrong boundary. The size is now read from the set itself.
  const universeErr = validateBespokeTemplate(badField).errors.join(' ');
  assert(
    universeErr.includes(`${FIELD_UNIVERSE.length}-field universe`) &&
      !universeErr.includes('262-field'),
    'R16-C the universe rejection names the boundary actually enforced',
  );
  assert(
    FIELD_UNIVERSE.length === 280 && new Set(FIELD_UNIVERSE).size === 280,
    'R16-C the universe is 280 distinct fields, so the derived message cannot drift',
  );

  // R18-A. publicRecordUrl is signed into the operator's message and kept as the
  // auditor's evidence link. new URL() alone accepts javascript:, data: and file:, so
  // a "public record" could dereference to the local filesystem or run as script in an
  // audit UI. The runtime client already refuses a non-https endpoint.
  const legalBase = {
    path: 'operator-for-downstream' as const,
    operatorIdHash: 'ab'.repeat(32),
    operatorMldsaSignature: 's',
    downstream: {
      type: 'legal-basis' as const,
      subpoenaHash: 'cd'.repeat(32),
      jurisdiction: 'US-NY',
      publicRecordUrl: 'https://courts.example/1',
    },
  };
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x']) {
    const r = await validateAuthOperatorForDownstream({
      ...legalBase,
      downstream: { ...legalBase.downstream, publicRecordUrl: bad },
    });
    assert(
      !r.ok,
      `R18-A a ${bad.split(':')[0]}: publicRecordUrl is refused, not signed as evidence`,
    );
  }
  assert(
    (await validateAuthOperatorForDownstream(legalBase)).ok &&
      (
        await validateAuthOperatorForDownstream({
          ...legalBase,
          downstream: { ...legalBase.downstream, publicRecordUrl: 'http://courts.example/1' },
        })
      ).ok,
    'R18-A http and https public records are still accepted',
  );
  const malformedUrl = await validateAuthOperatorForDownstream({
    ...legalBase,
    downstream: { ...legalBase.downstream, publicRecordUrl: 'not a url' },
  });
  assert(
    !malformedUrl.ok && (malformedUrl as { reason: string }).reason.includes('invalid'),
    'R18-A an unparseable publicRecordUrl is still refused as invalid',
  );
  const badType = await validateAuthOperatorForDownstream({
    ...legalBase,
    downstream: { type: 'other' } as never,
  });
  assert(!badType.ok, 'R18 an unrecognised downstream.type is refused');

  // Coverage: the not-found reject path returns the cause, not an audit error.
  let notFoundMsg = '';
  try {
    await generateRegistryAttestation(
      {
        kind: 'registry-attestation',
        target: { cellId: 'ff'.repeat(32) },
        format: 'pdfa3',
        auth: { path: 'public' },
      },
      { registry, runtime },
    );
  } catch (e) {
    notFoundMsg = (e as Error).message;
  }
  assert(
    notFoundMsg === 'registry-attestation: target not found',
    'R18 an unresolvable target reports not-found, with no audit-plumbing detail appended',
  );

  // pdfa3 is a documented placeholder on this smoke kind; the bytes say so themselves.
  const pdfaAtt = await generateRegistryAttestation(
    {
      kind: 'registry-attestation',
      target: { agentIdHash: 'aa'.repeat(32) },
      format: 'pdfa3',
      auth: { path: 'public' },
    },
    { registry, runtime },
  );
  assert(
    new TextDecoder().decode(pdfaAtt.output).startsWith('%PDF-A3 PLACEHOLDER'),
    'R18 the pdfa3 placeholder labels itself as a placeholder in its own first bytes',
  );

  // R17-A. Operators wire ONE verifyMlDsa for every path. The self and operator-self
  // paths used to verify a signature over the caller-supplied `challenge` alone, so any
  // string that operator had ever signed passed — including an operatorDownstreamMessage
  // observed on the wire. That lifted a routine downstream approval into operator-self,
  // which reaches audit-export and billing-history; operator-for-downstream does not.
  const downstreamAuth = {
    path: 'operator-for-downstream' as const,
    operatorIdHash: 'ab'.repeat(32),
    operatorMldsaSignature: 'sig-observed-on-the-wire',
    downstream: {
      type: 'legal-basis' as const,
      subpoenaHash: 'cd'.repeat(32),
      jurisdiction: 'US-NY',
      publicRecordUrl: 'https://courts.example/1',
    },
  };
  const liftedMessage = operatorDownstreamMessage(downstreamAuth);
  // A verifier that accepts exactly the one message/signature pair the operator issued.
  const oneSigOperator = {
    verifyMlDsa: async (sig: string, message: string) =>
      sig === 'sig-observed-on-the-wire' && message === liftedMessage,
  };
  assert(
    (await validateAuthOperatorForDownstream(downstreamAuth, oneSigOperator)).ok,
    'R17-A the operator signature is still valid for the downstream disclosure it authorised',
  );
  const lifted = await validateAuthOperatorSelf(
    {
      path: 'operator-self',
      operatorIdHash: 'ab'.repeat(32),
      mldsaSignature: 'sig-observed-on-the-wire',
      challenge: liftedMessage,
    },
    oneSigOperator,
  );
  assert(
    !lifted.ok,
    'R17-A a downstream signature replayed as an operator-self challenge is refused',
  );
  assert(
    operatorSelfChallengeMessage({
      path: 'operator-self',
      operatorIdHash: 'ab'.repeat(32),
      mldsaSignature: 'x',
      challenge: 'c',
      challengeIssuedAt: '2026-07-29T00:00:00Z',
    }) !==
      operatorSelfChallengeMessage({
        path: 'operator-self',
        operatorIdHash: 'ab'.repeat(32),
        mldsaSignature: 'x',
        challenge: 'c',
        challengeIssuedAt: '2026-07-29T00:10:00Z',
      }),
    'R17-A the signed message commits to challengeIssuedAt, so a replay cannot be re-dated',
  );
  assert(
    selfChallengeMessage(
      {
        path: 'self',
        surface: 'mcp',
        signature: 's',
        challenge: 'c',
        challengeIssuedAt: 'T',
        agentIdHash: 'ef'.repeat(32),
      } as never,
      'ef'.repeat(32),
    ).startsWith('["SAIHM-REPORT-SELF-v1"'),
    'R17-A the self path has its own domain tag, distinct from every other path',
  );

  // R17-B. `??` treats '' as a value, so a blank walletIdHash beside a valid
  // agentIdHash refused a legitimate request. Same rule as R16-A.
  const blankWallet = await validateAuthSelf({
    path: 'self',
    surface: 'mcp',
    signature: 's',
    challenge: 'c',
    challengeIssuedAt: new Date().toISOString(),
    walletIdHash: '',
    agentIdHash: 'ef'.repeat(32),
  } as never);
  assert(
    blankWallet.ok,
    'R17-B a blank walletIdHash falls through to a valid agentIdHash instead of refusing',
  );

  // R17-C. The coupling table is keyed by ReportKind, but the type is gone at runtime
  // and this is an exported function: an unknown kind indexed to undefined and threw
  // a TypeError out of the authorization check rather than refusing.
  const unknownKind = checkKindAuthCoupling('not-a-kind' as never, 'public');
  assert(
    !unknownKind.ok && (unknownKind.reason ?? '').includes('unknown report kind'),
    'R17-C an unrecognised report kind is refused, not a crash inside the coupling check',
  );
  const unknownViaDispatcher = await validateAuthForKind('not-a-kind' as never, { path: 'public' });
  assert(
    !unknownViaDispatcher.ok,
    'R17-C the dispatcher refuses an unknown kind before reaching any validator',
  );

  // R19-A. registerTemplate hashed the template with
  // JSON.stringify(template, Object.keys(template).sort()). An array second argument is a
  // property ALLOWLIST applied at every nesting depth, not a key order, so `scope` and
  // `filters` both serialized as {} and the templateHash committed to neither. That hash
  // is the durable identity of a registration: it is what template_registered records and
  // what both halves of template_superseded reference.
  const narrowReg = await registerTemplate(goodTemplate, runtime);
  const wideReg = await registerTemplate(
    {
      ...goodTemplate,
      scope: {
        customerIdHashes: ['cd'.repeat(32), 'ef'.repeat(32), 'ab'.repeat(32)],
        timeRange: { from: '2020-01-01T00:00:00Z', to: '2020-12-01T00:00:00Z' },
      },
    },
    runtime,
  );
  assert(
    narrowReg.ok && wideReg.ok && narrowReg.templateHash !== wideReg.templateHash,
    'R19-A widening the customer scope and the time window changes the template identity',
  );

  const sameAgain = await registerTemplate({ ...goodTemplate }, runtime);
  assert(
    narrowReg.ok && sameAgain.ok && narrowReg.templateHash === sameAgain.templateHash,
    'R19-A an identical template still hashes identically',
  );

  const reordered = await registerTemplate(
    {
      format: goodTemplate.format,
      scope: {
        timeRange: goodTemplate.scope.timeRange,
        customerIdHashes: goodTemplate.scope.customerIdHashes,
      },
      fieldProjections: goodTemplate.fieldProjections,
      framework: goodTemplate.framework,
      operatorIdHash: goodTemplate.operatorIdHash,
      templateVersion: goodTemplate.templateVersion,
      templateId: goodTemplate.templateId,
    } as BespokeReportTemplate,
    runtime,
  );
  assert(
    narrowReg.ok && reordered.ok && narrowReg.templateHash === reordered.templateHash,
    'R19-A key declaration order is not identity; the canonical form sorts at every level',
  );

  const withFilters = await registerTemplate(
    { ...goodTemplate, filters: { region: 'EU' } } as BespokeReportTemplate,
    runtime,
  );
  assert(
    narrowReg.ok && withFilters.ok && narrowReg.templateHash !== withFilters.templateHash,
    'R19-A filters are part of what was registered, so they change the hash too',
  );

  // An explicitly-undefined optional is the same template as an absent one — zod reads
  // both as absent and JSON.stringify omits both, so the identity must not fork on it.
  const undefinedFilters = await registerTemplate(
    { ...goodTemplate, filters: undefined } as BespokeReportTemplate,
    runtime,
  );
  assert(
    narrowReg.ok && undefinedFilters.ok && narrowReg.templateHash === undefinedFilters.templateHash,
    'R19-A an explicitly-undefined optional field is absent, not a distinct template',
  );

  // R29-A. Validation strips unknown keys, so the shape that was validated and the shape
  // that was hashed were not the same shape. A key outside the schema — nothing validated
  // it, nothing caps it, nothing reads it — still changed templateHash, which is the
  // durable identity of the registration: what `template_registered` records and what
  // both halves of `template_superseded` reference. This is the invariant asserted
  // directly above, applied to a field that was never part of the template at all.
  const withUnknownKey = await registerTemplate(
    { ...goodTemplate, attackerControlled: 'x'.repeat(64) } as unknown as BespokeReportTemplate,
    runtime,
  );
  assert(
    narrowReg.ok && withUnknownKey.ok && narrowReg.templateHash === withUnknownKey.templateHash,
    'R29-A a key outside the schema is not part of the template, so it cannot change its identity',
  );

  // R19-B. `surface` is caller-supplied and it selects the verifier. An operator wiring
  // only verifyMlDsa for their MCP surface had a web-surfaced request match neither
  // branch and still return ok:true — any signature over any bytes authorised it, on a
  // path audit-export and billing-history both accept.
  const mldsaOnly = { verifyMlDsa: async () => true };
  const eip712Only = { verifyEip712: async () => true };
  const freshSelf = {
    path: 'self',
    surface: 'web',
    signature: 'anything-at-all',
    challenge: 'c',
    challengeIssuedAt: new Date().toISOString(),
    agentIdHash: 'ef'.repeat(32),
  };

  const downgradedWeb = await validateAuthSelf(freshSelf as never, mldsaOnly as never);
  assert(
    !downgradedWeb.ok,
    'R19-B a surface with no verifier wired is refused, not waved through as shape-only',
  );

  const matchedSurface = await validateAuthSelf(
    { ...freshSelf, surface: 'mcp' } as never,
    mldsaOnly as never,
  );
  assert(matchedSurface.ok, 'R19-B the surface the operator did wire still verifies and passes');

  const downgradedMcp = await validateAuthSelf(
    { ...freshSelf, surface: 'mcp' } as never,
    eip712Only as never,
  );
  assert(
    !downgradedMcp.ok,
    'R19-B the downgrade is refused in the other direction too, not only for web',
  );

  const shapeOnlySelf = await validateAuthSelf(freshSelf as never);
  assert(
    shapeOnlySelf.ok && shapeOnlySelf.chainSummary.includes('UNVERIFIED'),
    'R19-B with no verifier wired at all, shape-only mode is unchanged and still says so',
  );

  // R20-A/B. README is the only document an operator reads before wiring this library,
  // and it described the authorization validators without disclosing that they return
  // ok:true with no signature checked when no verifier is injected — the most dangerous
  // default in the package, stated as its opposite. It also described the response cap
  // as depending on a Content-Length the sender controls, understating a control an
  // auditor would then file a finding against. Pinned here rather than left to drift:
  // every number and enum below is read from the code, so the doc cannot fall out of
  // step with it silently the way the '262-field universe' message did in R16-C.
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
  assert(
    readme.includes('/UNVERIFIED-shape-only') && /shape-only/.test(readme),
    'R20-A README discloses that an unwired verifier yields a shape-only, unauthorised pass',
  );
  assert(
    /Content-Length[\s\S]{0,400}?stream/i.test(readme),
    'R20-B README states the size cap holds without a truthful Content-Length',
  );
  assert(
    readme.includes(`${FIELD_UNIVERSE.length} fields`),
    'R20-A the README field count is the real one',
  );
  assert(
    readme.includes(`max ${MAX_CUSTOMER_IDS_PER_SCOPE.toLocaleString('en-US')} per template`) &&
      readme.includes(`≤ ${MAX_TIME_WINDOW_DAYS} days`) &&
      readme.includes(`length 1–${MAX_FIELD_PROJECTIONS}`),
    'R20-A the README caps are the real ones',
  );
  for (const f of ['pdfa3', 'json', 'csv']) {
    assert(readme.includes(`\`${f}\``), `R20-A README lists the real format '${f}'`);
  }

  // R21-B. The R20-B correction landed in README and nowhere else, so the identical
  // understatement survived in ARCHITECTURE.md (x3), HARDENING.md (x2) and
  // ASSURANCE_CASE.md (x1) — one class, six siblings, exactly the failure mode this
  // review keeps rediscovering. Any shipped doc that describes the response cap must
  // describe the streamed half too, or it tells a reviewer the cap depends on a header
  // the sender controls.
  const repoFile = (n: string): string =>
    readFileSync(fileURLToPath(new URL(`../${n}`, import.meta.url)), 'utf8');
  // R22-A. The first version of this check was per-FILE ("the doc mentions streaming
  // somewhere"), which passed the moment one section was corrected while ASSURANCE_CASE
  // line 84 still described the cap as Content-Length-only. A file-level assertion
  // cannot catch a per-claim defect. This is per-CLAIM: every line that describes the
  // cap must have the streamed half within its own wrapped block. CHANGELOG.md is
  // deliberately excluded — its entries describe what shipped at the time, and the
  // streamed cap did not exist at 0.1.0.
  // R23-I adds .bestpractices.json: it answers the OpenSSF badge criteria in prose, two of
  // those answers described the cap as Content-Length-only, and it was not in this list —
  // the same partial sweep this check exists to prevent, one file outside the net.
  const SHIPPED_DOCS = [
    'README.md',
    'ARCHITECTURE.md',
    'HARDENING.md',
    'ASSURANCE_CASE.md',
    '.bestpractices.json',
  ];
  for (const doc of SHIPPED_DOCS) {
    const lines = repoFile(doc).split('\n');
    lines.forEach((line, i) => {
      if (!/Content-Length/.test(line)) return;
      if (!/\bcap\b|rejected|reject,|16 MB/i.test(line)) return;
      // Whitespace-normalized: joining wrapped lines preserves their leading indentation,
      // so a phrase split across a line break reassembles with several spaces in it and a
      // single-space pattern misses it. That produced two false positives on first run.
      const window = lines
        .slice(i, i + 5)
        .join(' ')
        .replace(/\s+/g, ' ');
      assert(
        /stream|chunked/i.test(window),
        `R22-A ${doc}:${i + 1} describes the response cap with the streamed half it enforces`,
      );
    });
  }

  // R22-B/C. Two claims that were false in every doc that made them: tag signing (the
  // release tags are lightweight, so they hold no signature at all) and "npm publish
  // requires 2FA" (publishing runs from Actions over OIDC, with no npm token and no
  // interactive 2FA). Asserted as absences, because the honest wording is a gap
  // statement and there is no single phrase to match on.
  for (const doc of SHIPPED_DOCS) {
    const body = repoFile(doc);
    assert(
      !/tags are signed|Git tags signed|git tag -s\b/i.test(body),
      `R22-B ${doc} does not claim signed release tags while the tags are lightweight`,
    );
    assert(
      !/publish requires 2FA/i.test(body),
      `R22-C ${doc} does not claim npm publish requires 2FA on an OIDC publish path`,
    );
  }

  // R21-C. ASSURANCE_CASE.md hands an independent reviewer exact strings to grep for in
  // package.json. When the scripts changed, the checklist silently became a set of
  // instructions that fail — which reads to a reviewer as a failed control, not a stale
  // doc. Pinned against the real scripts so they cannot drift apart again.
  const pkgScripts = (JSON.parse(repoFile('package.json')) as { scripts: Record<string, string> })
    .scripts;
  const assuranceDoc = repoFile('ASSURANCE_CASE.md');
  for (const s of ['prepack', 'prepublishOnly']) {
    assert(
      assuranceDoc.includes(`${s}: "${pkgScripts[s]}"`),
      `R21-C ASSURANCE_CASE quotes the real ${s} script a reviewer will actually find`,
    );
  }

  // R23-A. On 2026-07-25 the Independent Submissions Editor concluded consideration of
  // draft-saihm-memory-protocol and released it from the queue; the datatracker stream is
  // now None. README was corrected at the time and nothing else was — so GOVERNANCE,
  // CONTRIBUTING, SECURITY, ARCHITECTURE and .bestpractices.json went on telling readers
  // the spec "is being progressed via the IETF Independent Submission Stream". That is a
  // live standing claim about IETF status in the project's governance documents, which is
  // exactly the kind of claim a reviewer or funder checks. Per-claim, not per-file: every
  // line that invokes the ISE or the Independent Submission Stream must carry the outcome
  // within its own wrapped block. CHANGELOG.md is excluded — its entries are dated and
  // describe status as it stood on that date.
  const STATUS_DOCS = [
    'README.md',
    'ARCHITECTURE.md',
    'HARDENING.md',
    'ASSURANCE_CASE.md',
    'GOVERNANCE.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CITATION.cff',
    '.bestpractices.json',
  ];
  for (const doc of STATUS_DOCS) {
    const lines = repoFile(doc).split('\n');
    lines.forEach((line, i) => {
      if (!/Independent Submission|\bISE\b/.test(line)) return;
      const window = lines
        .slice(i, i + 6)
        .join(' ')
        .replace(/\s+/g, ' ');
      assert(
        /2026-07-25|released it from the queue|no IETF stream/i.test(window),
        `R23-A ${doc}:${i + 1} states the ISE outcome alongside the ISE claim`,
      );
    });
  }
  // The specific present-tense phrasings that were false. Absence assertions, because the
  // honest replacement is a paragraph and there is no one phrase to match.
  for (const doc of STATUS_DOCS) {
    const body = repoFile(doc);
    assert(
      !/is being progressed|being progressed (via|through)|IETF ISE |In ISE Review/i.test(body),
      `R23-A ${doc} does not describe the draft as currently progressing on an IETF stream`,
    );
  }

  // R23-B. CITATION.cff said version 0.3.1 / 2026-05-28 while npm was on 0.3.10, and
  // server.json carries the version twice. Nothing checked any of them against
  // package.json, so each release had three chances to drift and no way to notice. The
  // fix that matters is not the one-time correction, it is this assertion.
  const pkgVersion = (JSON.parse(repoFile('package.json')) as { version: string }).version;
  const serverJson = JSON.parse(repoFile('server.json')) as {
    version: string;
    packages: { version: string }[];
  };
  assert(serverJson.version === pkgVersion, 'R23-B server.json version tracks package.json');
  assert(
    serverJson.packages.every((p) => p.version === pkgVersion),
    'R23-B every server.json package version tracks package.json',
  );
  const citationVersion = /^version:\s*'([^']+)'/m.exec(repoFile('CITATION.cff'))?.[1];
  assert(citationVersion === pkgVersion, 'R23-B CITATION.cff version tracks package.json');

  // R23-C/D. GOVERNANCE.md is the authoritative document, and it disagreed with the two
  // documents that describe the same controls: it said the project follows the Contributor
  // Covenant "without adopting its full text" (CODE_OF_CONDUCT.md is the full v2.1 text,
  // and CONTRIBUTING.md says it is adopted), and it said DCO sign-off "may be requested for
  // substantial contributions" while CONTRIBUTING.md requires it on every commit and
  // HARDENING.md lists it as an enforced control that gets PRs rejected. A contributor
  // reading the governing document would have concluded sign-off was optional.
  const governance = repoFile('GOVERNANCE.md');
  assert(
    !/without adopting its full text/i.test(governance),
    'R23-C GOVERNANCE does not disclaim adopting the Covenant that ships in full',
  );
  for (const doc of ['GOVERNANCE.md', 'CONTRIBUTING.md', 'HARDENING.md']) {
    assert(
      !/DCO process may be requested|may be requested for substantial/i.test(repoFile(doc)),
      `R23-D ${doc} does not describe DCO sign-off as optional`,
    );
  }

  // R23-E. HARDENING.md's preamble promises every entry is enforced in shipped code. The
  // bullet titled "No cryptographic primitives in this repo" was refuted by package.json:
  // @noble/hashes is a direct runtime dependency and sha256 is imported in
  // reporting/index.ts and reporting/receipt.ts. The sentence under it (no keys, no
  // derivation, no AEAD) was true; the title was not.
  const deps = Object.keys(
    (JSON.parse(repoFile('package.json')) as { dependencies: Record<string, string> }).dependencies,
  );
  if (deps.some((d) => /noble|crypto|hash/i.test(d))) {
    assert(
      !/No cryptographic primitives in this repo/i.test(repoFile('HARDENING.md')),
      'R23-E HARDENING does not deny all primitives while shipping a crypto dependency',
    );
  }

  // R23-H. HARDENING.md said SAIHM_ENDPOINT_URL is parsed "at startup" and that a
  // malformed URL causes "an immediate fatal error". Neither is true: getRuntime() builds
  // the client lazily on the first tool call, so a bad endpoint starts cleanly, serves
  // tools/list, and only fails when the agent tries to remember something. That gap
  // matters to an operator deciding how they will find out about a misconfiguration.
  // Asserted against the code, not against prose: as long as the server holds no
  // module-level client, no doc may promise startup-time validation.
  const serverSource = repoFile('saihm_mcp_server.ts');
  const lazyClient = /if\s*\(!runtime\)\s*runtime\s*=\s*SaihmRuntimeClient\.bootFromEnv\(\)/.test(
    serverSource,
  );
  assert(lazyClient, 'R23-H the runtime client is still constructed lazily on first use');
  if (lazyClient) {
    for (const doc of STATUS_DOCS) {
      assert(
        !/(URL constructor|is parsed)[^.]*at startup|immediate\s+fatal/i.test(
          repoFile(doc).replace(/\s+/g, ' '),
        ),
        `R23-H ${doc} does not promise startup-time config validation on a lazy client`,
      );
    }
  }

  // R23-G. smithery.yaml told users to get SAIHM_ENDPOINT_URL from saihm.coti.global/join,
  // while server.json told them that is the wrong endpoint for this package (the hosted
  // service is non-custodial; it needs @saihm/mcp-server-pro). Whichever is right, the two
  // registry manifests cannot answer the same question differently.
  assert(
    !/coti\.global\/join/i.test(repoFile('smithery.yaml')),
    'R23-G smithery.yaml does not point SAIHM_ENDPOINT_URL at the non-custodial hosted service',
  );

  // R23-K. saihm_share's description advertised "TEMPORARY/PERMANENT/SYNDICATE" — the
  // TypeScript enum's key names — against a case-sensitive z.enum of the lowercase values.
  // The description is what an agent reads to decide what to send, so it was steering
  // callers into a rejection. Checked against the schema literals in the source rather
  // than against a copy of them, so the two cannot drift apart again.
  const shareBlock = serverSource.slice(
    serverSource.indexOf("'saihm_share'"),
    serverSource.indexOf('annotations:', serverSource.indexOf("'saihm_share'")),
  );
  const enumLiterals = [
    ...new Set(
      [...shareBlock.matchAll(/z\.enum\(\[([^\]]+)\]\)/g)].flatMap((m) =>
        [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]),
      ),
    ),
  ];
  assert(enumLiterals.includes('temporary'), 'R23-K located the share contract-type enum');
  for (const v of enumLiterals) {
    assert(
      !new RegExp(`\\b${v.toUpperCase()}\\b`).test(shareBlock),
      `R23-K saihm_share does not advertise '${v}' in a casing its schema rejects`,
    );
  }

  // R24-A/B. CHANGELOG.md opens by promising that all notable changes are documented here.
  // Two versions broke that in opposite directions: 0.1.1 was published to npm with no
  // entry and no link at all, and 0.1.3 had a full entry plus a `/releases/tag/v0.1.3`
  // link for a version that was never published and never tagged — so the one reference a
  // reader would click was the one that 404s. Headings and link definitions must agree,
  // both ways.
  const changelog = repoFile('CHANGELOG.md');
  // A heading marked NEVER PUBLISHED is the one case where no link is the honest answer —
  // there is no release to link to, and inventing one is how 0.1.3 came to carry a 404.
  const headingLines = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\].*$/gm)];
  const headingVersions = headingLines.map((m) => m[1]);
  const unreleased = headingLines.filter((m) => /NEVER PUBLISHED/i.test(m[0])).map((m) => m[1]);
  const linkVersions = [...changelog.matchAll(/^\[(\d+\.\d+\.\d+)\]:/gm)].map((m) => m[1]);
  for (const v of headingVersions) {
    if (unreleased.includes(v)) {
      assert(!linkVersions.includes(v), `R24-A CHANGELOG ${v} is unreleased and links nowhere`);
      continue;
    }
    assert(linkVersions.includes(v), `R24-A CHANGELOG ${v} heading has a link definition`);
  }
  for (const v of linkVersions) {
    assert(headingVersions.includes(v), `R24-A CHANGELOG ${v} link definition has a heading`);
  }
  // And the version about to ship must be written up before it can ship.
  assert(
    headingVersions.includes(pkgVersion),
    `R24-B CHANGELOG documents the current package version ${pkgVersion}`,
  );

  // R24-C/D/E. The distribution-integrity claims were written from a single spot check of
  // the newest release and then stated universally. Verified against npm and git: sigstore
  // provenance exists only on 0.3.6-0.3.10 (the ten earlier versions were hand-published
  // and carry none); 0.1.1 has no git tag; v0.3.2, v0.3.4 and v0.3.5 have tags but no
  // GitHub Release; and of the fourteen tags, eight are annotated-but-unsigned rather than
  // lightweight. Every universal phrasing below was false in the artifact when written.
  for (const doc of STATUS_DOCS) {
    const body = repoFile(doc).replace(/\s+/g, ' ');
    assert(
      !/Every published npm version has a matching GitHub Release/i.test(body),
      `R24-C ${doc} does not claim a GitHub Release for every published version`,
    );
    assert(
      !/binds each published tarball|bind each published tarball/i.test(body),
      `R24-E ${doc} does not claim provenance binds every published tarball`,
    );
    assert(
      !/lightweight and therefore unsigned|these are lightweight tags/i.test(body),
      `R24-D ${doc} does not describe all release tags as lightweight`,
    );
    assert(
      !/^.*Releases are signed via npm sigstore/i.test(body),
      `R24-E ${doc} does not claim all releases carry a provenance attestation`,
    );
  }

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

  // R29-E. This message used to quote the offending value. Only a string that failed
  // to parse as a URL reaches it, so the value is always the wrong one, and the wrong
  // one that matters is SAIHM_AUTH_HEADER pasted into the neighbouring variable. The
  // SDK puts a thrown message verbatim into an isError tool result, so quoting it put
  // the token in the model's context and in the transcript. Planted here as a token
  // rather than as generic text, because a token is the case with consequences.
  const planted = 'Bearer eyJhbGciOiJIUzI1NiJ9.PLANTED-SECRET.SIG';
  let plantedMsg = '';
  try {
    new SaihmRuntimeClient(planted, 'Bearer t');
  } catch (e) {
    plantedMsg = (e as Error).message;
  }
  assert(
    plantedMsg.includes('not a valid URL'),
    'R29-E a malformed endpoint is still diagnosed as a malformed endpoint',
  );
  assert(
    !plantedMsg.includes('PLANTED-SECRET') && !plantedMsg.includes(planted),
    'R29-E the rejected value is not echoed into a message the model and transcript see',
  );
  assert(
    plantedMsg.includes('SAIHM_ENDPOINT_URL') && plantedMsg.includes('SAIHM_AUTH_HEADER'),
    'R29-E the message names the variables, so it stays diagnosable without the value',
  );

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

  // R14-A. The Content-Length check is only an early-out. A chunked response has no
  // Content-Length header at all, so the header check reads 0 and passes it through —
  // which is every streaming reply, since Node omits the header unless asked to send
  // it. Before the streamed cap this body was buffered whole, with no limit.
  const chunkedBig = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); // no content-length
    const mb = Buffer.alloc(1024 * 1024, 0x20);
    let n = 0;
    const pump = (): void => {
      // Stop on the client's disconnect, otherwise this writes 17 MB into a closed
      // socket and the test process eats the EPIPE.
      if (n++ >= 17 || res.destroyed) return void res.end();
      res.write(mb, () => pump());
    };
    res.on('error', () => {});
    pump();
  });
  await new Promise<void>((r) => chunkedBig.listen(0, '127.0.0.1', () => r()));
  const chunkedUrl = `http://127.0.0.1:${(chunkedBig.address() as AddressInfo).port}`;
  let chunkedRejected = false;
  try {
    await new SaihmRuntimeClient(chunkedUrl, 'Bearer t').recall();
  } catch (e) {
    chunkedRejected = (e as Error).message.includes('while still streaming');
  }
  chunkedBig.close();
  assert(chunkedRejected, 'R14-A chunked response over 16 MB rejected (no Content-Length)');

  // The cap must not have been bought by breaking the ordinary path: a chunked reply
  // under the limit still has to parse, and a multi-byte character split across two
  // chunks must survive. Decoding each chunk on its own would corrupt it here.
  // `plaintext` is the field RecalledCell actually declares and the client actually
  // reads. This fixture used `content`, which is on no contract anywhere — the
  // assertion below passed only because JSON.parse keeps unknown keys, so a test
  // claiming "UTF-8 intact" was checking a field nothing consumes. Typechecking the
  // test suite (R20-D) is what surfaced it.
  const splitPayload = Buffer.from(JSON.stringify([{ cellId: 'ab', plaintext: 'café' }]), 'utf8');
  const lead = splitPayload.findIndex((b) => b >= 0xc0);
  const chunkedOk = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write(splitPayload.subarray(0, lead + 1)); // splits the é mid-character
    res.end(splitPayload.subarray(lead + 1));
  });
  await new Promise<void>((r) => chunkedOk.listen(0, '127.0.0.1', () => r()));
  const okUrl = `http://127.0.0.1:${(chunkedOk.address() as AddressInfo).port}`;
  const okCells = await new SaihmRuntimeClient(okUrl, 'Bearer t').recall();
  chunkedOk.close();
  assert(lead > 0, 'R14-A fixture actually contains a multi-byte character');
  assert(
    Array.isArray(okCells) && okCells.length === 1 && okCells[0].plaintext === 'café',
    'R14-A chunked reply under the cap parses, UTF-8 intact across the chunk boundary',
  );

  // R14-B. A 200 carrying HTML is a proxy or captive portal answering, not the
  // operator. The bare parser error names neither the endpoint nor the body.
  const htmlServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('<!doctype html><title>Sign in to the network</title>');
  });
  await new Promise<void>((r) => htmlServer.listen(0, '127.0.0.1', () => r()));
  const htmlUrl = `http://127.0.0.1:${(htmlServer.address() as AddressInfo).port}`;
  let htmlMsg = '';
  try {
    await new SaihmRuntimeClient(htmlUrl, 'Bearer t').recall();
  } catch (e) {
    htmlMsg = (e as Error).message;
  }
  htmlServer.close();
  assert(
    htmlMsg.includes('non-JSON response') && htmlMsg.includes('<!doctype html>'),
    'R14-B non-JSON 200 names the endpoint and quotes the body',
  );

  const emptyServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end();
  });
  await new Promise<void>((r) => emptyServer.listen(0, '127.0.0.1', () => r()));
  const emptyUrl = `http://127.0.0.1:${(emptyServer.address() as AddressInfo).port}`;
  let emptyMsg = '';
  try {
    await new SaihmRuntimeClient(emptyUrl, 'Bearer t').recall();
  } catch (e) {
    emptyMsg = (e as Error).message;
  }
  emptyServer.close();
  assert(emptyMsg.includes('(empty body)'), 'R14-B empty 200 body reported as empty, not parsed');

  // Hung request → aborted via timeout. Reduce timeout via small server delay.
  // (Real timeout is 30s; we verify abort path by closing without responding.)
  // Skip live timeout test to keep suite fast — abort wiring is exercised via the
  // try/finally in client; ctrl.abort fires on natural test shutdown.
  {
    // This case used to assert a bare literal — an assertion that always passed,
    // counted toward the suite total, and was cited by ASSURANCE_CASE.md as the
    // verification for the availability claim. The control was real; the evidence was
    // not. It is exercised for real now that the abort window is injectable. The old
    // form is described rather than reproduced, so a sweep for self-certifying
    // assertions does not return this comment as a hit.
    const hung = createServer(() => {
      /* accept the request and never answer */
    });
    await new Promise<void>((r) => hung.listen(0, '127.0.0.1', () => r()));
    const hungPort = (hung.address() as AddressInfo).port;
    const started = Date.now();
    const hungClient = new SaihmRuntimeClient(
      `http://127.0.0.1:${hungPort}/mcp`,
      'Bearer SECRET-TOKEN-DO-NOT-LEAK',
      60,
    );
    let abortMsg = '';
    try {
      await hungClient.status();
    } catch (e) {
      abortMsg = (e as Error).message;
    }
    const elapsed = Date.now() - started;
    assert(/timed out after 60ms/.test(abortMsg), 'R26-B a hung operator aborts the call');
    assert(
      elapsed < 5_000,
      'R26-B the abort fires on its own window rather than waiting on the socket',
    );
    assert(
      !abortMsg.includes('SECRET-TOKEN-DO-NOT-LEAK'),
      'R26-B the timeout message does not echo the Authorization header',
    );
    assert(
      /unknown whether the operator acted on it/.test(abortMsg),
      'R26-B the timeout message says the outcome is unknown rather than implying failure',
    );
    // The shipped default must stay 30s — the injectable window is for testing, not a
    // quiet reduction of the documented limit.
    assert(
      /REQUEST_TIMEOUT_MS = 30_000/.test(repoFile('saihm_runtime_client.ts')) &&
        /timeoutMs: number = REQUEST_TIMEOUT_MS/.test(repoFile('saihm_runtime_client.ts')),
      'R26-B the default abort window is still the documented 30s',
    );
    await new Promise<void>((r) => hung.close(() => r()));
  }

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

  // ── advertised tool surface ───────────────────────────────────────────────
  // R29-F. Every other test in this file calls a tool by name, so the suite proved
  // the tools BEHAVE and never once read what the server ADVERTISES. tools/list is
  // the only part a client sees before it calls anything, and nothing here had ever
  // called it. A ninth tool, a renamed or dropped tool, a lost annotation or a lost
  // outputSchema all passed a full green run. Asserted against the live client that
  // is already connected above rather than by reading the module's internals, since
  // what matters is what crosses the transport.
  group('advertised tool surface');

  const advertised = (await mcpClient.listTools()).tools;
  const advertisedNames = advertised.map((t) => t.name).sort();

  // The eight-tool cap is an architectural invariant, not a coincidence of the
  // current file. Stated as the exact set, because a count alone still passes when
  // one tool is dropped and another added.
  assert(
    JSON.stringify(advertisedNames) ===
      JSON.stringify([
        'saihm_forget',
        'saihm_governance_propose',
        'saihm_governance_vote',
        'saihm_recall',
        'saihm_remember',
        'saihm_revoke_share',
        'saihm_share',
        'saihm_status',
      ]),
    `R29-F the server advertises exactly the eight protocol tools (got ${advertisedNames.join(',')})`,
  );

  // A client decides whether to confirm with a user before an irreversible call by
  // reading this hint. saihm_forget destroys a DEK: there is nothing to undo
  // afterwards, so losing the hint silently is losing the confirmation prompt.
  const forgetTool = advertised.find((t) => t.name === 'saihm_forget');
  assert(
    forgetTool?.annotations?.destructiveHint === true,
    'R29-F saihm_forget still advertises itself as destructive, so clients still confirm',
  );
  assert(
    advertised.every((t) => t.annotations !== undefined && t.description !== undefined),
    'R29-F every advertised tool carries annotations and a description',
  );

  // R31-A. Tool descriptions are injected into every session's context, on a product whose
  // headline claim is FEWER context tokens — so expanding them taxes exactly what SAIHM
  // sells. The ratified budget is <=750 tokens for all eight descriptions combined,
  // measured here in characters. The ratio is NOT the conventional 4.0: HR-2's own measured
  // pair (1451 chars = ~383 tokens) gives 3.789 chars/token for this corpus, so a 3000-char
  // cap would have permitted ~792 tokens and quietly overshot the ratified 750. The cap is
  // 750 * 3.789 = 2841. This is a CAP, not a target: 0.3.12 spends 2029 (~536 tok, 71%).
  // The count is asserted first so a suite that advertised fewer tools could not pass this
  // by shrinking the denominator.
  assert(advertised.length === 8, 'R31-A budget is measured over all eight tools');
  const descChars = advertised.reduce((n, t) => n + (t.description ?? '').length, 0);
  assert(
    descChars <= 2841,
    `R31-A tool descriptions stay within the ~750-token budget (${descChars}/2841 chars)`,
  );

  // R31-B. Two surfaces, two caps: package.json is npm (<=120) and server.json is the MCP
  // Registry, whose schema carries maxLength 100. An over-length string is a clean
  // pre-publish failure in `mcp-publisher validate`, but only if someone runs it — this
  // fails in the suite instead. Asserted as PREFIX, not equality: the ratified phrase is
  // shared, while each package appends its own differentiator, so an equality check here
  // would fail the sibling package's legitimately longer description.
  const RATIFIED =
    'Enterprise-ready portable memory for AI agents: encrypted, shareable, provably erased.';
  const registryManifest: { description?: string } = JSON.parse(
    readFileSync(fileURLToPath(new URL('../server.json', import.meta.url)), 'utf8'),
  );
  const regDesc = registryManifest.description ?? '';
  assert(
    regDesc.startsWith(RATIFIED),
    'R31-B server.json description opens with the ratified positioning phrase',
  );
  assert(
    regDesc.length <= 100,
    `R31-B server.json description fits the registry maxLength (${regDesc.length}/100)`,
  );

  // Three of the eight return structured output. Which three is a contract with any
  // consumer that reads structuredContent, and dropping one degrades that consumer
  // to text parsing without failing anything else.
  const structured = advertised
    .filter((t) => t.outputSchema !== undefined)
    .map((t) => t.name)
    .sort();
  assert(
    JSON.stringify(structured) ===
      JSON.stringify(['saihm_recall', 'saihm_remember', 'saihm_status']),
    `R29-F the same three tools still declare an outputSchema (got ${structured.join(',')})`,
  );

  // Record<string, unknown> rather than { content?: unknown }: the SDK's CallToolResult
  // is a union whose other arm carries `toolResult` instead of `content`, and a weak
  // object type shares no property with it, so every one of the ~70 call sites was a
  // type error the moment the tests were actually typechecked. Both arms carry the
  // index signature, so this accepts either and still reads `content` honestly.
  const textOf = (r: Record<string, unknown>): string => {
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

  // ── the wire decides what these five tools receive ────────────────────────
  // remember/recall/status were hardened in 0.3.10; forget, share, revoke_share
  // and the governance pair still read the operator response as if the declared
  // types were guaranteed. They are not — the client casts the JSON without
  // validating it. Three failure shapes matter here, and only the first is loud:
  //   crash   — `.slice()` on a non-string, a stack trace where a diagnosis belongs
  //   garbage — `${r.epoch}` rendering the literal "undefined" as if it were a value
  //   FALSE CONFIRMATION — the dangerous one. These tools report erasure, access
  //           withdrawal and recorded votes: claims a user cannot check afterwards
  //           and stops checking once told. A headline that says the thing happened
  //           on a receipt that never said so is worse than an error.
  group('unguarded operator responses (forget / share / governance)');

  // ---- saihm_forget -------------------------------------------------------
  responder.for = () => ({ success: true });
  const forgetThin = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: 'ab'.repeat(32) },
  });
  assert(forgetThin.isError === true, 'erasure with no cell id is not reported as done');
  assert(
    /possibly still stored/.test(textOf(forgetThin)) && !/FORGOTTEN/.test(textOf(forgetThin)),
    'an unconfirmed erasure says the memory may still exist instead of announcing FORGOTTEN',
  );

  responder.for = () => null;
  const forgetNull = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: 'ab'.repeat(32) },
  });
  assert(forgetNull.isError === true, 'a malformed erasure response is a failure');
  assert(
    /unknown whether/.test(textOf(forgetNull)) &&
      !/is not a function|Cannot read/.test(textOf(forgetNull)),
    'a malformed erasure response is diagnosed, not thrown as a stack trace',
  );

  responder.for = () => ({ success: false });
  const forgetMiss = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: 'ab'.repeat(32) },
  });
  assert(forgetMiss.isError !== true, 'an already-destroyed entry is reported, not errored');
  assert(
    /not found or already destroyed/.test(textOf(forgetMiss)),
    'an already-destroyed entry says so',
  );

  // `success: false` is an answer; a missing or non-boolean success is not. Reporting
  // the second as "not found or already destroyed" would state a cause the operator
  // never gave — both are safe for the user, but only one is a fact.
  responder.for = () => ({ cellId: 'ab'.repeat(32) });
  const forgetNoFlag = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: 'ab'.repeat(32) },
  });
  const forgetNoFlagText = textOf(forgetNoFlag);
  assert(
    /UNCONFIRMED/.test(forgetNoFlagText) &&
      !/not found or already destroyed/.test(forgetNoFlagText),
    'a missing success flag is reported as unconfirmed, not as a definite already-destroyed',
  );
  assert(!/FORGOTTEN/.test(forgetNoFlagText), 'a missing success flag never announces an erasure');

  // ── R29-C: a receipt identifier is structure, so it must not be able to become
  // more structure. ──
  //
  // `FORGOTTEN [<id>] DEK destroyed` is a receipt, and the handler refuses to print it
  // without an id precisely because erasure is the one claim in this surface nobody can
  // check afterwards. An id was the only operator value here that reached the output with
  // no shape check, so an operator could close the bracket, finish the sentence and open
  // a second receipt inside it — attesting an erasure of a cell that was never asked
  // about and never erased. Measured before the fix: two well-formed FORGOTTEN lines out
  // of one call. Reading a cell's plaintext back cannot do this; plaintext prints after a
  // `|` on an indented recall line, never as a receipt of its own.
  const askedFor = 'aa'.repeat(32);
  const neverErased = 'bb'.repeat(32);
  responder.for = () => ({
    success: true,
    cellId: `${askedFor}] DEK destroyed\nFORGOTTEN [${neverErased}`,
  });
  const forged = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: askedFor },
  });
  const forgedText = textOf(forged);
  assert(
    !forgedText.includes(neverErased),
    'R29-C a forged receipt id cannot attest the erasure of a cell that was never erased',
  );
  assert(
    forgedText.split('\n').filter((l) => /^FORGOTTEN \[/.test(l)).length === 0,
    'R29-C an unusable cell id announces no erasure at all, forged or otherwise',
  );

  // The same field, the other way it stops being an identifier. An id is quoted back so
  // it can be handed to saihm_forget; refused rather than truncated, because a shortened
  // one cannot be. MAX_RECEIPT_ID_LEN is the bound, so probe past it rather than naming
  // a number here.
  responder.for = () => ({ success: true, cellId: 'A'.repeat(5000) });
  const oversized = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: askedFor },
  });
  const oversizedText = textOf(oversized);
  assert(
    !/FORGOTTEN/.test(oversizedText) && oversizedText.length < 1000,
    'R29-C an id longer than the receipt-id bound is refused, not echoed into the transcript',
  );

  responder.for = () => ({ success: true, cellId: 'cd'.repeat(32), destructionAnchor: 12345 });
  const forgetBadAnchor = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: 'cd'.repeat(32) },
  });
  const forgetBadAnchorText = textOf(forgetBadAnchor);
  assert(forgetBadAnchor.isError !== true, 'a non-string destruction anchor does not crash forget');
  assert(
    /FORGOTTEN \[cdcd/.test(forgetBadAnchorText) && !/undefined|anchor=/.test(forgetBadAnchorText),
    'an unusable anchor is left out rather than crashed on or printed as "undefined"',
  );

  responder.for = () => ({
    success: true,
    cellId: 'ef'.repeat(32),
    destructionAnchor: '9a'.repeat(32),
    epoch: '495912',
  });
  const forgetOk = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: 'ef'.repeat(32) },
  });
  const forgetOkText = textOf(forgetOk);
  assert(
    /FORGOTTEN \[efef/.test(forgetOkText) &&
      /anchor=9a9a/.test(forgetOkText) &&
      /epoch=495912/.test(forgetOkText),
    'a full erasure receipt renders the cell id, anchor and epoch',
  );
  assert(!/undefined/.test(forgetOkText), 'a full erasure receipt contains no "undefined"');

  // ---- saihm_recall cell ids ---------------------------------------------
  // Declared z.string(), so a numeric or absent id fails output-schema validation after
  // the recall has otherwise succeeded — the user gets a raw schema error naming a path
  // into an object they never saw. And an id that cannot be quoted back cannot be handed
  // to saihm_forget, which is most of what recall is for.
  responder.for = () => [
    { cellId: 12345, plaintext: 'readable but unaddressable' },
    { cellId: 'ab'.repeat(32), plaintext: 'fine' },
  ];
  const recallBadId = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  const recallBadIdText = textOf(recallBadId);
  assert(recallBadId.isError === true, 'a cell with an unusable id is a failure, not a partial');
  assert(
    /1 of 2 cells with no usable cell id/.test(recallBadIdText),
    'an unusable cell id is counted precisely rather than reported vaguely',
  );
  assert(
    /saihm_forget/.test(recallBadIdText) && !/Output validation error/.test(recallBadIdText),
    'an unusable cell id is diagnosed by consequence, not dumped as a schema error',
  );

  // Partially sealed, and the sealed one carries no id either. Two cells, not one: with
  // a single sealed cell the all-sealed branch fires first and diagnoses custody, which
  // is a different fault and reaches none of this.
  responder.for = () => [
    { cellNonce: 'cc'.repeat(16) },
    { cellId: 'ab'.repeat(32), plaintext: 'fine' },
  ];
  const sealedNoId = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  const sealedNoIdText = textOf(sealedNoId);
  assert(
    /<no cell id>/.test(sealedNoIdText) && !/first: undefined/.test(sealedNoIdText),
    'a sealed cell with no id is named as having none rather than as "undefined"',
  );
  assert(
    /1 of 2 cells without plaintext/.test(sealedNoIdText),
    'a partial shortfall with an unidentified cell is still counted as a shortfall',
  );

  // ---- saihm_share --------------------------------------------------------
  // The grantee hash decides WHO gets access, so a decode that repairs bad input is a
  // confidentiality bug: "a1b24gd4" used to decode to a1b204d4 — a different, entirely
  // valid identity — and nothing downstream could tell it from one the user meant.
  const shareArgs = (grantees: string[], expiry?: string) => ({
    granteeIdHashesHex: grantees,
    shardIds: ['shard-1'],
    type: 'temporary',
    scope: 'read',
    ...(expiry !== undefined ? { expiryEpoch: expiry } : {}),
  });
  responder.for = () => ({ contractId: 'c0'.repeat(16), granteeCount: 1 });

  const shareTypo = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: shareArgs(['a1b24gd4']),
  });
  assert(shareTypo.isError === true, 'a grantee id that is not hex is refused, not decoded');
  assert(
    /grantee #1/.test(textOf(shareTypo)) && /not valid hex/.test(textOf(shareTypo)),
    'a bad grantee id names which one and why it was refused',
  );

  const shareNonHex = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: shareArgs(['zz'.repeat(32)]),
  });
  assert(
    shareNonHex.isError === true,
    'an all-non-hex grantee id is refused rather than decoded to an all-zero identity',
  );

  const shareNone = await mcpClient.callTool({ name: 'saihm_share', arguments: shareArgs([]) });
  assert(shareNone.isError === true, 'a contract with no grantees is refused');
  assert(/nobody/.test(textOf(shareNone)), 'an empty grantee list explains that nobody is granted');

  const shareBadExpiry = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: shareArgs(['a1'.repeat(32)], 'abc'),
  });
  assert(shareBadExpiry.isError === true, 'a non-numeric expiryEpoch is refused');
  assert(
    /expiryEpoch/.test(textOf(shareBadExpiry)) &&
      !/Cannot convert abc to a BigInt/.test(textOf(shareBadExpiry)),
    'a bad expiryEpoch names the field and the rule instead of leaking a BigInt SyntaxError',
  );

  const shareNegExpiry = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: shareArgs(['a1'.repeat(32)], '-1'),
  });
  assert(
    shareNegExpiry.isError === true,
    'a negative expiryEpoch is refused rather than creating a contract already expired',
  );

  responder.for = () => ({ granteeCount: 1 });
  const shareNoId = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: shareArgs(['a1'.repeat(32)]),
  });
  assert(shareNoId.isError === true, 'a share with no contract id is not reported as created');
  assert(
    /saihm_revoke_share/.test(textOf(shareNoId)),
    'an unconfirmed share explains that it could not be revoked either',
  );

  responder.for = () => ({ contractId: 'c1'.repeat(16), granteeCount: 5 });
  const shareMismatch = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: shareArgs(['a1'.repeat(32), 'b2'.repeat(32)]),
  });
  assert(
    /MISMATCH/.test(textOf(shareMismatch)) && /requested 2/.test(textOf(shareMismatch)),
    'an operator grantee count that disagrees with the request is surfaced, not displayed instead',
  );

  responder.for = () => ({ contractId: 'c2'.repeat(16) });
  const shareThin = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: shareArgs(['a1'.repeat(32)]),
  });
  const shareThinText = textOf(shareThin);
  assert(shareThin.isError !== true, 'a thin share receipt with a contract id still succeeds');
  assert(
    /grantees=1/.test(shareThinText) && !/undefined/.test(shareThinText),
    'share fields the operator never sent are left out, and the local grantee count is still stated',
  );

  // ---- saihm_revoke_share -------------------------------------------------
  // The headline is the whole message for this tool: someone who reads REVOKED stops
  // checking, and a grantee they believe they cut off still has access.
  responder.for = () => ({ revoked: false, epoch: '495912' });
  const revokeFalse = await mcpClient.callTool({
    name: 'saihm_revoke_share',
    arguments: { contractId: 'c0'.repeat(16) },
  });
  const revokeFalseText = textOf(revokeFalse);
  assert(
    /NOT REVOKED/.test(revokeFalseText) && /STILL ACTIVE/.test(revokeFalseText),
    'an unconfirmed revocation says access must be assumed still active',
  );
  assert(
    !/^REVOKED/m.test(revokeFalseText),
    'an unconfirmed revocation never leads with the word REVOKED',
  );

  responder.for = () => ({ epoch: '495913' });
  const revokeMissing = await mcpClient.callTool({
    name: 'saihm_revoke_share',
    arguments: { contractId: 'c0'.repeat(16) },
  });
  assert(
    /NOT REVOKED/.test(textOf(revokeMissing)) && !/revoked=undefined/.test(textOf(revokeMissing)),
    'a missing revoked flag is treated as not revoked, not printed as "undefined"',
  );

  responder.for = () => ({ revoked: true, epoch: '495914' });
  const revokeOk = await mcpClient.callTool({
    name: 'saihm_revoke_share',
    arguments: { contractId: 'c0'.repeat(16) },
  });
  const revokeOkText = textOf(revokeOk);
  assert(
    /^REVOKED contract=c0c0/m.test(revokeOkText) && /epoch=495914/.test(revokeOkText),
    'a confirmed revocation still reports plainly',
  );
  assert(!/undefined/.test(revokeOkText), 'a confirmed revocation contains no "undefined"');

  // ---- saihm_governance_propose ------------------------------------------
  responder.for = () => ({
    proposalId: 'p0'.repeat(16),
    scope: 'emission_param',
    proposerHash: 42,
  });
  const proposeBadHash = await mcpClient.callTool({
    name: 'saihm_governance_propose',
    arguments: { scope: 'emission_param', paramKey: 'k', proposedValue: '1' },
  });
  const proposeBadHashText = textOf(proposeBadHash);
  assert(
    proposeBadHash.isError !== true,
    'a non-string proposer hash does not crash governance_propose',
  );
  assert(
    /PROPOSED \[p0p0/.test(proposeBadHashText) && !/proposer=/.test(proposeBadHashText),
    'an unusable proposer hash is left out rather than crashed on',
  );

  // These two exercise RESPONSE rendering, so they have to get past input validation:
  // an emission_param proposal now has to name a parameter and a value before any call
  // is made. Without them the tool refuses early and the assertions below would be
  // testing the input guard while appearing to test the operator's reply.
  responder.for = () => ({ scope: 'emission_param' });
  const proposeNoId = await mcpClient.callTool({
    name: 'saihm_governance_propose',
    arguments: { scope: 'emission_param', paramKey: 'emission_rate', proposedValue: '42' },
  });
  assert(proposeNoId.isError === true, 'a proposal with no id is not reported as opened');
  assert(
    /saihm_governance_vote/.test(textOf(proposeNoId)),
    'an unconfirmed proposal explains that it could not be voted on',
  );

  responder.for = () => ({ proposalId: 'p1'.repeat(16), paramKey: { nested: true } });
  const proposeObjKey = await mcpClient.callTool({
    name: 'saihm_governance_propose',
    arguments: { scope: 'emission_param', paramKey: 'emission_rate', proposedValue: '42' },
  });
  assert(
    !/\[object Object\]/.test(textOf(proposeObjKey)) && /paramKey=—/.test(textOf(proposeObjKey)),
    'a non-primitive paramKey renders as unreported, not as "[object Object]"',
  );

  // ---- saihm_governance_vote ---------------------------------------------
  responder.for = () => ({ proposalId: 'p0'.repeat(16), voterHash: null, weight: 10 });
  const voteBadHash = await mcpClient.callTool({
    name: 'saihm_governance_vote',
    arguments: { proposalId: 'p0'.repeat(16), approve: true },
  });
  const voteBadHashText = textOf(voteBadHash);
  assert(voteBadHash.isError !== true, 'a null voter hash does not crash governance_vote');
  assert(
    /VOTED \[p0p0/.test(voteBadHashText) && !/voter=/.test(voteBadHashText),
    'an unusable voter hash is left out rather than crashed on',
  );

  // The vote was cast. Throwing would report a completed, non-idempotent action as a
  // failure, and an agent that retries on error would cast it a second time — so the
  // severity goes in the text, not the error flag.
  responder.for = () => ({ proposalId: 'p0'.repeat(16), voterHash: 'ab'.repeat(32), weight: 0 });
  const voteZero = await mcpClient.callTool({
    name: 'saihm_governance_vote',
    arguments: { proposalId: 'p0'.repeat(16), approve: true },
  });
  const voteZeroText = textOf(voteZero);
  assert(
    voteZero.isError !== true,
    'a zero-weight vote is not reported as a failure, because the vote was still cast',
  );
  assert(
    /WARNING/.test(voteZeroText) && /zero weight/.test(voteZeroText),
    'a zero-weight vote is reported with an explicit warning rather than a bare VOTED',
  );
  assert(
    /snapshot epoch/.test(voteZeroText) && /Do not re-send/.test(voteZeroText),
    'a zero-weight vote explains the snapshot rule and warns against re-sending it',
  );

  responder.for = () => ({ proposalId: 'ff'.repeat(16), voterHash: 'ab'.repeat(32), weight: 3 });
  const voteMismatch = await mcpClient.callTool({
    name: 'saihm_governance_vote',
    arguments: { proposalId: 'p0'.repeat(16), approve: false },
  });
  const voteMismatchText = textOf(voteMismatch);
  assert(
    /VOTE MISMATCH/.test(voteMismatchText) && /proposalId=ffff/.test(voteMismatchText),
    'a vote recorded against a different proposal leads with the mismatch, not with VOTED',
  );
  assert(
    !/^VOTED/.test(voteMismatchText),
    'a vote on a different proposal is not headlined with the id that was requested',
  );

  // Falsy-value handling belongs on a clean vote: on a mismatch path the requested
  // direction is only quoted when it is the thing that disagreed.
  responder.for = () => ({
    proposalId: 'p0'.repeat(16),
    voterHash: 'ab'.repeat(32),
    weight: 3,
    castAtEpoch: '7',
    approve: false,
  });
  const voteReject = await mcpClient.callTool({
    name: 'saihm_governance_vote',
    arguments: { proposalId: 'p0'.repeat(16), approve: false },
  });
  const voteRejectText = textOf(voteReject);
  assert(
    /^VOTED/.test(voteRejectText) && /approve=false/.test(voteRejectText),
    'a rejection reports approve=false rather than dropping the falsy value',
  );

  // ── R3: unguarded containers, empty grants, unconfirmed votes ─────────────
  // SaihmRuntimeClient.call ends in `res.json() as T` — a bare cast — so a JSON body of
  // `null` arrives at every handler as null. Guarding the fields inside a response is
  // no use if reading the response itself throws first.

  responder.for = () => null;
  const rememberNull = await mcpClient.callTool({
    name: 'saihm_remember',
    arguments: { content: 'x' },
  });
  assert(rememberNull.isError === true, 'a null response to a write is refused, not dereferenced');
  assert(
    /not stored/.test(textOf(rememberNull)),
    'a null write response tells the user to treat the memory as not stored',
  );

  const statusNull = await mcpClient.callTool({ name: 'saihm_status', arguments: {} });
  assert(
    statusNull.isError === true && /malformed status response/.test(textOf(statusNull)),
    'a null status response is refused, not dereferenced',
  );

  // Values, not just the container. An array renders its indices as tier names and an
  // object byte count renders as "[object Object]B".
  responder.for = () => ({
    agentIdHashHex: 'ab'.repeat(32),
    storageByTier: { filecoin: { bytes: 100 }, ipfs: 512 },
  });
  const statusTierObj = await mcpClient.callTool({ name: 'saihm_status', arguments: {} });
  const statusTierObjText = textOf(statusTierObj);
  assert(
    !/\[object Object\]/.test(statusTierObjText),
    'an object-valued tier size is not printed as "[object Object]B"',
  );
  assert(
    /ipfs=512B/.test(statusTierObjText),
    'a usable tier size beside an unusable one is still reported',
  );

  responder.for = () => ({ agentIdHashHex: 'ab'.repeat(32), storageByTier: [10, 20] });
  const statusTierArr = await mcpClient.callTool({ name: 'saihm_status', arguments: {} });
  assert(
    !/0=10B/.test(textOf(statusTierArr)),
    'an array storageByTier does not render its indices as tier names',
  );

  // The known contract divergence, pinned: the blind operator endpoint answers a forget
  // with `complete`, while ForgetResult here declares `success`. Neither a crash nor a
  // FORGOTTEN headline is acceptable on a field this client cannot read — an erasure is
  // the one claim a user has no way to check afterwards. This test exists so that if the
  // contract is ever reconciled, or accidentally loosened, it is a deliberate change.
  responder.for = () => ({
    cellId: 'ab'.repeat(32),
    shardId: 'shard-1',
    complete: true,
    sharesPurged: 2,
    steps: ['dek-destroyed', 'tombstoned'],
    epoch: '495912',
  });
  const forgetDivergent = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: 'ab'.repeat(32) },
  });
  const forgetDivergentText = textOf(forgetDivergent);
  assert(
    /UNCONFIRMED/.test(forgetDivergentText) && !/FORGOTTEN/.test(forgetDivergentText),
    'a receipt that reports `complete` instead of `success` is not read as a confirmed erasure',
  );
  assert(
    forgetDivergent.isError !== true,
    'an unreadable erasure receipt is reported, not thrown, since the erasure may have happened',
  );

  // Array.isArray vouches for the container, not the contents.
  responder.for = () => [null, { cellId: 'ab'.repeat(32), plaintext: 'fine' }];
  const recallNullCell = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  assert(recallNullCell.isError === true, 'a null entry inside a recall list is refused');
  assert(
    /not cells/.test(textOf(recallNullCell)),
    'a non-cell recall entry is diagnosed rather than crashed on',
  );

  // The dangerous shape: no primitive has a string plaintext, so a list of them used to
  // satisfy the all-sealed test and get reported as a non-custodial operator — turning a
  // malformed response into a recommendation to go and install another package.
  responder.for = () => [1, 2, 3];
  const recallPrimitives = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  assert(recallPrimitives.isError === true, 'a recall list of primitives is refused');
  assert(
    !/mcp-server-pro/.test(textOf(recallPrimitives)),
    'a malformed recall is not misdiagnosed as a non-custodial operator',
  );

  // typeof [] === 'object', so a list of lists reaches the same misdiagnosis unless
  // arrays are excluded explicitly.
  responder.for = () => [['a'], ['b']];
  const recallNested = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  assert(recallNested.isError === true, 'a recall list of arrays is refused');
  assert(
    !/mcp-server-pro/.test(textOf(recallNested)),
    'an array-shaped recall entry is not misdiagnosed as a non-custodial operator',
  );

  // A contract over no shards grants access to nothing, for the same fee and under the
  // same SHARED headline — the empty-grantee case pointed the other way.
  responder.for = () => ({ contractId: 'c0'.repeat(16), granteeCount: 1 });
  const shareNoShards = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: {
      granteeIdHashesHex: ['ab'.repeat(32)],
      shardIds: [],
      type: 'temporary',
      scope: 'read',
    },
  });
  assert(shareNoShards.isError === true, 'a contract over no shards is refused');
  assert(
    /nothing/.test(textOf(shareNoShards)),
    'an empty shard list explains that nothing would be granted',
  );

  // Same identity, three spellings — the count has to be of agents, not of strings.
  const shareDupes = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: {
      granteeIdHashesHex: ['ab'.repeat(32), '0x' + 'AB'.repeat(32)],
      shardIds: ['shard-1'],
      type: 'temporary',
      scope: 'read',
    },
  });
  assert(
    shareDupes.isError === true,
    'a grantee listed twice under different spellings is refused',
  );
  assert(
    /more than once/.test(textOf(shareDupes)),
    'a duplicate grantee says which id was repeated',
  );

  const shareCounts = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: {
      granteeIdHashesHex: ['ab'.repeat(32)],
      shardIds: ['shard-1', 'shard-2'],
      type: 'temporary',
      scope: 'read',
    },
  });
  assert(
    /shards=2/.test(textOf(shareCounts)),
    'a share receipt states what was shared, not only who with',
  );

  // Every other write tool refuses its success headline without a receipt field. Of what
  // a vote returns, only weight and castAtEpoch are produced by the operator.
  responder.for = () => ({});
  const voteNoReceipt = await mcpClient.callTool({
    name: 'saihm_governance_vote',
    arguments: { proposalId: 'p0'.repeat(16), approve: true },
  });
  const voteNoReceiptText = textOf(voteNoReceipt);
  assert(
    voteNoReceipt.isError !== true,
    'an unconfirmed vote is not an error, because a retry would double-vote',
  );
  assert(
    /UNCONFIRMED/.test(voteNoReceiptText) && !/^VOTED/.test(voteNoReceiptText),
    'a vote with no operator-produced receipt is not headlined VOTED',
  );
  assert(
    /Do not re-send/.test(voteNoReceiptText),
    'an unconfirmed vote warns against the retry that would cast it twice',
  );

  responder.for = () => ({
    proposalId: 'p0'.repeat(16),
    voterHash: 'ab'.repeat(32),
    weight: 5,
    castAtEpoch: '1',
    approve: false,
  });
  const voteFlipped = await mcpClient.callTool({
    name: 'saihm_governance_vote',
    arguments: { proposalId: 'p0'.repeat(16), approve: true },
  });
  const voteFlippedText = textOf(voteFlipped);
  assert(
    /VOTE MISMATCH/.test(voteFlippedText),
    'a vote recorded in the opposite direction leads with the mismatch, not with VOTED',
  );
  assert(
    /cannot be recast/.test(voteFlippedText),
    'a direction mismatch says that voting again will not correct it',
  );

  // An emission_param proposal that names no parameter proposes no change, but still
  // opens a real vote others must consider.
  responder.for = () => ({ proposalId: 'p1'.repeat(16) });
  const proposeNoKey = await mcpClient.callTool({
    name: 'saihm_governance_propose',
    arguments: { scope: 'emission_param' },
  });
  assert(
    proposeNoKey.isError === true &&
      /requires both paramKey and proposedValue/.test(textOf(proposeNoKey)),
    'an emission_param proposal with no paramKey is refused before it opens a vote',
  );
  const proposeNoValue = await mcpClient.callTool({
    name: 'saihm_governance_propose',
    arguments: { scope: 'emission_param', paramKey: 'emission_rate' },
  });
  assert(
    proposeNoValue.isError === true &&
      /requires both paramKey and proposedValue/.test(textOf(proposeNoValue)),
    'an emission_param proposal with no proposedValue is refused',
  );

  // ...but protocol_upgrade legitimately carries neither field, and must still work.
  const proposeUpgrade = await mcpClient.callTool({
    name: 'saihm_governance_propose',
    arguments: { scope: 'protocol_upgrade' },
  });
  assert(
    proposeUpgrade.isError !== true,
    'a protocol_upgrade proposal is not caught by the emission_param check',
  );

  // ── R4: string-typed booleans, and a claim about the whole store ──────────
  // This file already accepts "495912" as a number because operators serialise scalars
  // as strings. The same operator serialises false as "false", which a bare
  // `typeof === 'boolean'` reads as "not reported" — letting the opposite-direction vote
  // straight past the check written to catch it.
  responder.for = () => ({
    proposalId: 'p0'.repeat(16),
    voterHash: 'ab'.repeat(32),
    weight: 5,
    castAtEpoch: '1',
    approve: 'false',
  });
  const voteFlippedString = await mcpClient.callTool({
    name: 'saihm_governance_vote',
    arguments: { proposalId: 'p0'.repeat(16), approve: true },
  });
  assert(
    /VOTE MISMATCH/.test(textOf(voteFlippedString)),
    'a string-typed approve echo is still caught as a direction mismatch',
  );

  // The same normalisation has to reach every boolean the operator sends, not just the
  // one that prompted it: a string-typed success reported an erasure as UNCONFIRMED.
  responder.for = () => ({ success: 'true', cellId: 'ab'.repeat(32) });
  const forgetStringSuccess = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: 'ab'.repeat(32) },
  });
  assert(
    /^FORGOTTEN/.test(textOf(forgetStringSuccess)),
    'a string-typed success flag is not reported as an unconfirmed erasure',
  );

  responder.for = () => ({ success: '0' });
  const forgetStringFalse = await mcpClient.callTool({
    name: 'saihm_forget',
    arguments: { id: 'ab'.repeat(32) },
  });
  assert(
    /not found or already destroyed/.test(textOf(forgetStringFalse)),
    'a string-typed false success is read as the real answer it is',
  );

  responder.for = () => ({ revoked: 'true', epoch: '9' });
  const revokeStringTrue = await mcpClient.callTool({
    name: 'saihm_revoke_share',
    arguments: { contractId: 'c0'.repeat(16) },
  });
  assert(
    /^REVOKED/.test(textOf(revokeStringTrue)),
    'a string-typed revoked flag is not reported as a failed revocation',
  );

  // "No memories stored" is a claim about the store, not about the query.
  responder.for = () => [];
  const recallFiltered = await mcpClient.callTool({
    name: 'saihm_recall',
    arguments: { query: 'nothing-matches-this' },
  });
  const recallFilteredText = textOf(recallFiltered);
  assert(
    /No memories matched/.test(recallFilteredText) &&
      !/No memories stored/.test(recallFilteredText),
    'an empty filtered recall does not claim the store is empty',
  );
  assert(
    /no query/.test(recallFilteredText),
    'an empty filtered recall says how to see everything',
  );

  const recallEmpty = await mcpClient.callTool({ name: 'saihm_recall', arguments: {} });
  assert(
    /No memories stored/.test(textOf(recallEmpty)),
    'an empty unfiltered recall still reports an empty store plainly',
  );

  // ── R5: a write with nothing in it ────────────────────────────────────────
  // The empty share and the empty contract were both refused; the empty memory was not,
  // and it is the one that spends a creation fee to store nothing.
  responder.for = () => ({ cellId: 'ab'.repeat(32) });
  const rememberEmpty = await mcpClient.callTool({
    name: 'saihm_remember',
    arguments: { content: '   ' },
  });
  assert(rememberEmpty.isError === true, 'a whitespace-only memory is refused, not billed for');
  assert(/empty memory/.test(textOf(rememberEmpty)), 'an empty write says what was wrong with it');

  // ── R6: how wide "unambiguously true or false" has to be ──────────────────
  // Leaning narrow is not neutral. An unrecognised `revoked` errs safe; an unrecognised
  // `approve` drops the direction mismatch and prints what the caller asked for.
  responder.for = () => ({
    proposalId: 'p0'.repeat(16),
    voterHash: 'ab'.repeat(32),
    weight: 5,
    castAtEpoch: '1',
    approve: 0,
  });
  const voteFlippedNumeric = await mcpClient.callTool({
    name: 'saihm_governance_vote',
    arguments: { proposalId: 'p0'.repeat(16), approve: true },
  });
  assert(
    /VOTE MISMATCH/.test(textOf(voteFlippedNumeric)),
    'a numeric approve echo is still caught as a direction mismatch',
  );

  // The mismatch branch cannot run when there is no receipt, so the unconfirmed branch
  // has to carry the signal itself rather than discard it.
  responder.for = () => ({ approve: false });
  const voteUnconfirmedFlipped = await mcpClient.callTool({
    name: 'saihm_governance_vote',
    arguments: { proposalId: 'p0'.repeat(16), approve: true },
  });
  const voteUnconfirmedFlippedText = textOf(voteUnconfirmedFlipped);
  assert(
    /UNCONFIRMED/.test(voteUnconfirmedFlippedText),
    'a vote with no weight and no epoch is still unconfirmed',
  );
  assert(
    /also disagreed with the request/.test(voteUnconfirmedFlippedText) &&
      /recorded approve=false/.test(voteUnconfirmedFlippedText),
    'an unconfirmed vote still reports a direction the operator echoed back wrong',
  );

  // ── R30-B. A malformed operator RESPONSE, on every tool that guards for one ──
  // R30-A drove hostile caller INPUT. These four guards are the other direction:
  // the operator answering with something that is not an object at all. Each of
  // saihm_share, saihm_revoke_share, saihm_governance_propose and
  // saihm_governance_vote carries its own guard, and not one of them had ever
  // executed. They matter more than an ordinary refusal because each names an
  // action whose outcome is now UNKNOWN to the caller — a grant that may exist, a
  // revocation that may not have landed — and the wording is what tells an agent
  // it must not assume either way. An uncovered guard here is a guard whose text
  // could rot into the wrong reassurance without any test objecting.
  group('R30-B malformed operator responses');

  const malformedCases: ReadonlyArray<[string, string, Record<string, unknown>, RegExp]> = [
    [
      'saihm_share',
      'a grant may exist that the caller cannot revoke',
      {
        granteeIdHashesHex: ['ab'.repeat(32)],
        shardIds: ['shard-1'],
        type: 'temporary',
        scope: 'read',
      },
      /malformed sharing response/,
    ],
    [
      'saihm_revoke_share',
      'access may still be live',
      { contractId: 'cc'.repeat(16) },
      /malformed revocation response/,
    ],
    [
      'saihm_governance_propose',
      'a proposal may be open with no handle on it',
      { scope: 'emission_param', paramKey: 'rate', proposedValue: '1' },
      /malformed proposal response/,
    ],
    [
      'saihm_governance_vote',
      'a vote may or may not be recorded',
      { proposalId: 'dd'.repeat(32), approve: true },
      /malformed vote response/,
    ],
  ];

  for (const [tool, stake, args, expected] of malformedCases) {
    for (const [shape, body] of [
      ['null', null],
      ['a bare string', 'ok'],
      ['a number', 7],
    ] as ReadonlyArray<[string, unknown]>) {
      responder.for = (m) => (m === tool ? body : savedResponder(m));
      const r = await mcpClient.callTool({ name: tool, arguments: args });
      const t = textOf(r);
      assert(
        r.isError === true && expected.test(t),
        `R30-B ${tool} refuses ${shape} rather than reporting success — ${stake} (got '${t.slice(0, 90)}')`,
      );
    }
  }

  // The guard exists to stop a false success, so the negative case is the assertion
  // that carries it: a well-shaped response must still get through untouched.
  responder.for = savedResponder;
  const shareOk = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: {
      granteeIdHashesHex: ['ab'.repeat(32)],
      shardIds: ['shard-1'],
      type: 'temporary',
      scope: 'read',
    },
  });
  assert(
    shareOk.isError !== true,
    'R30-B positive control — a well-shaped sharing response is still accepted, so the guard rejects shape and not the path',
  );

  // expiryEpoch is caller-supplied and reaches BigInt(), which throws a RangeError on
  // anything non-integral. The tool validates first so the caller gets a sentence
  // naming the field instead of a bare conversion error surfacing as tool output.
  for (const bad of ['-1', '1.5', 'soon']) {
    const r = await mcpClient.callTool({
      name: 'saihm_share',
      arguments: {
        granteeIdHashesHex: ['ab'.repeat(32)],
        shardIds: ['shard-1'],
        type: 'temporary',
        scope: 'read',
        expiryEpoch: bad,
      },
    });
    assert(
      r.isError === true && /expiryEpoch/.test(textOf(r)),
      `R30-B an expiryEpoch of '${bad}' is refused by name, not by a raw conversion error (got '${textOf(r).slice(0, 80)}')`,
    );
  }

  // '' is NOT in that list, and that is deliberate in the handler: it is normalised to
  // "no expiry supplied" rather than refused or fed to BigInt(''), which is 0n and would
  // date the contract to the epoch. Pinned here because the distinction is invisible from
  // the schema — expiryEpoch is z.string().optional(), so absent and empty arrive
  // differently and only the handler decides they mean the same thing.
  const emptyExpiry = await mcpClient.callTool({
    name: 'saihm_share',
    arguments: {
      granteeIdHashesHex: ['ab'.repeat(32)],
      shardIds: ['shard-1'],
      type: 'temporary',
      scope: 'read',
      expiryEpoch: '',
    },
  });
  assert(
    emptyExpiry.isError !== true,
    'R30-B an empty expiryEpoch is normalised to absent, not refused and not read as epoch 0',
  );

  // ── concurrent tool dispatch ───────────────────────────────────────
  //
  // Every case above issues one tool call and awaits it before the next, so the suite
  // had never put two calls in flight at once. The server holds exactly one piece of
  // mutable module state — the SaihmRuntimeClient cached behind getRuntime() — and a
  // later change that made that construction async, or that hung any per-call state
  // off the client, could hand one caller another caller's receipt without failing a
  // single existing test.
  //
  // maxInFlight is the load-bearing assertion. "All twelve came back" is satisfied
  // trivially by a server that serialises, so the mock holds every reply until all
  // twelve requests have arrived: that makes the count deterministic rather than a
  // race against the machine, and releasing them on staggered timers makes completion
  // order differ from submission order. If dispatch ever serialises the twelfth never
  // arrives, the deadline releases whatever is waiting, and maxInFlight reads 1.
  group('concurrent tool dispatch');

  const CONCURRENT_CALLS = 12;
  // Distinct per reply and shaped like a real cell id, so a crossed response is
  // identifiable rather than indistinguishable from the right one.
  const cellIdFor = (k: number): string => k.toString(16).padStart(2, '0').repeat(32);

  let arrived = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let served = 0;
  let openGate: () => void = () => undefined;
  const allArrived = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  // Bounds the failure path: a serialised dispatcher never reaches twelve arrivals,
  // and without this the case would hang rather than fail.
  const arrivalDeadline = setTimeout(openGate, 2000);

  holdOperatorReply = () => {
    inFlight++;
    if (inFlight > maxInFlight) maxInFlight = inFlight;
    const seen = arrived++;
    if (arrived >= CONCURRENT_CALLS) openGate();
    return allArrived.then(
      () =>
        new Promise<void>((r) =>
          setTimeout(
            () => {
              inFlight--;
              r();
            },
            40 + (seen % 3) * 120,
          ),
        ),
    );
  };
  // responder.for runs in the same arrival order as calls.push, so the reply carrying
  // cellIdFor(k) is the reply to the request recorded at offset k.
  responder.for = (m) =>
    m === 'saihm_remember'
      ? {
          ...(savedResponder('saihm_remember') as Record<string, unknown>),
          cellId: cellIdFor(served++),
        }
      : savedResponder(m);

  const firstCall = calls.length;
  // Array.from runs its mapper to completion synchronously, so all twelve requests are
  // handed to the transport before any response can be awaited.
  const concurrentResults = await Promise.all(
    Array.from({ length: CONCURRENT_CALLS }, (_, i) =>
      mcpClient.callTool({
        name: 'saihm_remember',
        arguments: { content: `concurrent write ${i}` },
      }),
    ),
  );
  clearTimeout(arrivalDeadline);
  holdOperatorReply = () => undefined;
  responder.for = savedResponder;

  assert(
    concurrentResults.length === CONCURRENT_CALLS &&
      concurrentResults.every((r) => r.isError !== true),
    `${CONCURRENT_CALLS} overlapping saihm_remember calls all return, none as an error`,
  );
  assert(
    maxInFlight === CONCURRENT_CALLS,
    `all ${CONCURRENT_CALLS} were in flight at the operator at once (max ${maxInFlight})`,
  );
  assert(
    calls.length - firstCall === CONCURRENT_CALLS,
    'each call reached the operator exactly once, so replies map to requests by arrival',
  );

  // Driving remember through the MCP surface with a receipt that is actually full is
  // new here. The four cases that existed returned a thin receipt, no cell id, or null,
  // so the six `if (x !== undefined)` arms that render the detail line had never been
  // taken — this case traverses all of them, and traversing is not checking. Anchored at
  // both ends because the failure this guards against is a field rendering as the string
  // "undefined", which any unanchored match would happily accept. The cell id is matched
  // by shape, not value: replies are correlated below, and under overlap the first result
  // need not be the first arrival.
  assert(
    /^REMEMBERED \[[0-9a-f]{64}\] nonce=(ab){16} tier=filecoin kekV=1 epoch=493970 fee=100000nCOTI sig=abcdef…$/.test(
      textOf(concurrentResults[0]),
    ),
    'a full write receipt renders every detail field the operator returned, and nothing else',
  );

  const contentByCellId = new Map(
    calls.slice(firstCall).map((c, k) => [cellIdFor(k), (c.params as { content: string }).content]),
  );
  const misrouted = concurrentResults.filter((r, i) => {
    const id = /REMEMBERED \[([\x21-\x7e]+)\]/.exec(textOf(r))?.[1] ?? '';
    return contentByCellId.get(id) !== `concurrent write ${i}`;
  });
  assert(
    misrouted.length === 0,
    `every caller receives the receipt generated for its own request (${misrouted.length} crossed)`,
  );

  await mcpClient.close();

  // ── R25-A: opting into verification binds EVERY path, not just `self` ─────
  //
  // Written as a table over all four paths rather than one case per bug, because the
  // defect was a rule implemented in one function and never carried to its siblings.
  // A per-function test would have passed on `self` and said nothing about the two
  // paths that were actually waving requests through.
  const hex64 = 'a'.repeat(64);
  const freshIso = new Date(Date.now() - 1000).toISOString();
  const yes = async () => true;

  const selfAuth = (surface: 'web' | 'mcp') => ({
    path: 'self' as const,
    surface,
    signature: 'sig',
    challenge: 'c',
    challengeIssuedAt: freshIso,
    agentIdHash: hex64,
  });
  const operSelfAuth = {
    path: 'operator-self' as const,
    operatorIdHash: hex64,
    mldsaSignature: 'sig',
    challenge: 'c',
    challengeIssuedAt: freshIso,
  };
  const downAuth = {
    path: 'operator-for-downstream' as const,
    operatorIdHash: hex64,
    operatorMldsaSignature: 'sig',
    downstream: {
      type: 'legal-basis' as const,
      subpoenaHash: 'b'.repeat(64),
      jurisdiction: 'SG',
      publicRecordUrl: 'https://example.gov/record/1',
    },
  };

  const optedInCases: ReadonlyArray<[string, () => Promise<{ ok: boolean }>]> = [
    [
      'self/web with only verifyMlDsa',
      () => validateAuthSelf(selfAuth('web'), { verifyMlDsa: yes }),
    ],
    [
      'self/mcp with only verifyEip712',
      () => validateAuthSelf(selfAuth('mcp'), { verifyEip712: yes }),
    ],
    [
      'self/mcp with only verifyCustomerGrant',
      () => validateAuthSelf(selfAuth('mcp'), { verifyCustomerGrant: yes }),
    ],
    [
      'operator-self with only verifyEip712',
      () => validateAuthOperatorSelf(operSelfAuth, { verifyEip712: yes }),
    ],
    [
      'operator-self with only verifyCustomerGrant',
      () => validateAuthOperatorSelf(operSelfAuth, { verifyCustomerGrant: yes }),
    ],
    [
      'operator-for-downstream with only verifyEip712',
      () => validateAuthOperatorForDownstream(downAuth, { verifyEip712: yes }),
    ],
    [
      'operator-for-downstream with only verifyCustomerGrant',
      () => validateAuthOperatorForDownstream(downAuth, { verifyCustomerGrant: yes }),
    ],
  ];
  for (const [label, run] of optedInCases) {
    assert(!(await run()).ok, `R25-A ${label} is refused, not authorized unverified`);
  }

  // The other half of the same rule: wiring NOTHING is still a legitimate smoke
  // posture, and it must keep returning ok:true carrying the marker. Without this the
  // fix above could be "achieved" by refusing everything.
  const shapeOnlyCases: ReadonlyArray<[string, () => Promise<AuthResult>]> = [
    ['self', () => validateAuthSelf(selfAuth('mcp'))],
    ['operator-self', () => validateAuthOperatorSelf(operSelfAuth)],
    ['operator-for-downstream', () => validateAuthOperatorForDownstream(downAuth)],
  ];
  for (const [label, run] of shapeOnlyCases) {
    const r = await run();
    assert(
      r.ok === true && chainSummaryIsUnverified(r.chainSummary),
      `R25-A ${label} with no verifier wired stays shape-only and is marked unverified`,
    );
  }

  // ── R29-B: verifyEip712's parameters must be what its declaration says they are ──
  //
  // The operator writes this callback, and on the `web` surface it is the only
  // signature check standing in front of audit-export and billing-history. Its second
  // and third parameters were declared `challenge` and `walletAddress` and neither name
  // described what arrives. Every other verifier test in this file wires
  // `verifyEip712: async () => true` and never inspects the arguments, so nothing pinned
  // the contract and a wrong name could not fail anything. Parameter names are erased at
  // runtime, so what this test defends is the other direction: it fails if a later call
  // site is "corrected" to match the old names — passing the raw challenge, or an actual
  // wallet address — because an operator implementing this reads the name, not the call
  // site, and only one of the two can be believed.
  const eipArgs: string[] = [];
  const capturingEip = async (sig: string, message: string, id: string) => {
    eipArgs.push(sig, message, id);
    return true;
  };
  const webAuth = selfAuth('web');
  assert(
    (await validateAuthSelf(webAuth, { verifyEip712: capturingEip })).ok,
    'R29-B the capturing verifier authorizes, so the arguments below are the real ones',
  );
  assert(
    eipArgs[1] !== webAuth.challenge &&
      (JSON.parse(eipArgs[1]) as unknown[])[0] === 'SAIHM-REPORT-SELF-v1',
    'R29-B param 2 is the domain-tagged message, not the caller-supplied challenge',
  );
  assert(
    /^[a-f0-9]{64}$/.test(eipArgs[2]) && eipArgs[2] === webAuth.agentIdHash,
    'R29-B param 3 is a 64-hex id hash — here the agentIdHash, no wallet supplied at all',
  );

  // ── R25-C: the unverified marker is a SET, and the guard must cover all of it ──
  //
  // operator-for-downstream never emitted `/UNVERIFIED-shape-only`; it reports its two
  // halves separately. README told operators to audit with a case-sensitive
  // `includes('UNVERIFIED')`, which matches neither of those, so the one path carrying a
  // disclosure to a third party was the one the documented guard could not see.
  const downNoVerifier = await validateAuthOperatorForDownstream(downAuth);
  assert(
    downNoVerifier.ok === true &&
      downNoVerifier.chainSummary.includes('/operator-sig-unverified') &&
      !downNoVerifier.chainSummary.includes('UNVERIFIED') &&
      chainSummaryIsUnverified(downNoVerifier.chainSummary),
    'R25-C the downstream marker the naive case-sensitive check misses is caught by the predicate',
  );
  assert(
    UNVERIFIED_MARKERS.length === 3 &&
      UNVERIFIED_MARKERS.every((m) => chainSummaryIsUnverified(`x${m}y`)),
    'R25-C every published unverified marker is recognised by the predicate',
  );
  // The README must not hand the reader back the broken guard.
  const readmeAuth = repoFile('README.md');
  assert(
    !/includes\((["'])UNVERIFIED\1\)/.test(readmeAuth),
    'R25-C README no longer recommends the case-sensitive UNVERIFIED substring check',
  );
  assert(
    readmeAuth.includes('chainSummaryIsUnverified') &&
      readmeAuth.includes('/operator-sig-unverified') &&
      readmeAuth.includes('/customer-sig-unverified'),
    'R25-C README names all three markers and the predicate that covers them',
  );

  // And the wired-correctly case still passes, so the refusal is about the MISSING
  // verifier and not about the presence of a second one.
  assert(
    (await validateAuthOperatorSelf(operSelfAuth, { verifyMlDsa: yes, verifyEip712: yes })).ok,
    'R25-A operator-self with verifyMlDsa wired alongside another verifier still passes',
  );

  // ── R25-B: coupling refuses inherited keys instead of throwing ────────────
  //
  // KIND_AUTH_REQUIREMENTS is a plain object literal, so these names resolve up the
  // prototype chain to a function or an object rather than to undefined. The previous
  // `=== undefined` guard let them past and `.includes` threw. Asserted over the whole
  // set of inherited names, not just the one that was noticed.
  for (const inherited of [
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    '__proto__',
    '__defineGetter__',
  ]) {
    let threw = false;
    let refused = false;
    try {
      refused = !checkKindAuthCoupling(inherited as never, 'self').ok;
    } catch {
      threw = true;
    }
    assert(
      !threw && refused,
      `R25-B coupling refuses inherited key '${inherited}' without throwing`,
    );
  }
  // The same guard must not have made real kinds unreachable.
  assert(
    checkKindAuthCoupling('audit-export', 'operator-self').ok &&
      checkKindAuthCoupling('registry-attestation', 'public').ok &&
      !checkKindAuthCoupling('audit-export', 'public').ok,
    'R25-B real kinds still couple correctly after the guard change',
  );

  // ── R26-A: a redirect must not carry the call, or the body, off the ───────
  //           validated host
  //
  // assertEndpointUrl checks the CONFIGURED url and nothing after it, and fetch follows
  // redirects by default. A 307 preserves method AND body, so `saihm_remember` delivered
  // its plaintext `content` to whatever host the endpoint named — over plain http, and
  // to a host no check ever saw. Asserted on the body reaching the target, not just on
  // the call failing, because a client that threw after the leak would still pass a
  // failure-only test.
  let sinkSawBody: string | null = null;
  const redirectSink = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      sinkSawBody = b;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ cellId: 'leaked' }));
    });
  });
  await new Promise<void>((r) => redirectSink.listen(0, '127.0.0.1', () => r()));
  const sinkPort = (redirectSink.address() as AddressInfo).port;

  for (const code of [301, 302, 307, 308]) {
    sinkSawBody = null;
    const redirector = createServer((_req, res) => {
      res.writeHead(code, { location: `http://127.0.0.1:${sinkPort}/` });
      res.end();
    });
    await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', () => r()));
    const redirPort = (redirector.address() as AddressInfo).port;

    const redirClient = new SaihmRuntimeClient(
      `http://127.0.0.1:${redirPort}/mcp`,
      'Bearer SECRET-TOKEN-DO-NOT-LEAK',
    );
    let refused = false;
    let message = '';
    try {
      await redirClient.remember('PLAINTEXT-MEMORY-THAT-MUST-NOT-TRAVEL');
    } catch (e) {
      refused = true;
      message = (e as Error).message;
    }
    assert(refused, `R26-A a ${code} redirect from the endpoint is refused, not followed`);
    assert(sinkSawBody === null, `R26-A the request body never reaches a ${code} redirect target`);
    assert(
      !message.includes('SECRET-TOKEN-DO-NOT-LEAK') &&
        !message.includes('PLAINTEXT-MEMORY-THAT-MUST-NOT-TRAVEL'),
      `R26-A the ${code} refusal message leaks neither the token nor the memory content`,
    );
    await new Promise<void>((r) => redirector.close(() => r()));
  }
  await new Promise<void>((r) => redirectSink.close(() => r()));

  // The guard is in the fetch options, so assert it is actually there: a future edit
  // that rebuilt the options object could drop it and every case above would still pass
  // if the test server simply stopped redirecting.
  assert(
    /redirect:\s*'error'/.test(repoFile('saihm_runtime_client.ts')),
    "R26-A the client sets redirect: 'error' on its request",
  );

  // ── R26-C. Shipped docs must not claim staffing the project does not have. ──
  // SECURITY.md promised to notify operators "via the SAIHM operations channel" and
  // told a reporter with an urgent concern that "the SAIHM operations team" was
  // reachable — while README §Support says the project is maintained by a solo
  // founder, GOVERNANCE names one founding maintainer, and ASSURANCE_CASE §G5 logs
  // founding-maintainer-as-sole-approver as the residual risk. A security policy is
  // exactly the wrong document to inflate response capacity in. Per-CLAIM, not
  // per-file: any shipped doc that names a group or a rotation is the same defect.
  const CAPACITY_DOCS = [
    'README.md',
    'SECURITY.md',
    'GOVERNANCE.md',
    'CONTRIBUTING.md',
    'ARCHITECTURE.md',
    'HARDENING.md',
    'ASSURANCE_CASE.md',
  ];
  const STAFFING_CLAIMS =
    /\b(?:operations|security|response|support|engineering)\s+team\b|\boperations\s+channel\b|\bon-call\s+rotation\b|\bour\s+staff\b/i;
  for (const doc of CAPACITY_DOCS) {
    const body = repoFile(doc);
    const offenders = body
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => STAFFING_CLAIMS.test(line))
      // A sentence may name a group in order to DENY having one; that is the fix,
      // not the defect. Only an unqualified claim counts.
      .filter(({ line }) => !/\bno\s+separate\b|\bno\s+on-call\b|\bthere\s+is\s+no\b/i.test(line));
    assert(
      offenders.length === 0,
      `R26-C ${doc} claims no team/rotation the project does not have` +
        (offenders.length
          ? ` (line ${offenders[0].n}: ${offenders[0].line.trim().slice(0, 70)})`
          : ''),
    );
  }
  const securityDoc = repoFile('SECURITY.md');
  assert(
    /single founding maintainer/i.test(securityDoc) && /GOVERNANCE\.md/.test(securityDoc),
    'R26-C SECURITY.md discloses the single-maintainer reality and points at GOVERNANCE.md',
  );

  // ── R26-D. No doc may defer a deliverable to a release that already shipped. ──
  // README §Roadmap said the roadmap "will be mirrored to <site>/roadmap with the
  // v0.2.x release". v0.2.0 shipped 2026-05-28, the package is eight releases past
  // it, and the page has been live the whole time — so the README told a reader the
  // page did not exist yet while serving a link to it. Assert per-CLAIM: every
  // version a doc defers work to must still be ahead of the shipped version.
  const [curMajor, curMinor] = pkgVersion.split('.').map((n) => Number(n));
  const deferralIsStale = (text: string): boolean => {
    for (const m of text.matchAll(/\bwith the v(\d+)\.(\d+)/g)) {
      const [maj, min] = [Number(m[1]), Number(m[2])];
      if (!(maj > curMajor || (maj === curMajor && min > curMinor))) return true;
    }
    return false;
  };
  // Self-test first. Every doc currently satisfies this, so the loop below runs zero
  // assertions on clean input — and a control that asserts nothing on a clean tree is
  // the placeholder this round already learned to distrust. Pin the predicate against
  // the exact string that shipped, plus a forward-looking one that must stay legal.
  assert(
    deferralIsStale('mirrored to <https://saihm.coti.global/roadmap> with the v0.2.x release.'),
    'R26-D the stale-deferral predicate catches the deferral README actually shipped',
  );
  assert(
    !deferralIsStale(`planned with the v${curMajor}.${curMinor + 1}.x release`),
    'R26-D the stale-deferral predicate still permits a genuinely future release',
  );
  for (const doc of CAPACITY_DOCS) {
    assert(
      !deferralIsStale(repoFile(doc)),
      `R26-D ${doc} defers no work to a release at or behind the shipped ${pkgVersion}`,
    );
  }

  // ── R26-E/F. Every project-site link in the docs must be one verified to resolve. ──
  // Two dead links shipped: GOVERNANCE §References pointed at /blog/ (the trailing
  // slash 404s; /blog serves), and ARCHITECTURE cited the GDPR Art.17 crosswalk as
  // "gdpr-art-17-crosswalk" when the published slug carries no hyphen before the 17.
  // The second one load-bears — it is the regulator-mapping authority behind the
  // Article 17 cryptographic-erasure claim, so a reviewer following it got a 404 at
  // the most compliance-sensitive citation in the package. This suite cannot reach
  // the network, so the offline half of the control is an allowlist: every path was
  // checked live when added, and a new link fails here until someone checks it too.
  const VERIFIED_SITE_PATHS = new Set([
    '',
    '/',
    '/blog',
    '/mcp',
    '/roadmap',
    '/standards',
    '/standards/',
    '/standards/gdpr-art17-crosswalk',
  ]);
  for (const doc of CAPACITY_DOCS) {
    for (const m of repoFile(doc).matchAll(/https:\/\/saihm\.coti\.global([^\s<>()[\]`"',]*)/g)) {
      assert(
        VERIFIED_SITE_PATHS.has(m[1]),
        `R26-E/F ${doc} links saihm.coti.global${m[1]}, a path verified to resolve`,
      );
    }
  }

  // ── R26-G. Every CHANGELOG heading must agree with what npm actually serves. ──
  // The 0.1.1 entry opened "This version went to npm at the time" and then closed
  // with a Notes block saying the version had been skipped and its contents folded
  // into 0.1.2. Both cannot be true. npm serves 0.1.1, so the second claim was the
  // false one — a leftover the entry's own reconstruction failed to delete, which
  // also contradicted the npm link at the foot of the file. This is the class the
  // round was told to expect in the CHANGELOG bodies, which had never been read.
  // Offline half of the control: the published set below was read from
  // `npm view @saihm/mcp-server versions` this round; a new release fails here
  // until someone re-reads it.
  const PUBLISHED_VERSIONS = new Set([
    '0.1.0',
    '0.1.1',
    '0.1.2',
    '0.2.0',
    '0.3.0',
    '0.3.1',
    '0.3.2',
    '0.3.3',
    '0.3.4',
    '0.3.5',
    '0.3.6',
    '0.3.7',
    '0.3.8',
    '0.3.9',
    '0.3.10',
    '0.3.11',
    '0.3.12',
  ]);
  const changelogDoc = repoFile('CHANGELOG.md');
  const changelogLines = changelogDoc.split('\n');
  const entryHeads = changelogLines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /^##+\s*\[?\d+\.\d+\.\d+/.test(line));
  assert(
    entryHeads.length >= PUBLISHED_VERSIONS.size,
    'R26-G CHANGELOG has an entry for at least every published version',
  );
  // The set above records what npm serves, so it has exactly two states and a release
  // commit is in neither. The version being released is not published yet — writing it
  // into PUBLISHED_VERSIONS to get past this loop would put a prediction into a record
  // of measured fact — and it is not "never published" either, so labelling it as such
  // to satisfy the other branch would be a second lie. Both gates run before publish
  // (`prepublishOnly`, and the workflow's own test step), so with only two states this
  // check blocks every release whose entry tells the truth about itself. The candidate
  // is therefore read from package.json rather than hardcoded, and exempted from the
  // published/unpublished label. It stops being exempt the moment package.json moves
  // on, which is when the next re-read of npm is due anyway.
  //
  // Only a version npm does NOT serve can be a candidate: if package.json still names a
  // published version, the bump was forgotten, and that entry stays under the normal
  // rules rather than inheriting an exemption meant for the next release.
  const candidateVersion = (JSON.parse(repoFile('package.json')) as { version: string }).version;
  const releaseCandidate = PUBLISHED_VERSIONS.has(candidateVersion) ? null : candidateVersion;

  const CLAIMS_UNPUBLISHED = /never published|does not exist on npm|was skipped/i;
  const WITHDRAWS_CLAIM = /withdraw|was wrong|previous revision|a note claiming/i;
  const VERSION_TOKEN = /\d+\.\d+\.\d+/g;

  for (const [idx, { line, i }] of entryHeads.entries()) {
    const ver = /(\d+\.\d+\.\d+)/.exec(line)![1];
    if (ver === releaseCandidate) continue;
    const end = idx + 1 < entryHeads.length ? entryHeads[idx + 1].i : changelogLines.length;
    const bodyLines = changelogLines.slice(i, end);
    if (PUBLISHED_VERSIONS.has(ver)) {
      // A published entry may *withdraw* an old unpublished claim; it may not make one.
      //
      // Which version a claim is ABOUT is not the same question as which entry it sits
      // in, and testing the whole body for the phrase conflates them. A release whose
      // content is "the historical entries were corrected" has to describe the versions
      // it corrected, and every such sentence read as a claim the entry was making about
      // itself. That fails in both directions: an entry could be flagged for accurately
      // describing another version, and — because the same substring satisfied the
      // unpublished branch below — an entry could also be waved through without ever
      // labelling itself. So each line is attributed to the versions it names, falling
      // back to the nearest one named before it, and only a claim landing on a version
      // npm actually serves is a defect. A line naming several is judged by any of them
      // being published, so an ambiguous sentence fails closed and is reworded rather
      // than silently exempting itself.
      let inherited = ver;
      const stillClaims: string[] = [];
      for (const l of bodyLines) {
        const named = l.match(VERSION_TOKEN);
        if (named) inherited = named[named.length - 1];
        const about = named ?? [inherited];
        if (
          CLAIMS_UNPUBLISHED.test(l) &&
          !WITHDRAWS_CLAIM.test(l) &&
          about.some((v) => PUBLISHED_VERSIONS.has(v))
        ) {
          stillClaims.push(l);
        }
      }
      assert(
        stillClaims.length === 0,
        `R26-G the ${ver} entry does not call a version npm actually serves unpublished` +
          (stillClaims.length ? ` (${stillClaims[0].trim().slice(0, 70)})` : ''),
      );
    } else {
      assert(
        CLAIMS_UNPUBLISHED.test(bodyLines.join('\n')),
        `R26-G the ${ver} entry is labelled as never published, because npm does not serve it`,
      );
    }
  }

  // ── R26-H/I. The "reads nothing from disk" claim was false, in six places. ──
  // saihm_mcp_server.ts imports readFileSync and calls it at module load to source
  // serverInfo.version from package.json — a read that landed in 0.3.1 and went
  // nine releases undetected because every doc asserting the property was written
  // before it and none was revisited. ASSURANCE_CASE §G1 was the worst of them: its
  // Verification column cited a source review for "no fs.read* in the runtime path",
  // which is exactly the review that would have found this. ARCHITECTURE is NOT in
  // the fixed set — its sentence is scoped to the client, and the client really does
  // read nothing, so an absolute claim is only a defect when its subject is the
  // server or the package. Hence the matcher below allows a client-scoped sentence
  // and requires every other absolute claim to name the one file that is read.
  const NO_READ_CLAIM =
    /\b(?:reads?\s+no\s+files|no\s+filesystem\s+reads|never\s+reads\s+from\s+disk|reads?\s+nothing\s+from\s+disk)\b/i;
  // CHANGELOG is excluded on the standing precedent: its entries describe what
  // shipped at the time, and at 0.1.0 the property genuinely held.
  for (const doc of ['README.md', 'HARDENING.md', 'ASSURANCE_CASE.md', 'ARCHITECTURE.md']) {
    const offenders = repoFile(doc)
      .split('\n')
      .filter((l) => NO_READ_CLAIM.test(l))
      .filter((l) => !/saihm_runtime_client|\bthe client\b/i.test(l))
      .filter((l) => !/package\.json/i.test(l));
    assert(
      offenders.length === 0,
      `R26-I ${doc} makes no unqualified no-disk-read claim` +
        (offenders.length ? ` (${offenders[0].trim().slice(0, 80)})` : ''),
    );
  }
  const bestPractices = repoFile('.bestpractices.json');
  assert(
    !NO_READ_CLAIM.test(bestPractices),
    'R26-I .bestpractices.json makes no unqualified no-disk-read claim',
  );
  // Positive half: the property that IS true must be stated, or the correction
  // degrades into simply deleting the claim and telling a reviewer nothing.
  for (const doc of ['README.md', 'HARDENING.md', 'ASSURANCE_CASE.md']) {
    assert(
      /package\.json/.test(repoFile(doc)) && /serverInfo\.version|serverInfo/.test(repoFile(doc)),
      `R26-I ${doc} discloses the one file the server does open and why`,
    );
  }
  // R26-H. The README told users to put config in a .env file "alongside the
  // server". Nothing loads one: there is no dotenv dependency and no fs read on any
  // configuration path, so a user who followed it got an unconfigured server and the
  // README's own "nowhere to reach" error. Pin the dependency fact the fix rests on.
  const pkgJson = JSON.parse(repoFile('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert(
    !('dotenv' in (pkgJson.dependencies ?? {})) && !('dotenv' in (pkgJson.devDependencies ?? {})),
    'R26-H the package still has no dotenv dependency, so the README must not promise .env loading',
  );
  const readmeEnv = repoFile('README.md');
  assert(
    /loads no `?\.env`? file|never reads configuration from disk/i.test(readmeEnv),
    'R26-H README states plainly that no .env file is loaded',
  );
  assert(
    !/Place these in a `\.env` file/i.test(readmeEnv),
    'R26-H README no longer instructs a .env file as the configuration mechanism',
  );

  // ── R27-A. Process controls documented as enforced, with nothing enforcing them. ──
  // HARDENING.md §"Process hardening" claimed "PRs without sign-off are rejected" and
  // "Tests and type-check must pass on Node 20.x *and* 22.x before merge";
  // ASSURANCE_CASE §G-process listed Sign-off, Review and CI gate as process controls.
  // None of the three was enforced by anything: there is no DCO check in
  // .github/workflows/ and no DCO app, `main` carries no branch protection and no
  // rulesets (both verified against the GitHub API), and most commits carry no
  // Signed-off-by trailer — sign-off was adopted in the Silver push and then lapsed.
  // What the docs described as mechanisms are conventions a sole maintainer chooses to
  // follow, which is a materially weaker claim than the one an auditor reading an
  // assurance case takes away. Same class as R26-I: a control asserted as enforced,
  // never revisited after the reality moved.
  //
  // Tested at the granularity of the CLAIM rather than the file, and tied to repo
  // reality rather than to a word blocklist: an automated-DCO claim is legal exactly
  // when a workflow exists that could enforce it, so adding one re-permits the claim
  // with no test edit. Merge-gating is different — branch protection is a repository
  // setting with no in-tree artifact, so a doc cannot evidence it and must not assert
  // it; if it is ever enabled, land a ruleset-as-code file and extend this check.
  const workflowDir = fileURLToPath(new URL('../.github/workflows', import.meta.url));
  const workflowText = readdirSync(workflowDir)
    .map((f) => readFileSync(`${workflowDir}/${f}`, 'utf8'))
    .join('\n');
  const dcoMechanismExists = /signed-off-by|\bdco\b/i.test(workflowText);
  assert(
    /npm ci/.test(workflowText) && /node-version/.test(workflowText),
    'R27-A workflow corpus actually loaded (guards the checks below against an empty read)',
  );

  // The subject has to be a PROCESS artifact. A first cut matched bare
  // "…is rejected" and flagged three genuine, correctly-stated technical controls —
  // the plain-http scheme rejection and both halves of the response-size cap — which
  // would have pushed a later round to "fix" true sentences. Note also that the
  // merge-gate gap cannot use [^.] to stay inside one sentence: the claim it must
  // catch reads "Node 20.x *and* 22.x", and the version dots end the match early.
  const claimsMechanicalEnforcement = (s: string): boolean =>
    /\b(?:PRs?|pull requests?|commits?|contributions?)\b[^.\n]{0,60}?\b(?:are|is|will be) rejected\b/i.test(
      s,
    ) ||
    /\bmust pass\b[\s\S]{0,80}?\bbefore merge\b/i.test(s) ||
    /\brequires?\b[^\n]{0,40}?\bapproval before merge\b/i.test(s);

  // Pin the predicate against the exact strings that shipped and against their
  // replacements. Without this the per-doc loop below asserts nothing on a clean
  // tree — the vacuous-loop failure mode R26-D was caught making.
  for (const [shipped, why] of [
    ['PRs without sign-off are rejected.', 'DCO rejection'],
    ['Tests and type-check must pass on Node 20.x and 22.x before merge.', 'CI merge-gate'],
    ['PRs require maintainer approval before merge.', 'review-gate'],
  ] as const) {
    assert(
      claimsMechanicalEnforcement(shipped),
      `R27-A predicate catches the ${why} claim that shipped`,
    );
  }
  for (const [legal, why] of [
    ['a pull request without sign-off is asked to rebase', 'manual remedy'],
    ['Not a merge gate — no required status check is configured.', 'corrected disclosure'],
    [
      'PRs whose commits lack it are asked to rebase with sign-off before merge.',
      'GOVERNANCE policy',
    ],
  ] as const) {
    assert(!claimsMechanicalEnforcement(legal), `R27-A predicate leaves the ${why} wording legal`);
  }

  for (const doc of ['HARDENING.md', 'ASSURANCE_CASE.md', 'GOVERNANCE.md', 'CONTRIBUTING.md']) {
    for (const block of repoFile(doc).split(/\n\s*\n/)) {
      const flat = block.replace(/\s+/g, ' ');
      if (!claimsMechanicalEnforcement(flat)) continue;
      const aboutDco = /sign-off|signed-off-by|dco/i.test(flat);
      assert(
        aboutDco && dcoMechanismExists,
        `R27-A ${doc} asserts mechanical enforcement only where a mechanism backs it` +
          ` (${flat.trim().slice(0, 72)})`,
      );
    }
  }

  // And the gaps must be disclosed, not merely un-overclaimed. Silence would pass
  // every check above while still leaving a reader to assume the controls are gates.
  assert(
    /no branch protection and\s+no rulesets/i.test(repoFile('HARDENING.md').replace(/\s+/g, ' ')),
    'R27-A HARDENING discloses that CI is not a required status check',
  );
  assert(
    /not an enforced control/i.test(repoFile('HARDENING.md')),
    'R27-A HARDENING records DCO sign-off as a gap rather than a control',
  );
  assert(
    /Gap — documented, not enforced/.test(repoFile('ASSURANCE_CASE.md')) &&
      /Gap — convention, not enforced/.test(repoFile('ASSURANCE_CASE.md')),
    'R27-A ASSURANCE_CASE marks the sign-off and review rows as gaps',
  );
  assert(
    /no branch protection and no rulesets/i.test(
      repoFile('ASSURANCE_CASE.md').replace(/\s+/g, ' '),
    ),
    'R27-A ASSURANCE_CASE residual risk states the controls are conventions, not mechanisms',
  );
  {
    const bp = JSON.parse(repoFile('.bestpractices.json')) as Record<string, string>;
    assert(
      !/DCO sign-off on every commit/i.test(bp.hardening_justification ?? ''),
      'R27-A .bestpractices hardening_justification no longer lists DCO as an enforced control',
    );
    assert(
      /not an automated gate/i.test(bp.dco_justification ?? ''),
      'R27-A .bestpractices dco_justification states the mechanism is a documented policy',
    );
  }

  // A count like "41 of 53 commits" goes stale on the next commit — the R26-D staleness
  // class. The corrected wording must stay qualitative.
  for (const doc of ['HARDENING.md', 'ASSURANCE_CASE.md', '.bestpractices.json']) {
    assert(
      !/\b\d+ of (?:the )?\d+ commits\b/i.test(repoFile(doc)),
      `R27-A ${doc} states the sign-off shortfall without a count that goes stale`,
    );
  }

  // ── R27-B. The field universe is mostly placeholders; no shipped doc said so. ──
  // reporting/field_universe.ts is candid in its own header: GDPR Art.15/17 are
  // verbatim canonical names and "the remaining frameworks ship with deterministic
  // structural placeholders (`<prefix>_F##`) that operators can map to their own
  // canonical names". That disclosure never reached the artifact. README and
  // ARCHITECTURE both advertised "280 fields (262 framework + 18 ledger)" flat, and
  // README's `framework` enum accepts `soc2-t1`, `iso27001` and `aml` — so a reader
  // sizing the library for an ISO 27001 report would count 31 fields and get 31
  // opaque slots. The counts were never false; what they implied about coverage was.
  // README matters most here: `files` ships only dist/, LICENSE and README.md, so an
  // npm consumer has no route to the source header short of browsing GitHub.
  //
  // Numbers are asserted against the MODULE, not against literals, so the universe
  // and the prose cannot drift apart — grow the universe and the docs must follow.
  const isPlaceholderField = (f: string): boolean =>
    /_F\d\d$/.test(f) || /_item_\d\d$/.test(f) || /_part_v_\d\d$/.test(f);
  const placeholderFields = FIELD_UNIVERSE.filter(isPlaceholderField).length;
  const canonicalFields = FIELD_UNIVERSE.length - placeholderFields;
  assert(
    placeholderFields > canonicalFields,
    'R27-B most of FIELD_UNIVERSE is structural placeholders (the fact being disclosed)',
  );

  const disclosesPlaceholders = (s: string): boolean =>
    /structural placeholders?/i.test(s) &&
    /maps? to (?:your|its|their) own canonical names/i.test(s);
  // Pinned against the sentence that shipped and against both replacements, so the
  // loop below is never the only thing exercising it.
  assert(
    !disclosesPlaceholders(
      '**Field universe** (`FIELD_UNIVERSE`) — 280 fields (262 framework + 18 ledger).' +
        ' Templates that project a field outside this set are rejected at validation.',
    ),
    'R27-B predicate rejects the bare count sentence that shipped',
  );
  assert(
    disclosesPlaceholders(
      'deterministic structural placeholders (`iso27001_F01`) that you map to your own' +
        ' canonical names',
    ),
    'R27-B predicate accepts the corrected README disclosure',
  );
  assert(
    disclosesPlaceholders(
      'deterministic structural placeholders (`<prefix>_F##`) that the operator maps to its' +
        ' own canonical names',
    ),
    'R27-B predicate accepts the corrected ARCHITECTURE disclosure',
  );

  for (const doc of ['README.md', 'ARCHITECTURE.md']) {
    const flat = repoFile(doc).replace(/\s+/g, ' ');
    const counts = /(\d+) fields \((\d+) framework \+ (\d+) ledger\)/.exec(flat);
    assert(counts !== null, `R27-B ${doc} states the field-universe counts`);
    assert(
      Number(counts![1]) === FIELD_UNIVERSE.length,
      `R27-B ${doc} total tracks FIELD_UNIVERSE (module says ${FIELD_UNIVERSE.length})`,
    );
    assert(
      Number(counts![2]) + Number(counts![3]) === FIELD_UNIVERSE.length,
      `R27-B ${doc} framework + ledger sums to the universe total`,
    );
    assert(
      disclosesPlaceholders(flat),
      `R27-B ${doc} discloses that most of the universe is operator-mappable placeholders`,
    );
    // Each doc must commit to an explicit split figure, and that figure must equal
    // what the module actually contains. The `assert` on the pair guarantees at
    // least one of the two checks below runs, so neither `if` can go quiet.
    const statedPlaceholders = /\bother (\d+)\b/.exec(flat);
    const statedCanonical = /\bOnly (\d+) are\b/.exec(flat);
    assert(
      statedPlaceholders !== null || statedCanonical !== null,
      `R27-B ${doc} commits to an explicit canonical-vs-placeholder split figure`,
    );
    if (statedPlaceholders)
      assert(
        Number(statedPlaceholders[1]) === placeholderFields,
        `R27-B ${doc} placeholder figure matches the module (${placeholderFields})`,
      );
    if (statedCanonical)
      assert(
        Number(statedCanonical[1]) === canonicalFields,
        `R27-B ${doc} canonical figure matches the module (${canonicalFields})`,
      );
  }

  // ── R28-B. validateAuthForKind's dispatch arms were never routed through. ──
  // The four validators are each tested directly and well, but the dispatcher that
  // picks between them was only ever reached on paths that return BEFORE the switch
  // — a coupling failure and an unknown kind. Coverage showed it: three of the four
  // case arms unexecuted. R19 looked at this switch and correctly dispositioned a
  // different question (it has no `default:`, but checkKindAuthCoupling rejects an
  // unknown path first, so the arm is unreachable rather than missing). Untested
  // routing is the separate risk: validateAuthForKind is the single kind-coupled
  // entry point, so a transposed arm — `case 'operator-self'` calling validateAuthSelf
  // — would hand an operator-path request to the data-subject validator, which checks
  // a different message and a different hash field, and every direct-validator test
  // would still pass. Each validator stamps its own `path` into the success result,
  // so routing is provable: dispatch each path through a kind that accepts it and
  // require the answer to name the path asked for.
  const HEX_A = 'aa'.repeat(32);
  const ROUTING_CASES = [
    ['registry-attestation', { path: 'public' }, 'public'],
    [
      'audit-export',
      {
        path: 'self',
        surface: 'mcp',
        agentIdHash: HEX_A,
        signature: 'sig',
        challenge: 'ch',
        challengeIssuedAt: new Date().toISOString(),
      },
      'self',
    ],
    [
      'billing-history',
      {
        path: 'operator-self',
        operatorIdHash: 'bb'.repeat(32),
        mldsaSignature: 'sig',
        challenge: 'ch',
        challengeIssuedAt: new Date().toISOString(),
      },
      'operator-self',
    ],
    [
      'erasure-confirmation',
      {
        path: 'operator-for-downstream',
        operatorIdHash: 'cc'.repeat(32),
        operatorMldsaSignature: 'sig',
        downstream: {
          type: 'legal-basis',
          subpoenaHash: 'dd'.repeat(32),
          jurisdiction: 'US-NY',
          publicRecordUrl: 'https://courts.example.gov/record/1',
        },
      },
      'operator-for-downstream',
    ],
  ] as const;
  for (const [kind, payload, expectedPath] of ROUTING_CASES) {
    const routed = await validateAuthForKind(kind as never, payload as never);
    assert(
      routed.ok,
      `R28-B dispatcher accepts a valid ${expectedPath} payload for kind '${kind}'`,
    );
    assert(
      routed.ok && routed.path === expectedPath,
      `R28-B dispatcher routes '${expectedPath}' to its own validator` +
        (routed.ok ? ` (got '${routed.path}')` : ''),
    );
  }
  // All four arms must actually have been walked — a shrunk table would quietly
  // reduce this to the one case that was already covered.
  assert(
    ROUTING_CASES.length === 4 && new Set(ROUTING_CASES.map((c) => c[2])).size === 4,
    'R28-B every dispatch arm is exercised, not just the pre-switch returns',
  );

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
