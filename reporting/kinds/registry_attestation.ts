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

/**
 * The single definition of "which identifier identifies this target".
 *
 * It used to be decided three separate times with two different notions of
 * present: the generator's guard tested truthiness (`!agentIdHash && !cellId`)
 * while the resolver and the receipt scope both used `??`, which treats '' as a
 * value. So `{ agentIdHash: '', cellId: 'abc' }` passed the guard and was then
 * looked up — and recorded — under '' rather than 'abc'. Either the requester was
 * told "target not found" for a record that exists, or a report_generated receipt
 * was written whose scope names nobody. A receipt is a durable claim about who a
 * disclosure covered, so it must not be able to say that.
 */
export function resolveTargetSubject(target: RegistryAttestationTarget): string | undefined {
  for (const v of [target.agentIdHash, target.cellId]) {
    if (typeof v === 'string' && v !== '') return v;
  }
  return undefined;
}

export class StubPublicRegistry implements PublicRegistry {
  private readonly records = new Map<string, RegistryRecord>();

  add(key: string, record: RegistryRecord): void {
    this.records.set(key, record);
  }

  async resolve(target: RegistryAttestationTarget): Promise<RegistryRecord | null> {
    // Same notion of present as the generator, so a raw target handed straight to
    // the stub by an operator resolves the same way it would through the generator.
    const key = resolveTargetSubject(target);
    return key === undefined ? null : (this.records.get(key) ?? null);
  }
}

// ============================================================================
// Output rendering (deterministic JSON / CSV; PDF/A-3 placeholder)
// ============================================================================

/**
 * Render one CSV cell to RFC 4180, neutralising spreadsheet formulas.
 *
 * publicMetadata is free-form data from a PUBLIC registry, so its contents are
 * whatever the registering party put there. It used to be interpolated as bare
 * `JSON.stringify(v)`, which fails twice. Structurally: an object or a string
 * containing a comma or a quote spilled into extra columns, so the attestation
 * parsed as a different document than the JSON form of the same record. And an
 * attestation is an export — a value beginning with =, +, - or @ is executed as a
 * formula the moment an auditor opens the file in a spreadsheet, which is the whole
 * of CSV injection. Prefixing with an apostrophe is what stops the evaluation;
 * quoting alone does not.
 */
function csvCell(value: unknown): string {
  const raw = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

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
    const rows = Object.entries(projection).map(([k, v]) => `${csvCell(k)},${csvCell(v)}`);
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

/**
 * Record the rejection, then fail with the reason for it.
 *
 * The rejection is the primary fact. emitReceipt throws when the operator's audit
 * callback returns nothing usable, and an unguarded `await` here let that replace the
 * rejection reason outright — so an operator with a broken audit ledger saw "audit
 * emission failed" for every bad credential and never learned the credential was bad.
 * Both facts are reported, cause first.
 */
async function rejectWithReceipt(
  reason: string,
  thrown: string,
  deps: GenerateRegistryAttestationDeps,
): Promise<never> {
  const rejected = buildReportRejected({
    kind: 'registry-attestation',
    reason,
    requesterIdHash: '0'.repeat(64),
  });
  try {
    await emitReceipt(rejected, 'framework-smoke', deps.runtime);
  } catch (err) {
    throw new Error(
      `${thrown} (additionally, the rejection receipt could not be recorded: ` +
        `${err instanceof Error ? err.message : String(err)})`,
    );
  }
  throw new Error(thrown);
}

export async function generateRegistryAttestation(
  request: ReportRequestRegistryAttestation,
  deps: GenerateRegistryAttestationDeps,
): Promise<GenerateReportResult> {
  const auth = await validateAuthForKind('registry-attestation', request.auth, deps.verifiers);
  if (!auth.ok) {
    return rejectWithReceipt(
      auth.reason,
      `registry-attestation: auth rejected: ${auth.reason}`,
      deps,
    );
  }

  const subject = resolveTargetSubject(request.target);
  if (subject === undefined) {
    return rejectWithReceipt(
      'target must include agentIdHash or cellId',
      'registry-attestation: invalid target',
      deps,
    );
  }

  const record = await deps.registry.resolve(request.target);
  if (!record) {
    return rejectWithReceipt(
      'target not found in public registry',
      'registry-attestation: target not found',
      deps,
    );
  }

  const output = renderOutput(record, request.format);

  const generatedReceipt = buildReportGenerated({
    kind: 'registry-attestation',
    scope: {
      customerIdHashes: [subject],
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
