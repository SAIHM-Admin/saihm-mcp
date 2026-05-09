/**
 * SAIHM Reporting Engine — Field Universe (security boundary).
 *
 * 262 framework fields + 18 ledger fields. Templates that project any field
 * outside this universe are rejected at JSONSchema validation; the schema
 * is the enforcement, and operators MUST select projections from this
 * enumeration.
 *
 * GDPR Art. 15 and Art. 17 fields are verbatim canonical names with
 * sub-clause citations. The remaining frameworks ship with deterministic
 * structural placeholders (`<prefix>_F##`) that operators can map to their
 * own canonical names; future revisions of this package will replace those
 * with verbatim enumerations against the regulatory primary sources.
 */

// ============================================================================
// Helper: deterministic placeholder generator (operator-mappable)
// ============================================================================

function placeholders(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}_F${String(i + 1).padStart(2, "0")}`);
}

// ============================================================================
// GDPR Art.15 — 12 fields (11 required + 1 optional)
//
// Primary source: https://gdpr-info.eu/art-15-gdpr/
//   (mirror of OJ L 119, 4.5.2016, p.1; EUR-Lex CELEX:32016R0679).
// Verbatim canonical names with per-field GDPR Art.15 sub-clause citations.
// ============================================================================

export const GDPR_ART15_FIELDS: ReadonlyArray<string> = [
  // Required (11) — Art 15(1) preamble + (a)..(h) + Art 15(2)
  "gdpr_art15_processing_confirmation",       // Art 15(1) preamble: confirmation as to whether personal data are being processed
  "gdpr_art15_processing_purposes",           // Art 15(1)(a): "the purposes of the processing"
  "gdpr_art15_data_categories",               // Art 15(1)(b): "the categories of personal data concerned"
  "gdpr_art15_recipients",                    // Art 15(1)(c): recipients or categories of recipient (incl. third countries / intl. orgs)
  "gdpr_art15_storage_period",                // Art 15(1)(d): envisaged storage period or, if not possible, the criteria used
  "gdpr_art15_data_subject_rights",           // Art 15(1)(e): rectification / erasure / restriction / objection rights
  "gdpr_art15_supervisory_complaint",         // Art 15(1)(f): right to lodge a complaint with a supervisory authority
  "gdpr_art15_data_source",                   // Art 15(1)(g): available information as to source when data not from subject
  "gdpr_art15_automated_decision_existence",  // Art 15(1)(h) part 1: existence of automated decision-making, incl. profiling (Art 22(1)+(4))
  "gdpr_art15_automated_decision_logic",      // Art 15(1)(h) parts 2-3: meaningful logic info + significance + envisaged consequences
  "gdpr_art15_third_country_safeguards",      // Art 15(2): notification of safeguards for third-country / intl.-org transfers
  // Optional (1) — Art 15(3) delivery-format preference
  "gdpr_art15_copy_format",                   // Art 15(3): "commonly used electronic form" (data-subject format preference)
];

// ============================================================================
// GDPR Art.17 — 11 fields (7 literal + 4 [ambiguous])
//
// Primary source: https://gdpr-info.eu/art-17-gdpr/
//   (mirror of OJ L 119, 4.5.2016, p.1; EUR-Lex CELEX:32016R0679).
// 7 literal fields enumerate Art 17(1)(a-f) erasure grounds + Art 17(2)
// publication takedown. The 4 [ambiguous] fields cover request-received-at,
// completion-at, exception-applied, and third-party-notification status —
// implied by reading Art.12 + 17 + 19 together but not enumerated literally.
// The engine flags these in output. Art 17(3)(a-e) is collapsed into a
// single composite `exception_applied` enum rather than 5 fields.
// ============================================================================

export const GDPR_ART17_FIELDS: ReadonlyArray<string> = [
  // Literal (7) — Art 17(1)(a-f) erasure grounds + Art 17(2) publication takedown
  "gdpr_art17_erasure_ground_no_longer_necessary",  // Art 17(1)(a): no longer necessary for collection purposes
  "gdpr_art17_erasure_ground_consent_withdrawn",    // Art 17(1)(b): consent withdrawn under Art 6(1)(a) or 9(2)(a), no other legal ground
  "gdpr_art17_erasure_ground_objection",            // Art 17(1)(c): objection under Art 21(1) (no overriding legitimate grounds) or 21(2)
  "gdpr_art17_erasure_ground_unlawful_processing",  // Art 17(1)(d): "the personal data have been unlawfully processed"
  "gdpr_art17_erasure_ground_legal_obligation",     // Art 17(1)(e): erasure required for compliance with Union/Member State legal obligation
  "gdpr_art17_erasure_ground_child_consent_art8_1", // Art 17(1)(f): collected re: Article 8(1) information-society-services to a child
  "gdpr_art17_publication_takedown_status",         // Art 17(2): controller's reasonable steps to inform other controllers (made-public data)
  // [ambiguous] (4) — implied by joint reading Art.12 + Art.17 + Art.19
  "gdpr_art17_request_received_at",         // [ambiguous] Art 12 modalities + Art 17(1) "without undue delay" — when request received
  "gdpr_art17_completion_at",               // [ambiguous] Art 12 timeliness + Art 17(1) — when erasure executed
  "gdpr_art17_exception_applied",           // [ambiguous] Art 17(3)(a-e) composite — which exception (if any) deferred erasure
  "gdpr_art17_third_party_notification",    // [ambiguous] Art 19 — notification status of recipients about the erasure
];

// ============================================================================
// SOC2 T1 — 19 fields (DC-200 + AT-C §205; paywalled, citation-only)
// ============================================================================

export const SOC2_T1_FIELDS: ReadonlyArray<string> = placeholders("soc2_t1", 19);

// ============================================================================
// SOC2 T2 — 21 fields (DC-200 + AT-C §205)
// ============================================================================

export const SOC2_T2_FIELDS: ReadonlyArray<string> = placeholders("soc2_t2", 21);

// ============================================================================
// ISO 27001:2022 — 31 fields (9 conditional on Annex A scope; Advisera map)
// ============================================================================

export const ISO27001_FIELDS: ReadonlyArray<string> = placeholders("iso27001", 31);

// ============================================================================
// AML — 168 fields across 4 sub-prefixes
//   FATF R.16: 13  |  31 CFR 1010.410: 16  |  CTR items: 44  |  SAR + Part V: 95
// ============================================================================

export const AML_FATF_R16_FIELDS: ReadonlyArray<string> = placeholders("aml_fatf_r16", 13);
export const AML_CFR_1010_410_FIELDS: ReadonlyArray<string> = placeholders("aml_cfr_1010_410", 16);
export const AML_CTR_FIELDS: ReadonlyArray<string> = Array.from(
  { length: 44 },
  (_, i) => `aml_ctr_item_${String(i + 1).padStart(2, "0")}`,
);
export const AML_SAR_FIELDS: ReadonlyArray<string> = [
  ...Array.from({ length: 70 }, (_, i) => `aml_sar_item_${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 21 }, (_, i) => `aml_sar_item_${String(i + 78).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, i) => `aml_sar_part_v_${String(i + 1).padStart(2, "0")}`),
];

export const AML_FIELDS: ReadonlyArray<string> = [
  ...AML_FATF_R16_FIELDS,
  ...AML_CFR_1010_410_FIELDS,
  ...AML_CTR_FIELDS,
  ...AML_SAR_FIELDS,
];

// ============================================================================
// Aggregate: 262 framework fields
// ============================================================================

export const FRAMEWORK_FIELDS: ReadonlyArray<string> = [
  ...GDPR_ART15_FIELDS,
  ...GDPR_ART17_FIELDS,
  ...SOC2_T1_FIELDS,
  ...SOC2_T2_FIELDS,
  ...ISO27001_FIELDS,
  ...AML_FIELDS,
];

// ============================================================================
// Ledger fields (additional, non-framework projections)
// ============================================================================

export const REGISTRY_ATTESTATION_FIELDS: ReadonlyArray<string> = [
  "registry_attestation_agent_id_hash",
  "registry_attestation_cell_id",
  "registry_attestation_registration_timestamp",
  "registry_attestation_public_metadata",
];

export const AUDIT_EXPORT_FIELDS: ReadonlyArray<string> = [
  "audit_export_receipt_id",
  "audit_export_receipt_kind",
  "audit_export_receipt_subkind",
  "audit_export_receipt_timestamp",
  "audit_export_receipt_subject",
  "audit_export_receipt_hash",
  "audit_export_receipt_envelope_signature",
];

export const BILLING_HISTORY_FIELDS: ReadonlyArray<string> = [
  "billing_history_invoice_id",
  "billing_history_invoice_amount",
  "billing_history_invoice_currency",
  "billing_history_billing_period_start",
  "billing_history_billing_period_end",
  "billing_history_paid_at",
  "billing_history_line_items",
];

export const LEDGER_FIELDS: ReadonlyArray<string> = [
  ...REGISTRY_ATTESTATION_FIELDS,
  ...AUDIT_EXPORT_FIELDS,
  ...BILLING_HISTORY_FIELDS,
];

// ============================================================================
// Universe (canonical export — security boundary)
// ============================================================================

export const FIELD_UNIVERSE: ReadonlyArray<string> = [...FRAMEWORK_FIELDS, ...LEDGER_FIELDS];

export const FIELD_UNIVERSE_SET: ReadonlySet<string> = new Set(FIELD_UNIVERSE);

// ============================================================================
// Membership check
// ============================================================================

export function isFieldInUniverse(field: string): boolean {
  return FIELD_UNIVERSE_SET.has(field);
}
