/**
 * SAIHM Reporting Engine — Package Entry (`@saihm/mcp-server/reporting`)
 *
 * Operator-facing primitives. Exposes:
 *   - Framework primitives (field_universe, template_schema, types, auth, receipt)
 *   - Bespoke template registration (operator-self-serve)
 *   - registry-attestation framework smoke (verifies plumbing end-to-end)
 *
 * Customer-facing standard report generators (compliance-attestation,
 * audit-export, erasure-confirmation, billing-history) are produced upstream
 * and not part of this package; operators compose their own bespoke reports
 * on the primitives below.
 */

// ============================================================================
// Field universe (262 framework + 18 ledger placeholders/verbatim)
// ============================================================================

export {
  GDPR_ART15_FIELDS,
  GDPR_ART17_FIELDS,
  SOC2_T1_FIELDS,
  SOC2_T2_FIELDS,
  ISO27001_FIELDS,
  AML_FATF_R16_FIELDS,
  AML_CFR_1010_410_FIELDS,
  AML_CTR_FIELDS,
  AML_SAR_FIELDS,
  AML_FIELDS,
  FRAMEWORK_FIELDS,
  REGISTRY_ATTESTATION_FIELDS,
  AUDIT_EXPORT_FIELDS,
  BILLING_HISTORY_FIELDS,
  LEDGER_FIELDS,
  FIELD_UNIVERSE,
  FIELD_UNIVERSE_SET,
  isFieldInUniverse,
} from './field_universe.js';

// ============================================================================
// Template schema (LOAD-BEARING; security boundary)
// ============================================================================

export {
  MAX_FIELD_PROJECTIONS,
  MAX_CUSTOMER_IDS_PER_SCOPE,
  MAX_TIME_WINDOW_DAYS,
  BespokeTemplateSchema,
  validateBespokeTemplate,
  projectionsAreInUniverse,
} from './template_schema.js';

// ============================================================================
// Types
// ============================================================================

export type {
  ReportKind,
  ComplianceFramework,
  ReportFormat,
  AuthPublic,
  AuthSelf,
  AuthOperatorSelf,
  AuthOperatorForDownstream,
  AuthorizationPayload,
  ReportScope,
  BespokeReportTemplate,
  ReportRequest,
  ReportRequestBespoke,
  ReportRequestRegistryAttestation,
  ReceiptSubKind,
  ReceiptReportGenerated,
  ReceiptReportRejected,
  ReceiptTemplateRegistered,
  ReceiptTemplateSuperseded,
  ReceiptErasureChainBroken,
  ReceiptRateLimitExceeded,
  ReportReceipt,
  ValidationResult,
  GenerateReportResult,
} from './types.js';

export {
  KIND_AUTH_REQUIREMENTS,
  HKDF_INDEX_REPORT_RECEIPT,
  HKDF_DOMAIN_REPORT_RECEIPT,
} from './types.js';

// ============================================================================
// Authorization
// ============================================================================

export {
  REPLAY_WINDOW_MS,
  checkKindAuthCoupling,
  validateAuthPublic,
  validateAuthSelf,
  validateAuthOperatorSelf,
  validateAuthOperatorForDownstream,
  validateAuthForKind,
} from './auth.js';

export type { AuthResult, AuthVerifiers } from './auth.js';

// ============================================================================
// Receipt emission (HKDF-derived signing material)
// ============================================================================

export {
  computeOutputSha256,
  nowIsoZ,
  buildReportGenerated,
  buildReportRejected,
  buildTemplateRegistered,
  buildTemplateSuperseded,
  buildErasureChainBroken,
  buildRateLimitExceeded,
  buildAuditPayload,
  emitReceipt,
  InMemoryReportingRuntime,
} from './receipt.js';

export type {
  ReceiptOriginator,
  AuditPayload,
  AuditEmitResult,
  ReportingRuntime,
} from './receipt.js';

// ============================================================================
// Registry-attestation (framework smoke)
// ============================================================================

export { generateRegistryAttestation, StubPublicRegistry } from './kinds/registry_attestation.js';

export type {
  PublicRegistry,
  RegistryAttestationTarget,
  RegistryRecord,
  GenerateRegistryAttestationDeps,
  RegistryAttestationAuth,
} from './kinds/registry_attestation.js';

// ============================================================================
// Bespoke template registration (operator-self-serve)
// ============================================================================

import { sha256 } from '@noble/hashes/sha2.js';
import { validateBespokeTemplate as _validate } from './template_schema.js';
import { buildTemplateRegistered as _builtRegistered, emitReceipt as _emit } from './receipt.js';
import type { ReportingRuntime as _RT } from './receipt.js';
import type { BespokeReportTemplate, ReportReceipt, ValidationResult } from './types.js';

export async function registerTemplate(
  template: BespokeReportTemplate,
  runtime: _RT,
): Promise<
  | { ok: true; templateHash: string; receipt: ReportReceipt; auditCellId: string }
  | { ok: false; errors: ReadonlyArray<string> }
> {
  const v: ValidationResult = _validate(template);
  if (!v.valid) {
    return { ok: false, errors: v.errors };
  }
  const canonical = JSON.stringify(template, Object.keys(template).sort());
  const digest = sha256(new TextEncoder().encode(canonical));
  const templateHash = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  const receipt = _builtRegistered({
    templateHash,
    operatorIdHash: template.operatorIdHash,
    schemaVersion: template.templateVersion,
  });
  const emit = await _emit(receipt, 'operator-bespoke', runtime);
  return { ok: true, templateHash, receipt, auditCellId: emit.cellId };
}
