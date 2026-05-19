/**
 * SAIHM Reporting Engine — Receipt emission.
 *
 * Six sub-kinds, sealed under a stable HKDF receipt domain. This module
 * builds the receipt envelope, computes output_sha256, and forwards to the
 * `ReportingRuntime.emitAudit()` callback the operator injects (which writes
 * the payload into their audit ledger).
 *
 * STRICT EVM ELIMINATION: zero EVM-library imports. SHA-256 via @noble/hashes
 * (already in @saihm/mcp-server deps).
 *
 * The `originator` field on each receipt records whether it came from an
 * operator-side bespoke generator, an upstream-side standard generator, or
 * the framework-smoke kind, for audit-trail clarity.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import {
  HKDF_INDEX_REPORT_RECEIPT,
  HKDF_DOMAIN_REPORT_RECEIPT,
  type ReceiptSubKind,
  type ReportReceipt,
  type ReportKind,
  type ComplianceFramework,
  type ReportFormat,
} from './types.js';

// ============================================================================
// Re-export receipt-domain constants (single source of truth = types.ts)
// ============================================================================

export { HKDF_INDEX_REPORT_RECEIPT, HKDF_DOMAIN_REPORT_RECEIPT };

// ============================================================================
// Originator (audit-trail clarity)
// ============================================================================

export type ReceiptOriginator = 'operator-bespoke' | 'website-standard' | 'framework-smoke';

// ============================================================================
// Audit-ledger payload envelope
// ============================================================================

export interface AuditPayload {
  hkdfIndex: typeof HKDF_INDEX_REPORT_RECEIPT;
  hkdfDomain: typeof HKDF_DOMAIN_REPORT_RECEIPT;
  subKind: ReceiptSubKind;
  originator: ReceiptOriginator;
  receipt: ReportReceipt;
  emittedAt: string;
}

export interface AuditEmitResult {
  cellId: string;
  sealHex: string;
}

// ============================================================================
// Reporting runtime interface (operator injects)
// ============================================================================

export interface ReportingRuntime {
  emitAudit(payload: AuditPayload): Promise<AuditEmitResult>;
}

// ============================================================================
// Helpers
// ============================================================================

export function computeOutputSha256(output: Uint8Array): string {
  const digest = sha256(output);
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function nowIsoZ(): string {
  return new Date().toISOString();
}

// ============================================================================
// Receipt builders (one per sub-kind)
// ============================================================================

export function buildReportGenerated(args: {
  kind: ReportKind;
  framework?: ComplianceFramework;
  templateHash?: string;
  scope: { customerIdHashes: ReadonlyArray<string>; timeRange: { from: string; to: string } };
  format: ReportFormat;
  output: Uint8Array;
  requesterIdHash: string;
  authChainSummary: string;
}): ReportReceipt {
  return {
    subKind: 'report_generated',
    kind: args.kind,
    framework: args.framework,
    templateHash: args.templateHash,
    scope: args.scope,
    format: args.format,
    outputSha256: computeOutputSha256(args.output),
    requesterIdHash: args.requesterIdHash,
    authChainSummary: args.authChainSummary,
    generatedAt: nowIsoZ(),
  } as ReportReceipt;
}

export function buildReportRejected(args: {
  kind: ReportKind;
  scope?: { customerIdHashes: ReadonlyArray<string>; timeRange: { from: string; to: string } };
  reason: string;
  requesterIdHash: string;
}): ReportReceipt {
  return {
    subKind: 'report_rejected',
    kind: args.kind,
    scope: args.scope,
    reason: args.reason,
    requesterIdHash: args.requesterIdHash,
    rejectedAt: nowIsoZ(),
  } as ReportReceipt;
}

export function buildTemplateRegistered(args: {
  templateHash: string;
  operatorIdHash: string;
  schemaVersion: number;
}): ReportReceipt {
  return {
    subKind: 'template_registered',
    templateHash: args.templateHash,
    operatorIdHash: args.operatorIdHash,
    schemaVersion: args.schemaVersion,
    registeredAt: nowIsoZ(),
  };
}

export function buildTemplateSuperseded(args: {
  oldTemplateHash: string;
  newTemplateHash: string;
  operatorIdHash: string;
}): ReportReceipt {
  return {
    subKind: 'template_superseded',
    oldTemplateHash: args.oldTemplateHash,
    newTemplateHash: args.newTemplateHash,
    operatorIdHash: args.operatorIdHash,
    supersededAt: nowIsoZ(),
  };
}

export function buildErasureChainBroken(args: {
  cellIds: ReadonlyArray<string>;
  failingStep: 'gc3' | 'gc4' | 'gc5' | 'post-forget-recall';
  customerIdHash: string;
}): ReportReceipt {
  return {
    subKind: 'erasure_chain_broken',
    cellIds: args.cellIds,
    failingStep: args.failingStep,
    customerIdHash: args.customerIdHash,
    brokenAt: nowIsoZ(),
  };
}

export function buildRateLimitExceeded(args: {
  requesterIdHash: string;
  capLimit: number;
  currentRate: number;
}): ReportReceipt {
  return {
    subKind: 'rate_limit_exceeded',
    requesterIdHash: args.requesterIdHash,
    capLimit: args.capLimit,
    currentRate: args.currentRate,
    exceededAt: nowIsoZ(),
  };
}

// ============================================================================
// Emitter (canonical entry; orchestrates buildAuditPayload + runtime.emitAudit)
// ============================================================================

export function buildAuditPayload(
  receipt: ReportReceipt,
  originator: ReceiptOriginator,
): AuditPayload {
  return {
    hkdfIndex: HKDF_INDEX_REPORT_RECEIPT,
    hkdfDomain: HKDF_DOMAIN_REPORT_RECEIPT,
    subKind: receipt.subKind,
    originator,
    receipt,
    emittedAt: nowIsoZ(),
  };
}

export async function emitReceipt(
  receipt: ReportReceipt,
  originator: ReceiptOriginator,
  runtime: ReportingRuntime,
): Promise<AuditEmitResult> {
  const payload = buildAuditPayload(receipt, originator);
  return runtime.emitAudit(payload);
}

// ============================================================================
// In-memory stub runtime (smoke only; NOT for production)
// ============================================================================

export class InMemoryReportingRuntime implements ReportingRuntime {
  private readonly emitted: AuditPayload[] = [];

  async emitAudit(payload: AuditPayload): Promise<AuditEmitResult> {
    this.emitted.push(payload);
    const serialized = JSON.stringify(payload);
    const cellId = computeOutputSha256(new TextEncoder().encode(serialized));
    const sealHex = computeOutputSha256(
      new TextEncoder().encode(`${HKDF_DOMAIN_REPORT_RECEIPT}:${cellId}`),
    );
    return { cellId, sealHex };
  }

  audit(): ReadonlyArray<AuditPayload> {
    return this.emitted;
  }

  count(): number {
    return this.emitted.length;
  }
}
