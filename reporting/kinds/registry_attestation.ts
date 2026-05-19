/**
 * SAIHM Reporting Engine — Framework smoke kind: registry-attestation.
 *
 * Public auth; projects four fields:
 *   agentIdHash | cellId | registrationTimestamp | publicMetadata.
 *
 * This is a framework smoke that exercises the full plumbing
 * (auth → projection → output → receipt emission) end-to-end for the
 * simplest happy path; not a customer-facing standard report generator.
 *
 * Output is JSON / CSV today, with a PDF/A-3 placeholder for the
 * `pdfa3` format pending the PDF/A-3 pipeline integration.
 */

import { validateAuthForKind, type AuthVerifiers } from '../auth.js';
import {
  buildReportGenerated,
  buildReportRejected,
  emitReceipt,
  type ReportingRuntime,
} from '../receipt.js';
import { isFieldInUniverse } from '../field_universe.js';
import type {
  AuthPublic,
  GenerateReportResult,
  ReportFormat,
  ReportRequestRegistryAttestation,
} from '../types.js';

// ============================================================================
// Public-record projection (curated whitelist)
// ============================================================================

export interface RegistryAttestationTarget {
  agentIdHash?: string;
  cellId?: string;
}

export interface RegistryRecord {
  agentIdHash?: string;
  cellId?: string;
  registrationTimestamp: string;
  publicMetadata: Record<string, unknown>;
}

// ============================================================================
// Public-registry resolver (operator injects; in-memory stub provided)
// ============================================================================

export interface PublicRegistry {
  resolve(target: RegistryAttestationTarget): Promise<RegistryRecord | null>;
}

export class StubPublicRegistry implements PublicRegistry {
  private readonly records = new Map<string, RegistryRecord>();

  add(key: string, record: RegistryRecord): void {
    this.records.set(key, record);
  }

  async resolve(target: RegistryAttestationTarget): Promise<RegistryRecord | null> {
    const key = target.agentIdHash ?? target.cellId ?? '';
    return this.records.get(key) ?? null;
  }
}

// ============================================================================
// Output rendering (deterministic JSON / CSV; PDF/A-3 placeholder)
// ============================================================================

function renderOutput(record: RegistryRecord, format: ReportFormat): Uint8Array {
  const projection = {
    registry_attestation_agent_id_hash: record.agentIdHash ?? null,
    registry_attestation_cell_id: record.cellId ?? null,
    registry_attestation_registration_timestamp: record.registrationTimestamp,
    registry_attestation_public_metadata: record.publicMetadata,
  };
  for (const k of Object.keys(projection)) {
    if (!isFieldInUniverse(k)) {
      throw new Error(`registry-attestation: field '${k}' not in universe`);
    }
  }
  const body = JSON.stringify(projection, null, 2);
  if (format === 'json') {
    return new TextEncoder().encode(body);
  }
  if (format === 'csv') {
    const rows = Object.entries(projection).map(([k, v]) => `${k},${JSON.stringify(v)}`);
    return new TextEncoder().encode(rows.join('\n'));
  }
  const placeholder = `%PDF-A3 PLACEHOLDER (real PDF/A-3 pending)\n${body}\n%%EOF\n`;
  return new TextEncoder().encode(placeholder);
}

// ============================================================================
// Generator (smoke; framework verification end-to-end)
// ============================================================================

export interface GenerateRegistryAttestationDeps {
  registry: PublicRegistry;
  runtime: ReportingRuntime;
  verifiers?: AuthVerifiers;
}

export async function generateRegistryAttestation(
  request: ReportRequestRegistryAttestation,
  deps: GenerateRegistryAttestationDeps,
): Promise<GenerateReportResult> {
  const auth = await validateAuthForKind('registry-attestation', request.auth, deps.verifiers);
  if (!auth.ok) {
    const rejected = buildReportRejected({
      kind: 'registry-attestation',
      reason: auth.reason,
      requesterIdHash: '0'.repeat(64),
    });
    await emitReceipt(rejected, 'framework-smoke', deps.runtime);
    throw new Error(`registry-attestation: auth rejected: ${auth.reason}`);
  }

  if (!request.target.agentIdHash && !request.target.cellId) {
    const rejected = buildReportRejected({
      kind: 'registry-attestation',
      reason: 'target must include agentIdHash or cellId',
      requesterIdHash: '0'.repeat(64),
    });
    await emitReceipt(rejected, 'framework-smoke', deps.runtime);
    throw new Error('registry-attestation: invalid target');
  }

  const record = await deps.registry.resolve(request.target);
  if (!record) {
    const rejected = buildReportRejected({
      kind: 'registry-attestation',
      reason: 'target not found in public registry',
      requesterIdHash: '0'.repeat(64),
    });
    await emitReceipt(rejected, 'framework-smoke', deps.runtime);
    throw new Error('registry-attestation: target not found');
  }

  const output = renderOutput(record, request.format);

  const generatedReceipt = buildReportGenerated({
    kind: 'registry-attestation',
    scope: {
      customerIdHashes: [request.target.agentIdHash ?? request.target.cellId!],
      timeRange: { from: record.registrationTimestamp, to: new Date().toISOString() },
    },
    format: request.format,
    output,
    requesterIdHash: '0'.repeat(64),
    authChainSummary: auth.chainSummary,
  });

  const emit = await emitReceipt(generatedReceipt, 'framework-smoke', deps.runtime);

  return {
    output,
    outputSha256:
      generatedReceipt.subKind === 'report_generated' ? generatedReceipt.outputSha256 : '',
    receipt: generatedReceipt,
    format: request.format,
    auditCellId: emit.cellId,
    auditSealHex: emit.sealHex,
  };
}

// Auth path narrow alias (this kind only accepts public)
export type RegistryAttestationAuth = AuthPublic;
