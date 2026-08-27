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
  UNVERIFIED_MARKERS,
  chainSummaryIsUnverified,
  checkKindAuthCoupling,
  validateAuthPublic,
  validateAuthSelf,
  validateAuthOperatorSelf,
  validateAuthOperatorForDownstream,
  validateAuthForKind,
  // Exported because an operator has to sign the same bytes this module verifies;
  // without them the canonical encoding would have to be reimplemented by hand on
  // the signing side, and any divergence shows up as a signature that never verifies.
  operatorDownstreamMessage,
  customerGrantMessage,
  selfChallengeMessage,
  operatorSelfChallengeMessage,
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

// resolveTargetSubject is exported so an operator's own PublicRegistry resolves a
// target by the same rule the generator uses to record it in the receipt scope.
export {
  generateRegistryAttestation,
  StubPublicRegistry,
  resolveTargetSubject,
} from './kinds/registry_attestation.js';

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
import {
  BespokeTemplateSchema as _Schema,
  validateBespokeTemplate as _validate,
} from './template_schema.js';
import { buildTemplateRegistered as _builtRegistered, emitReceipt as _emit } from './receipt.js';
import type { ReportingRuntime as _RT } from './receipt.js';
import type { BespokeReportTemplate, ReportReceipt, ValidationResult } from './types.js';

/**
 * Deterministic JSON with keys sorted at EVERY level.
 *
 * The template hash was computed as `JSON.stringify(template, Object.keys(template).sort())`.
 * An array second argument to JSON.stringify is not a key ORDER — it is a property
 * ALLOWLIST applied at every nesting depth. Only the top-level key names were in it, so
 * `scope` and `filters` both serialized as `{}` and the hash committed to neither.
 * Two templates differing only in customerIdHashes, timeRange and filters produced the
 * SAME templateHash, and that hash is the durable identity of the registration — it is
 * what `template_registered` records and what both halves of `template_superseded`
 * reference. The audit ledger could not distinguish a template scoped to one customer
 * for one day from one scoped to 10,000 customers for a year, nor show that a supersede
 * had widened the scope. Committing to the whole structure is the point of hashing it.
 *
 * It also made the hashed shape depend on fields nobody validated: an unrelated extra
 * top-level key happening to be named `customerIdHashes` would put that name in the
 * allowlist and un-strip the nested one.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

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
  // The hash commits to the VALIDATED projection, not to the raw argument. A zod object
  // parse strips unknown keys, so validation ran against a narrower shape than the one
  // being hashed: a template carrying arbitrary extra keys validated clean and still
  // changed templateHash. That hash is the durable identity of the registration — what
  // `template_registered` records and what both halves of `template_superseded`
  // reference — so it was committing to content that nothing validated, capped or read,
  // while every field that IS validated is capped. It also forked identity on data that
  // is not part of the template, which is the same invariant the suite already pins for
  // an explicitly-undefined optional: something that is not part of what was registered
  // must not change what the registration is called.
  //
  // Re-parsing, rather than threading the value out of validateBespokeTemplate, leaves
  // that function's exported ValidationResult contract alone. It cannot throw here —
  // `valid` is only returned after the same safeParse has already succeeded — and a
  // template that was already conformant hashes to exactly what it did before, because
  // canonicalJson sorts keys at every level and drops undefined either way.
  const canonical = canonicalJson(_Schema.parse(template));
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
