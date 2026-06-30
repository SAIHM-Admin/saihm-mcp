/**
 * SAIHM MCP — bare-bones runtime client.
 *
 * Forwards MCP tool calls to a SAIHM operator endpoint over HTTPS. The endpoint
 * is operator-supplied and runs the full SAIHM protocol stack behind the 8 MCP tools.
 * This client holds no crypto and no storage — it signs the JSON-RPC envelope
 * with the operator's signing key and lets the endpoint do the protocol work.
 *
 * Configure via env:
 *   SAIHM_ENDPOINT_URL  HTTPS endpoint, e.g. https://operator.example.com/mcp
 *                       Must be `https://` unless the host is `127.0.0.1` or
 *                       `localhost` (dev exception). Plain HTTP is rejected at
 *                       call time to prevent Authorization-header leaks over
 *                       the wire.
 *   SAIHM_AUTH_HEADER   Authorization header value per the operator's auth scheme
 *                       (e.g. "Bearer <token>"). The bare-bones client is
 *                       authentication-agnostic; never send raw private keys.
 *
 * Defensive limits:
 *   REQUEST_TIMEOUT_MS  per-call abort window (30s)
 *   MAX_RESPONSE_BYTES  reject responses whose Content-Length exceeds 16 MB
 */

import { SharingContractType, type SharingContractScope } from './types.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

// First-run pointer: a freshly installed client has no operator endpoint
// configured, so the first tool call throws here. Surface where to go next —
// the offline demos to evaluate the protocol, and the site to obtain a live
// endpoint — instead of leaving a bare "env var required" dead-end.
const SETUP_HINT =
  ' To run live, point this at a SAIHM operator endpoint — get one at' +
  ' https://saihm.coti.global. To evaluate the protocol offline first (no account,' +
  ' about a minute), run the demos at https://citw2.github.io/saihm-demos/';

function assertEndpointUrl(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`SAIHM_ENDPOINT_URL is not a valid URL: ${endpoint}`);
  }
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
   * creation time. Per draft-saihm-memory-protocol-01 §2.1 the nonce
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
  /** KEK generation that sealed this cell's DEK. Spec §2.1. */
  kekVersion: number;
  /** 32-byte hex of the holder's ML-DSA-65 public-key hash. Spec §2.1. */
  holderIdHex: string;
  /**
   * Short prefix (hex) of the holder's ML-DSA-65 signature. Per spec
   * §2.1 the signature is computed over (cellId ‖ holderId ‖
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
 * Spec: draft-saihm-memory-protocol-01 §3.4 (a sharing contract
 * visible to this holder). The spec defines each element as a CBOR
 * object; on the JSON wire this is the structurally equivalent
 * JSON object. The spec does not narrow the array to active-only
 * contracts; operators MAY include expired entries.
 */
export interface ContractEntry {
  /** 32-byte hex contract identifier. Spec §3.4. */
  contractId: string;
  /**
   * Sharing-contract mode. Per spec §2.5 / §3.4 the on-wire string
   * enum is `"TEMPORARY"`, `"PERMANENT"`, or `"SYNDICATE"`. This
   * is the spec-aligned uppercase form; it is independent of the
   * `SharingContractType` enum used by `saihm_share` parameters,
   * which is lowercase for legacy reasons.
   */
  mode: 'TEMPORARY' | 'PERMANENT' | 'SYNDICATE';
  /** Grantee agent ID hashes (each 32-byte hex). Spec §3.4. */
  granteeIds: string[];
  /**
   * Expiry as UNIX epoch seconds (decimal string). Spec §3.4
   * specifies an unsigned integer, so the value is surfaced as
   * `string` to preserve precision for values beyond the JS
   * Number safe-integer ceiling (2^53 - 1). Per spec §2.5 the
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
 * Spec: draft-saihm-memory-protocol-01 §3.4 (a governance proposal
 * visible to the holder). The spec defines each element as a CBOR
 * object; on the JSON wire this is the structurally equivalent
 * JSON object. Field names use snake_case verbatim from the spec.
 * The spec does not narrow the array to a particular state
 * (active / closed / decided); operators MAY include closed
 * proposals.
 */
export interface GovernanceEntry {
  /** 32-byte hex proposal identifier. Spec §3.4. */
  propId: string;
  /**
   * Proposal scope string. The set of permitted scope values is
   * defined by the deployment's published governance form (spec
   * §3.9 item (f)), not by the protocol itself. The reference
   * deployment uses `"emission_param"` and `"protocol_upgrade"`;
   * see the `governancePropose` parameter type on
   * `SaihmRuntimeClient` for that form.
   */
  scope: string;
  /** Voting-window open, UNIX epoch seconds (decimal string). Spec §3.4. */
  opens_ts: string;
  /** Voting-window close, UNIX epoch seconds (decimal string). Spec §3.4. */
  closes_ts: string;
  /**
   * Vote-weight tally in favour (decimal string). Spec §3.4
   * specifies unsigned integer; surfaced as `string` so unbounded
   * weight aggregates beyond 2^53 - 1 remain exact.
   */
  tally_for: string;
  /** Vote-weight tally against (decimal string). Spec §3.4. */
  tally_against: string;
  /** Vote-weight tally abstaining (decimal string). Spec §3.4. */
  tally_abstain: string;
}

export interface StatusSnapshot {
  // ────────── operator-extension fields (0.1.x / 0.2.x; retained) ──────────
  agentIdHashHex: string;
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

  // ────────── §3.4 spec-aligned fields (added 0.3.0) ──────────
  /**
   * Process Reliability Score. Spec §3.4: "IEEE 754 binary64 in
   * the closed interval [0.0, 1.0]. … the fraction of the
   * operator's expected tool-call returns delivered within the
   * operator's published SLA window, computed over a rolling
   * 30-day window."
   */
  prs: number;
  /**
   * Byzantine Fault Score Index. Spec §3.4: "IEEE 754 binary64 in
   * the closed interval [0.0, 1.0]. … the fraction of audit-chain
   * receipts that match a corresponding holder-side tool-call
   * event … bfsi = 1 - (M / R) … When R = 0 … bfsi is defined as
   * 1.0 by convention."
   */
  bfsi: number;
  /**
   * Start of the rolling 30-day window over which `bfsi` (and
   * `prs`) is computed, as UNIX epoch seconds (decimal string).
   * Spec §3.4 specifies unsigned integer; surfaced as `string`
   * for forward-compat with values beyond 2^53 - 1.
   */
  bfsi_window_start_ts: string;
  /**
   * Count of operator-anchored receipts on the audit chain
   * attributed to the holder over the window, as a decimal
   * string. Spec §3.4 specifies unsigned integer; `string`
   * preserves precision for unbounded receipt counts.
   */
  bfsi_R: string;
  /**
   * Count of operator-anchored receipts with no corresponding
   * tool-call event in the holder's local event log, as a decimal
   * string. Spec §3.4 specifies unsigned integer; `string`
   * preserves precision.
   */
  bfsi_M: string;
  /**
   * Shards held under each tier, keyed by tier name, value = cell
   * count. Spec §3.4 ("a CBOR map keyed by tier name, value =
   * unsigned integer count of cells stored under that tier"). On
   * the JSON wire this is the structurally equivalent JSON
   * object. This is conceptually a per-cell-count view; the
   * pre-existing `storageByTier` field surfaces a per-tier byte
   * total and is retained alongside. The value type is `number`
   * (not `string`) because a per-tier cell count is bounded in
   * practice by storage-substrate capacity — well below the JS
   * Number safe-integer ceiling (2^53 - 1) — and using `number`
   * here matches the convention of the pre-existing
   * `storageByTier` field.
   */
  shards: Record<string, number>;
  /** Sharing-contract entries visible to this holder. Spec §3.4. */
  contracts: ContractEntry[];
  /** Governance-proposal entries visible to this holder. Spec §3.4. */
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

export class SaihmRuntimeClient {
  constructor(
    private readonly endpoint: string,
    private readonly authHeader: string,
  ) {
    assertEndpointUrl(endpoint);
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
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: this.authHeader,
        },
        body: JSON.stringify({ method, params }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`SAIHM endpoint ${method} failed: ${res.status} ${res.statusText}`);
      }
      const cl = Number(res.headers.get('content-length') ?? '0');
      if (cl > MAX_RESPONSE_BYTES) {
        throw new Error(
          `SAIHM endpoint ${method} response too large: ${cl}B (max ${MAX_RESPONSE_BYTES}B)`,
        );
      }
      return (await res.json()) as T;
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
