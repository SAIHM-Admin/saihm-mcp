/**
 * SAIHM Reporting Engine — Types.
 *
 * Discriminated unions for ReportRequest, ReportTemplate, ReportReceipt,
 * AuthorizationPayload. Type definitions cover every report kind for
 * reference clarity; this package ships generators only for `bespoke` and
 * the `registry-attestation` framework smoke.
 */

// ============================================================================
// Report kinds
// ============================================================================

export type ReportKind =
  | 'compliance-attestation'
  | 'audit-export'
  | 'erasure-confirmation'
  | 'billing-history'
  | 'bespoke'
  | 'registry-attestation';

export type ComplianceFramework =
  | 'gdpr-art-15'
  | 'gdpr-art-17'
  | 'soc2-t1'
  | 'soc2-t2'
  | 'iso27001'
  | 'aml';

export type ReportFormat = 'pdfa3' | 'json' | 'csv';

// ============================================================================
// Authorization paths
// ============================================================================

export interface AuthPublic {
  path: 'public';
}

export interface AuthSelf {
  path: 'self';
  surface: 'web' | 'mcp';
  walletIdHash?: string;
  agentIdHash?: string;
  signature: string;
  challenge: string;
  challengeIssuedAt: string;
}

export interface AuthOperatorSelf {
  path: 'operator-self';
  operatorIdHash: string;
  mldsaSignature: string;
  challenge: string;
}

export interface AuthOperatorForDownstream {
  path: 'operator-for-downstream';
  operatorIdHash: string;
  operatorMldsaSignature: string;
  downstream:
    | {
        type: 'customer-grant';
        customerIdHash: string;
        scope: string;
        expiresAt: string;
        customerSignature: string;
      }
    | {
        type: 'legal-basis';
        subpoenaHash: string;
        jurisdiction: string;
        publicRecordUrl: string;
      };
}

export type AuthorizationPayload =
  | AuthPublic
  | AuthSelf
  | AuthOperatorSelf
  | AuthOperatorForDownstream;

// ============================================================================
// Kind-vs-auth coupling
// ============================================================================

export const KIND_AUTH_REQUIREMENTS: Record<
  ReportKind,
  ReadonlyArray<AuthorizationPayload['path']>
> = {
  'compliance-attestation': ['self', 'operator-self', 'operator-for-downstream'],
  'audit-export': ['self', 'operator-self'],
  'erasure-confirmation': ['self', 'operator-for-downstream'],
  'billing-history': ['self', 'operator-self'],
  bespoke: ['operator-self', 'operator-for-downstream'],
  'registry-attestation': ['public'],
} as const;

// ============================================================================
// Report request scope
// ============================================================================

export interface ReportScope {
  customerIdHashes: ReadonlyArray<string>;
  timeRange: {
    from: string;
    to: string;
  };
}

// ============================================================================
// Bespoke template
// ============================================================================

export interface BespokeReportTemplate {
  templateId: string;
  templateVersion: number;
  operatorIdHash: string;
  scope: ReportScope;
  framework: ComplianceFramework | 'audit-export' | 'billing-history' | 'registry-attestation';
  fieldProjections: ReadonlyArray<string>;
  filters?: Record<string, unknown>;
  format: ReportFormat;
}

// ============================================================================
// Report request (discriminated by kind)
// ============================================================================

export interface ReportRequestBespoke {
  kind: 'bespoke';
  templateHash: string;
  scope: ReportScope;
  format: ReportFormat;
  auth: AuthOperatorSelf | AuthOperatorForDownstream;
}

export interface ReportRequestRegistryAttestation {
  kind: 'registry-attestation';
  target: { agentIdHash?: string; cellId?: string };
  format: ReportFormat;
  auth: AuthPublic;
}

export type ReportRequest = ReportRequestBespoke | ReportRequestRegistryAttestation;

// ============================================================================
// Receipt sub-kinds (HKDF receipt domain)
// ============================================================================

export type ReceiptSubKind =
  | 'report_generated'
  | 'report_rejected'
  | 'template_registered'
  | 'template_superseded'
  | 'erasure_chain_broken'
  | 'rate_limit_exceeded';

export const HKDF_INDEX_REPORT_RECEIPT = 166 as const;
export const HKDF_DOMAIN_REPORT_RECEIPT = 'MPS-REPORT-RECEIPT-v1' as const;

// ============================================================================
// Receipt payloads
// ============================================================================

export interface ReceiptReportGenerated {
  subKind: 'report_generated';
  kind: ReportKind;
  framework?: ComplianceFramework;
  templateHash?: string;
  scope: ReportScope;
  format: ReportFormat;
  outputSha256: string;
  requesterIdHash: string;
  authChainSummary: string;
  generatedAt: string;
}

export interface ReceiptReportRejected {
  subKind: 'report_rejected';
  kind: ReportKind;
  scope?: ReportScope;
  reason: string;
  requesterIdHash: string;
  rejectedAt: string;
}

export interface ReceiptTemplateRegistered {
  subKind: 'template_registered';
  templateHash: string;
  operatorIdHash: string;
  schemaVersion: number;
  registeredAt: string;
}

export interface ReceiptTemplateSuperseded {
  subKind: 'template_superseded';
  oldTemplateHash: string;
  newTemplateHash: string;
  operatorIdHash: string;
  supersededAt: string;
}

export interface ReceiptErasureChainBroken {
  subKind: 'erasure_chain_broken';
  cellIds: ReadonlyArray<string>;
  failingStep: 'gc3' | 'gc4' | 'gc5' | 'post-forget-recall';
  customerIdHash: string;
  brokenAt: string;
}

export interface ReceiptRateLimitExceeded {
  subKind: 'rate_limit_exceeded';
  requesterIdHash: string;
  capLimit: number;
  currentRate: number;
  exceededAt: string;
}

export type ReportReceipt =
  | ReceiptReportGenerated
  | ReceiptReportRejected
  | ReceiptTemplateRegistered
  | ReceiptTemplateSuperseded
  | ReceiptErasureChainBroken
  | ReceiptRateLimitExceeded;

// ============================================================================
// Validation result envelope
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: ReadonlyArray<string>;
}

// ============================================================================
// Generator result envelope
// ============================================================================

export interface GenerateReportResult {
  output: Uint8Array;
  outputSha256: string;
  receipt: ReportReceipt;
  format: ReportFormat;
  auditCellId: string;
  auditSealHex: string;
}
