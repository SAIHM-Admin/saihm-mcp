/**
 * SAIHM Reporting Engine — Bespoke Template JSONSchema.
 *
 * The schema is the enforcement: templates that violate any constraint are
 * rejected at validation, before any generator sees them. Operators register
 * their bespoke templates here; the `framework` enum includes standard
 * frameworks so operators can project framework fields into their own
 * bespoke templates.
 */

import { z } from 'zod';
import { FIELD_UNIVERSE_SET, isFieldInUniverse } from './field_universe.js';
import type { ValidationResult } from './types.js';

// ============================================================================
// Caps
// ============================================================================

export const MAX_FIELD_PROJECTIONS = 200;
export const MAX_CUSTOMER_IDS_PER_SCOPE = 10_000;
export const MAX_TIME_WINDOW_DAYS = 366;

// ============================================================================
// Zod runtime validator (canonical schema; adds universe-membership + caps)
// ============================================================================

const HEX_64 = /^[a-f0-9]{64}$/;
const TEMPLATE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

const ScopeSchema = z.object({
  customerIdHashes: z.array(z.string().regex(HEX_64)).min(1).max(MAX_CUSTOMER_IDS_PER_SCOPE),
  timeRange: z.object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  }),
});

const FrameworkSchema = z.enum([
  'gdpr-art-15',
  'gdpr-art-17',
  'soc2-t1',
  'soc2-t2',
  'iso27001',
  'aml',
  'audit-export',
  'billing-history',
  'registry-attestation',
]);

const FormatSchema = z.enum(['pdfa3', 'json', 'csv']);

export const BespokeTemplateSchema = z.object({
  templateId: z.string().regex(TEMPLATE_ID),
  templateVersion: z.number().int().min(1),
  operatorIdHash: z.string().regex(HEX_64),
  scope: ScopeSchema,
  framework: FrameworkSchema,
  fieldProjections: z.array(z.string()).min(1).max(MAX_FIELD_PROJECTIONS),
  filters: z.record(z.string(), z.unknown()).optional(),
  format: FormatSchema,
});

// ============================================================================
// Validator: structural + universe + scope-isolation
// ============================================================================

export function validateBespokeTemplate(input: unknown): ValidationResult {
  const errors: string[] = [];

  const parsed = BespokeTemplateSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return { valid: false, errors };
  }

  const t = parsed.data;

  for (const field of t.fieldProjections) {
    if (!isFieldInUniverse(field)) {
      // Size read from the set, not written as a literal. The message used to say
      // "262-field universe" while enforcement ran against all 280 (262 framework +
      // 18 ledger), so an operator debugging a rejection counted the wrong boundary.
      errors.push(
        `fieldProjections: '${field}' not in ${FIELD_UNIVERSE_SET.size}-field universe` +
          ' (security boundary)',
      );
    }
  }

  const fromMs = Date.parse(t.scope.timeRange.from);
  const toMs = Date.parse(t.scope.timeRange.to);
  if (toMs <= fromMs) {
    errors.push("scope.timeRange: 'to' must be after 'from'");
  }
  const windowDays = (toMs - fromMs) / (1000 * 60 * 60 * 24);
  if (windowDays > MAX_TIME_WINDOW_DAYS) {
    errors.push(
      `scope.timeRange: window ${windowDays.toFixed(1)}d exceeds max ${MAX_TIME_WINDOW_DAYS}d`,
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, errors: [] };
}

// ============================================================================
// Universe-membership check (exported for direct use by generators)
// ============================================================================

/**
 * Membership only: it answers whether every listed field is a known one. An empty
 * list therefore passes, because no member of it is unknown.
 *
 * The template schema separately requires fieldProjections to be non-empty, so on
 * that one input the two exported checks disagree, and a generator gating solely on
 * this one will build a zero-field projection that validateTemplate refuses. The
 * disagreement is in the safe direction — an empty projection discloses nothing —
 * but gate on the schema when the question is "is this a usable template" rather
 * than "are these fields ones I know".
 */
export function projectionsAreInUniverse(fields: ReadonlyArray<string>): {
  valid: boolean;
  invalid: ReadonlyArray<string>;
} {
  const invalid = fields.filter((f) => !FIELD_UNIVERSE_SET.has(f));
  return { valid: invalid.length === 0, invalid };
}
