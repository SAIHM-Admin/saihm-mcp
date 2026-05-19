/**
 * SAIHM MCP — bare-bones runtime client.
 *
 * Forwards MCP tool calls to a SAIHM operator endpoint over HTTPS. The endpoint
 * is operator-supplied and runs the full SAIHM protocol stack (GC-1..GC-14).
 * This client holds no crypto and no storage — it signs the JSON-RPC envelope
 * with the operator's Wallet C key and lets the endpoint do the protocol work.
 *
 * Configure via env:
 *   SAIHM_ENDPOINT_URL  HTTPS endpoint, e.g. https://operator.example.com/saihm/v1
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
  tier: string;
  kekVersion: number;
  epoch: string;
  feeNcoti: string;
  signaturePrefix: string;
}

export interface RecalledCell {
  cellId: string;
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

export interface StatusSnapshot {
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
    if (!endpoint) throw new Error('SAIHM_ENDPOINT_URL env var required');
    if (!auth) throw new Error("SAIHM_AUTH_HEADER env var required (per operator's auth scheme)");
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
