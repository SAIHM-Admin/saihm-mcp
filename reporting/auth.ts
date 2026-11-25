// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SAIHM, Inc.
/**
 * SAIHM Reporting Engine — Authorization path validators.
 *
 * Four auth paths: public / self / operator-self / operator-for-downstream.
 * This module performs structural validation (shape, hex formats, replay
 * windows, kind-vs-auth coupling); cryptographic signature verification
 * (ML-DSA / EIP-712) is performed by injected verifier callbacks. Leaving
 * EVERY verifier callback undefined enables shape-only smoke-test mode;
 * wiring any of them opts the whole module in, and from then on a path whose
 * own verifier is missing is refused rather than passed with a marker. There is
 * one deliberate exception, and README states it too: the customer half of a
 * customer-grant stays a marker rather than a refusal, because a grant may have
 * been authenticated out of band. Read the rule as absolute for every operator
 * and self signature, and as holding everywhere but there.
 *
 * STRICT EVM ELIMINATION: zero EVM-library imports. EIP-712 verify, when
 * wired by an operator, uses @noble/curves secp256k1 directly — no EVM
 * SDK, no eth_* RPC, pure crypto only.
 *
 * chainSummary is not decoration: generateRegistryAttestation copies it into the
 * report_generated receipt as authChainSummary, where it becomes the durable record
 * of how a disclosure was authorized. So a summary must never read as though
 * signatures were checked when none were. Any path that returns ok:true without a
 * verifier having actually run says so, in the summary itself, via UNVERIFIED.
 */

import type {
  AuthorizationPayload,
  AuthPublic,
  AuthSelf,
  AuthOperatorSelf,
  AuthOperatorForDownstream,
  ReportKind,
} from './types.js';
import { KIND_AUTH_REQUIREMENTS } from './types.js';

// ============================================================================
// Result envelope
// ============================================================================

export type AuthResult =
  | { ok: true; path: AuthorizationPayload['path']; chainSummary: string }
  | { ok: false; reason: string };

export const REPLAY_WINDOW_MS = 30 * 60 * 1000;

// Derived rather than written out. REPLAY_WINDOW_MS is exported, so it is a value a
// maintainer can reasonably retune — and three refusal messages quote its length back
// to the caller. Spelled literally, changing the constant would leave all three naming
// a window that is no longer the one being enforced, and no test would notice: the
// suite pins the message against a literal of its own, so both sides would agree on
// the same wrong number. Deriving it here means the constant is the only place the
// window is stated, and the suite's literal becomes the tripwire that says so.
const CHALLENGE_EXPIRED_REASON = `challenge expired (replay window ${REPLAY_WINDOW_MS / 60_000}min)`;

/**
 * How far ahead of this machine's clock a challenge timestamp may be stamped and
 * still be accepted. Operator and caller clocks drift apart, and refusing an honest
 * challenge over that drift would reject live traffic; past this it is not drift.
 * Named rather than inlined because three paths now apply it and a hardening pass
 * that tightened one copy would leave the others quietly looser.
 */
const CLOCK_SKEW_ALLOWANCE_MS = 60 * 1000;

const HEX_64 = /^[a-f0-9]{64}$/;

/**
 * Appended to the chainSummary of any path that passed structural validation with
 * no verifier wired. Shape-only mode is a legitimate smoke-test posture, but it must
 * be legible afterwards: without this marker a receipt from a smoke run and a receipt
 * from a fully verified disclosure are the same string.
 */
const UNVERIFIED = '/UNVERIFIED-shape-only';

/**
 * Every marker that means "this ok:true was not backed by a signature check".
 *
 * There are three, not one, because operator-for-downstream reports its two halves
 * separately. A case-sensitive substring test for the upper-case marker matches none of
 * the other two, so it would read a wholly unverified downstream disclosure as verified:
 * the one direction this check must never fail in.
 * Exported as a predicate so the set lives in one place instead of being reassembled by
 * hand at each call site.
 */
export const UNVERIFIED_MARKERS: ReadonlyArray<string> = [
  UNVERIFIED,
  '/operator-sig-unverified',
  '/customer-sig-unverified',
];

/** True when a chainSummary carries any marker meaning no signature was actually checked. */
export function chainSummaryIsUnverified(chainSummary: string): boolean {
  return UNVERIFIED_MARKERS.some((m) => chainSummary.includes(m));
}

/**
 * The exact bytes an operator must sign to authorize a downstream disclosure.
 *
 * The operator signs the whole claim, not just auth.operatorIdHash — the operator's
 * own identity, a value that never changes. A signature over a constant would be a
 * bearer token: one observed request would yield a credential valid for every later
 * request, committing to none of the claim, so the customerIdHash, the scope, the
 * expiry, the subpoena hash and the jurisdiction could be swapped afterwards. On a
 * path whose whole purpose is disclosing one party's data to another, each of those
 * is part of what the operator approves (and the customer half is verified on its
 * own; see validateAuthOperatorForDownstream).
 *
 * The customer's signature is inside the operator's signed message on purpose: it
 * stops a valid operator approval being lifted onto a different customer grant.
 *
 * Encoded as a JSON array rather than concatenation so field boundaries survive —
 * joining raw strings lets scope 'a' + id 'bc' collide with scope 'ab' + id 'c'.
 */
export function operatorDownstreamMessage(auth: AuthOperatorForDownstream): string {
  const d = auth.downstream;
  const claim =
    d.type === 'customer-grant'
      ? ['customer-grant', d.customerIdHash, d.scope, d.expiresAt, d.customerSignature]
      : ['legal-basis', d.subpoenaHash, d.jurisdiction, d.publicRecordUrl];
  // The time field goes last, as it does on operator-self. Every path's signed message
  // is new in 0.3.11, so operators re-sign for this release regardless; adding the slot
  // now costs nothing, whereas adding it later would cost a second signature break.
  return JSON.stringify([
    'SAIHM-REPORT-OPERATOR-DOWNSTREAM-v1',
    auth.operatorIdHash,
    ...claim,
    auth.challengeIssuedAt ?? '',
  ]);
}

/**
 * The exact bytes a data subject must sign on the `self` path.
 *
 * This path and `operator-self` sign a domain-tagged message rather than
 * `auth.challenge` alone, an untagged, caller-supplied blob. Operators wire ONE
 * verifyMlDsa callback for every path, so with an untagged challenge any string that
 * operator has ever signed would verify: an attacker who observed one
 * operatorDownstreamMessage could resend it as `challenge` with the operator's own
 * signature and pass as `operator-self`. That would be an escalation across the
 * coupling table, since audit-export and billing-history accept operator-self and
 * refuse operator-for-downstream. Domain-tagging each path's message stops the
 * transfer, and committing to challengeIssuedAt stops a replayed signature being
 * re-dated into the replay window.
 */
export function selfChallengeMessage(auth: AuthSelf, id: string): string {
  return JSON.stringify([
    'SAIHM-REPORT-SELF-v1',
    auth.surface,
    id,
    auth.challenge,
    auth.challengeIssuedAt,
  ]);
}

/** The exact bytes an operator must sign on the `operator-self` path. */
export function operatorSelfChallengeMessage(auth: AuthOperatorSelf): string {
  return JSON.stringify([
    'SAIHM-REPORT-OPERATOR-SELF-v1',
    auth.operatorIdHash,
    auth.challenge,
    auth.challengeIssuedAt ?? '',
  ]);
}

/** The bytes a customer must sign to grant an operator downstream disclosure rights. */
export function customerGrantMessage(
  operatorIdHash: string,
  grant: { customerIdHash: string; scope: string; expiresAt: string },
): string {
  return JSON.stringify([
    'SAIHM-REPORT-CUSTOMER-GRANT-v1',
    operatorIdHash,
    grant.customerIdHash,
    grant.scope,
    grant.expiresAt,
  ]);
}

// ============================================================================
// Verifier callbacks (operator injects)
// ============================================================================

export interface AuthVerifiers {
  verifyMlDsa?: (signature: string, message: string, publicKeyHash: string) => Promise<boolean>;
  /**
   * Verifies a data subject's own signature on the `web` surface.
   *
   * The two parameters after the signature are named for what actually arrives. The
   * second is the domain-tagged message built by {@link selfChallengeMessage} — a JSON
   * array beginning `SAIHM-REPORT-SELF-v1` — not the caller's raw `auth.challenge`, so
   * verify against this message, not against `auth.challenge`. The third is a 64-hex id
   * hash, whichever of `walletIdHash` or `agentIdHash` the caller supplied, so it may not
   * describe a wallet at all. An Ethereum address is 40 hex: an implementation that
   * recovers a signer address and compares it against this 32-byte hash never matches,
   * and the whole `web` surface fails closed. Do not drop that comparison to make it
   * pass: returning true on any well-formed signature would authorize a path that
   * audit-export and billing-history accept. The sibling verifiers use the same naming.
   */
  verifyEip712?: (
    signature: string,
    message: string,
    walletOrAgentIdHash: string,
  ) => Promise<boolean>;
  /**
   * Verifies the data subject's own signature on a customer-grant. A customer may
   * hold either key type, so the operator routes it; leave undefined only if the
   * grant is authenticated out of band, and expect the chainSummary to say the
   * customer half went unchecked.
   */
  verifyCustomerGrant?: (
    signature: string,
    message: string,
    customerIdHash: string,
  ) => Promise<boolean>;
}

/**
 * Has the operator opted into signature verification at all?
 *
 * This is the test that separates shape-only smoke mode from a live deployment, and it
 * has to be asked the same way on every path: once ANY verifier is wired the operator
 * has plainly opted in, so a path whose own verifier is missing is refused rather than
 * waved through with a summary marker. That covers `self`, `operator-self` and the
 * operator half of `operator-for-downstream` alike. Otherwise an operator who wired
 * verifyEip712 for their web surface and nothing else would authorize every
 * operator-path request with no signature check, and `operator-self` is accepted by
 * audit-export and billing-history, so that would disclose real records on an
 * unauthenticated call. Asking the question in one place keeps every path, including
 * any added later, on the same rule.
 *
 * verifyCustomerGrant counts: wiring it is opting in just as much as the other two.
 * It is also the one callback whose own absence does not then refuse the path it
 * covers: the customer half of a customer-grant falls back to a marker instead. Both
 * halves are intended — it opts the module in, and it is exempt from what opting in
 * does everywhere else — so neither reads as an oversight from the other's side.
 */
function anyVerifierWired(verifiers?: AuthVerifiers): boolean {
  return (
    verifiers?.verifyEip712 !== undefined ||
    verifiers?.verifyMlDsa !== undefined ||
    verifiers?.verifyCustomerGrant !== undefined
  );
}

// ============================================================================
// Kind-vs-auth coupling check
// ============================================================================

export function checkKindAuthCoupling(
  kind: ReportKind,
  authPath: AuthorizationPayload['path'],
): { ok: boolean; reason?: string } {
  // KIND_AUTH_REQUIREMENTS is keyed by ReportKind, but the type is gone at runtime and
  // this function is exported, so an operator can pass an unrecognized kind. Indexing
  // with it and calling .includes on the result would throw a TypeError from the
  // coupling check instead of returning a refusal. An unknown kind has no allowed auth
  // paths, which is a rejection.
  //
  // A guard on `=== undefined` alone would leave the inherited half of the lookup open:
  // a plain object literal answers 'constructor', 'toString', 'hasOwnProperty' and
  // '__proto__' from Object.prototype, so those kinds return a function or an object
  // rather than undefined. Requiring an array is the property actually relied on
  // downstream, and it is true of every real entry and of nothing inherited.
  const allowed = KIND_AUTH_REQUIREMENTS[kind] as ReadonlyArray<AuthorizationPayload['path']>;
  if (!Array.isArray(allowed)) {
    return { ok: false, reason: `unknown report kind '${String(kind)}'` };
  }
  if (!allowed.includes(authPath)) {
    return {
      ok: false,
      reason: `kind '${kind}' does not accept auth path '${authPath}'; allowed: ${allowed.join(', ')}`,
    };
  }
  return { ok: true };
}

// ============================================================================
// Public (registry-attestation only)
// ============================================================================

export async function validateAuthPublic(_auth: AuthPublic): Promise<AuthResult> {
  return { ok: true, path: 'public', chainSummary: 'public/no-auth' };
}

// ============================================================================
// Self (web EIP-712 OR mcp ML-DSA)
// ============================================================================

export async function validateAuthSelf(
  auth: AuthSelf,
  verifiers?: AuthVerifiers,
  now: number = Date.now(),
): Promise<AuthResult> {
  if (auth.surface !== 'web' && auth.surface !== 'mcp') {
    return { ok: false, reason: `invalid surface '${auth.surface}'` };
  }

  if (!auth.signature || auth.signature.length === 0) {
    return { ok: false, reason: 'missing signature' };
  }

  if (!auth.challenge || auth.challenge.length === 0) {
    return { ok: false, reason: 'missing challenge' };
  }

  const issuedMs = Date.parse(auth.challengeIssuedAt);
  if (!Number.isFinite(issuedMs)) {
    return { ok: false, reason: 'invalid challengeIssuedAt' };
  }
  if (now - issuedMs > REPLAY_WINDOW_MS) {
    return { ok: false, reason: CHALLENGE_EXPIRED_REASON };
  }
  if (issuedMs > now + CLOCK_SKEW_ALLOWANCE_MS) {
    return { ok: false, reason: 'challengeIssuedAt in future' };
  }

  // The first non-empty id wins. `??` treats '' as a value, so it would reject a blank
  // walletIdHash alongside a valid agentIdHash as "missing or malformed" — a legitimate
  // request refused because the wrong field was consulted. Same rule as
  // resolveTargetSubject.
  const id = [auth.walletIdHash, auth.agentIdHash].find((v) => typeof v === 'string' && v !== '');
  if (id === undefined || !HEX_64.test(id)) {
    return { ok: false, reason: 'missing or malformed walletIdHash/agentIdHash (need 64-hex)' };
  }

  const message = selfChallengeMessage(auth, id);

  // `surface` is caller-supplied and it is what selects the verifier. An operator who
  // wires only verifyMlDsa for their MCP surface has plainly opted into verification, so
  // a request naming `surface: 'web'` must not reach an unwired EIP-712 branch and come
  // back ok:true with only an UNVERIFIED suffix in a summary string: the caller would be
  // choosing which verification runs, with "none" as one of the choices, and `self` is
  // accepted by audit-export and billing-history, so it discloses real records.
  // Shape-only mode means NO verifier is wired; once the operator wires any, a surface
  // without one is refused rather than waved through. The two failure reasons below
  // are stable, so operators matching on them keep matching.
  const surfaceVerifier = auth.surface === 'web' ? verifiers?.verifyEip712 : verifiers?.verifyMlDsa;

  let verified = false;
  if (surfaceVerifier) {
    const ok = await surfaceVerifier(auth.signature, message, id);
    if (!ok) {
      return {
        ok: false,
        reason:
          auth.surface === 'web'
            ? 'EIP-712 signature verify failed'
            : 'ML-DSA signature verify failed',
      };
    }
    verified = true;
  } else if (anyVerifierWired(verifiers)) {
    return {
      ok: false,
      reason: `no signature verifier wired for surface '${auth.surface}'`,
    };
  }

  return {
    ok: true,
    path: 'self',
    chainSummary: `self/${auth.surface}/${id.slice(0, 8)}…${verified ? '' : UNVERIFIED}`,
  };
}

// ============================================================================
// Operator-self
// ============================================================================

export async function validateAuthOperatorSelf(
  auth: AuthOperatorSelf,
  verifiers?: AuthVerifiers,
  now: number = Date.now(),
): Promise<AuthResult> {
  if (!HEX_64.test(auth.operatorIdHash)) {
    return { ok: false, reason: 'operatorIdHash must be 64-hex' };
  }
  if (!auth.mldsaSignature || auth.mldsaSignature.length === 0) {
    return { ok: false, reason: 'missing mldsaSignature' };
  }
  if (!auth.challenge || auth.challenge.length === 0) {
    return { ok: false, reason: 'missing challenge' };
  }

  // validateAuthSelf bounds a challenge to 30 minutes; this path, which carries more
  // privilege, bounded it to nothing. challengeIssuedAt is optional because the field
  // did not exist when operators started sending this payload and requiring it now
  // would reject their live traffic — but when it is present it is enforced on the
  // same terms, so an operator can close the replay window without waiting for a
  // major version.
  if (auth.challengeIssuedAt !== undefined) {
    const issuedMs = Date.parse(auth.challengeIssuedAt);
    if (!Number.isFinite(issuedMs)) {
      return { ok: false, reason: 'invalid challengeIssuedAt' };
    }
    if (now - issuedMs > REPLAY_WINDOW_MS) {
      return { ok: false, reason: CHALLENGE_EXPIRED_REASON };
    }
    if (issuedMs > now + CLOCK_SKEW_ALLOWANCE_MS) {
      return { ok: false, reason: 'challengeIssuedAt in future' };
    }
  }

  let verified = false;
  if (verifiers?.verifyMlDsa) {
    const ok = await verifiers.verifyMlDsa(
      auth.mldsaSignature,
      operatorSelfChallengeMessage(auth),
      auth.operatorIdHash,
    );
    if (!ok) return { ok: false, reason: 'operator ML-DSA signature verify failed' };
    verified = true;
  } else if (anyVerifierWired(verifiers)) {
    return { ok: false, reason: 'no ML-DSA verifier wired for the operator signature' };
  }

  const unbounded = auth.challengeIssuedAt === undefined ? '/no-replay-window' : '';
  return {
    ok: true,
    path: 'operator-self',
    chainSummary:
      `operator-self/${auth.operatorIdHash.slice(0, 8)}…` +
      `${unbounded}${verified ? '' : UNVERIFIED}`,
  };
}

// ============================================================================
// Operator-for-downstream (two-of-two)
// ============================================================================

export async function validateAuthOperatorForDownstream(
  auth: AuthOperatorForDownstream,
  verifiers?: AuthVerifiers,
  now: number = Date.now(),
): Promise<AuthResult> {
  if (!HEX_64.test(auth.operatorIdHash)) {
    return { ok: false, reason: 'operatorIdHash must be 64-hex' };
  }
  if (!auth.operatorMldsaSignature || auth.operatorMldsaSignature.length === 0) {
    return { ok: false, reason: 'missing operatorMldsaSignature' };
  }

  const d = auth.downstream;
  if (d.type === 'customer-grant') {
    if (!HEX_64.test(d.customerIdHash)) {
      return { ok: false, reason: 'customerIdHash must be 64-hex' };
    }
    if (!d.scope || d.scope.length === 0) {
      return { ok: false, reason: 'missing customer-grant scope' };
    }
    const expMs = Date.parse(d.expiresAt);
    if (!Number.isFinite(expMs)) {
      return { ok: false, reason: 'invalid customer-grant expiresAt' };
    }
    if (expMs <= now) {
      return { ok: false, reason: 'customer-grant expired' };
    }
    if (!d.customerSignature || d.customerSignature.length === 0) {
      return { ok: false, reason: 'missing customer-grant customerSignature' };
    }
  } else if (d.type === 'legal-basis') {
    if (!HEX_64.test(d.subpoenaHash)) {
      return { ok: false, reason: 'subpoenaHash must be 64-hex' };
    }
    if (!d.jurisdiction) {
      return { ok: false, reason: 'missing legal-basis jurisdiction' };
    }
    // new URL() alone accepts javascript:, data: and file:, and this value is both
    // signed into the operator's message and kept as the auditor's evidence link for
    // the disclosure. A "public record" that dereferences to the local filesystem is
    // not a public record, and one rendered as a hyperlink in an audit UI is a script
    // injection. So the scheme is allowlisted rather than merely parsed. Read the
    // allowlist as deliberately weaker than the runtime client's endpoint rule,
    // which is https-only outside localhost: plain http is accepted here because
    // some official registries and court record systems still publish over it, and
    // refusing those would reject legitimate evidence. The trade is that an http
    // link is MITM-able and unauthenticated, so the scheme is evidence quality, not
    // a guarantee.
    let recordUrl: URL;
    try {
      recordUrl = new URL(d.publicRecordUrl);
    } catch {
      return { ok: false, reason: 'invalid legal-basis publicRecordUrl' };
    }
    if (recordUrl.protocol !== 'https:' && recordUrl.protocol !== 'http:') {
      return {
        ok: false,
        reason: `legal-basis publicRecordUrl must be http(s), got '${recordUrl.protocol}'`,
      };
    }
  } else {
    return { ok: false, reason: `unknown downstream.type` };
  }

  // A customer-grant carries its own expiry and is refused above once it passes. A
  // legal-basis claim carries no point in time of its own, so challengeIssuedAt is the
  // replay bound on this path, the only operator route to an erasure-confirmation. It
  // is optional for the same reason as on operator-self: requiring it would reject
  // operators' live traffic. It is enforced on the same terms when present, and its
  // absence is recorded rather than passed over in silence.
  if (auth.challengeIssuedAt !== undefined) {
    const issuedMs = Date.parse(auth.challengeIssuedAt);
    if (!Number.isFinite(issuedMs)) {
      return { ok: false, reason: 'invalid challengeIssuedAt' };
    }
    if (now - issuedMs > REPLAY_WINDOW_MS) {
      return { ok: false, reason: CHALLENGE_EXPIRED_REASON };
    }
    if (issuedMs > now + CLOCK_SKEW_ALLOWANCE_MS) {
      return { ok: false, reason: 'challengeIssuedAt in future' };
    }
  }

  let operatorVerified = false;
  if (verifiers?.verifyMlDsa) {
    const ok = await verifiers.verifyMlDsa(
      auth.operatorMldsaSignature,
      operatorDownstreamMessage(auth),
      auth.operatorIdHash,
    );
    if (!ok) return { ok: false, reason: 'operator ML-DSA signature verify failed' };
    operatorVerified = true;
  } else if (anyVerifierWired(verifiers)) {
    return { ok: false, reason: 'no ML-DSA verifier wired for the operator signature' };
  }

  // The customer half is a signature check of its own, so a disclosure about a data
  // subject requires an act by that subject. Fail closed when a verifier is wired;
  // when one is not, mark the summary rather than let it imply a consent that was not
  // demonstrated.
  let customerVerified = true;
  if (d.type === 'customer-grant') {
    if (verifiers?.verifyCustomerGrant) {
      const ok = await verifiers.verifyCustomerGrant(
        d.customerSignature,
        customerGrantMessage(auth.operatorIdHash, d),
        d.customerIdHash,
      );
      if (!ok) return { ok: false, reason: 'customer-grant signature verify failed' };
    } else {
      customerVerified = false;
    }
  }

  const unbounded = auth.challengeIssuedAt === undefined ? '/no-replay-window' : '';
  const gap =
    (operatorVerified ? '' : '/operator-sig-unverified') +
    (customerVerified ? '' : '/customer-sig-unverified');
  return {
    ok: true,
    path: 'operator-for-downstream',
    chainSummary:
      `operator-for-downstream/${auth.operatorIdHash.slice(0, 8)}…/${d.type}` +
      `${unbounded}${gap}`,
  };
}

// ============================================================================
// Dispatcher (kind-coupled)
// ============================================================================

export async function validateAuthForKind(
  kind: ReportKind,
  auth: AuthorizationPayload,
  verifiers?: AuthVerifiers,
  now: number = Date.now(),
): Promise<AuthResult> {
  const coupling = checkKindAuthCoupling(kind, auth.path);
  if (!coupling.ok) return { ok: false, reason: coupling.reason ?? 'kind-auth coupling failed' };

  switch (auth.path) {
    case 'public':
      return validateAuthPublic(auth);
    case 'self':
      return validateAuthSelf(auth, verifiers, now);
    case 'operator-self':
      return validateAuthOperatorSelf(auth, verifiers, now);
    case 'operator-for-downstream':
      return validateAuthOperatorForDownstream(auth, verifiers, now);
  }
}
