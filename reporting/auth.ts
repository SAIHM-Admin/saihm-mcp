/**
 * SAIHM Reporting Engine — Authorization path validators.
 *
 * Four auth paths: public / self / operator-self / operator-for-downstream.
 * This module performs structural validation (shape, hex formats, replay
 * windows, kind-vs-auth coupling); cryptographic signature verification
 * (ML-DSA / EIP-712) is performed by injected verifier callbacks. Leaving
 * the verifier callbacks undefined enables shape-only smoke-test mode.
 *
 * STRICT EVM ELIMINATION: zero EVM-library imports. EIP-712 verify, when
 * wired by an operator, uses @noble/curves secp256k1 directly — no EVM
 * SDK, no eth_* RPC, pure crypto only.
 */

import type {
  AuthorizationPayload,
  AuthPublic,
  AuthSelf,
  AuthOperatorSelf,
  AuthOperatorForDownstream,
  ReportKind,
} from "./types.js";
import { KIND_AUTH_REQUIREMENTS } from "./types.js";

// ============================================================================
// Result envelope
// ============================================================================

export type AuthResult =
  | { ok: true; path: AuthorizationPayload["path"]; chainSummary: string }
  | { ok: false; reason: string };

export const REPLAY_WINDOW_MS = 30 * 60 * 1000;

const HEX_64 = /^[a-f0-9]{64}$/;

// ============================================================================
// Verifier callbacks (operator injects)
// ============================================================================

export interface AuthVerifiers {
  verifyMlDsa?: (
    signature: string,
    message: string,
    publicKeyHash: string,
  ) => Promise<boolean>;
  verifyEip712?: (
    signature: string,
    challenge: string,
    walletAddress: string,
  ) => Promise<boolean>;
}

// ============================================================================
// Kind-vs-auth coupling check
// ============================================================================

export function checkKindAuthCoupling(
  kind: ReportKind,
  authPath: AuthorizationPayload["path"],
): { ok: boolean; reason?: string } {
  const allowed = KIND_AUTH_REQUIREMENTS[kind];
  if (!allowed.includes(authPath)) {
    return {
      ok: false,
      reason: `kind '${kind}' does not accept auth path '${authPath}'; allowed: ${allowed.join(", ")}`,
    };
  }
  return { ok: true };
}

// ============================================================================
// Public (registry-attestation only)
// ============================================================================

export async function validateAuthPublic(_auth: AuthPublic): Promise<AuthResult> {
  return { ok: true, path: "public", chainSummary: "public/no-auth" };
}

// ============================================================================
// Self (web EIP-712 OR mcp ML-DSA)
// ============================================================================

export async function validateAuthSelf(
  auth: AuthSelf,
  verifiers?: AuthVerifiers,
  now: number = Date.now(),
): Promise<AuthResult> {
  if (auth.surface !== "web" && auth.surface !== "mcp") {
    return { ok: false, reason: `invalid surface '${auth.surface}'` };
  }

  if (!auth.signature || auth.signature.length === 0) {
    return { ok: false, reason: "missing signature" };
  }

  if (!auth.challenge || auth.challenge.length === 0) {
    return { ok: false, reason: "missing challenge" };
  }

  const issuedMs = Date.parse(auth.challengeIssuedAt);
  if (!Number.isFinite(issuedMs)) {
    return { ok: false, reason: "invalid challengeIssuedAt" };
  }
  if (now - issuedMs > REPLAY_WINDOW_MS) {
    return { ok: false, reason: "challenge expired (replay window 30min)" };
  }
  if (issuedMs > now + 60_000) {
    return { ok: false, reason: "challengeIssuedAt in future" };
  }

  const id = auth.walletIdHash ?? auth.agentIdHash;
  if (!id || !HEX_64.test(id)) {
    return { ok: false, reason: "missing or malformed walletIdHash/agentIdHash (need 64-hex)" };
  }

  if (auth.surface === "web" && verifiers?.verifyEip712) {
    const ok = await verifiers.verifyEip712(auth.signature, auth.challenge, id);
    if (!ok) return { ok: false, reason: "EIP-712 signature verify failed" };
  }
  if (auth.surface === "mcp" && verifiers?.verifyMlDsa) {
    const ok = await verifiers.verifyMlDsa(auth.signature, auth.challenge, id);
    if (!ok) return { ok: false, reason: "ML-DSA signature verify failed" };
  }

  return {
    ok: true,
    path: "self",
    chainSummary: `self/${auth.surface}/${id.slice(0, 8)}…`,
  };
}

// ============================================================================
// Operator-self
// ============================================================================

export async function validateAuthOperatorSelf(
  auth: AuthOperatorSelf,
  verifiers?: AuthVerifiers,
): Promise<AuthResult> {
  if (!HEX_64.test(auth.operatorIdHash)) {
    return { ok: false, reason: "operatorIdHash must be 64-hex" };
  }
  if (!auth.mldsaSignature || auth.mldsaSignature.length === 0) {
    return { ok: false, reason: "missing mldsaSignature" };
  }
  if (!auth.challenge || auth.challenge.length === 0) {
    return { ok: false, reason: "missing challenge" };
  }

  if (verifiers?.verifyMlDsa) {
    const ok = await verifiers.verifyMlDsa(
      auth.mldsaSignature,
      auth.challenge,
      auth.operatorIdHash,
    );
    if (!ok) return { ok: false, reason: "operator ML-DSA signature verify failed" };
  }

  return {
    ok: true,
    path: "operator-self",
    chainSummary: `operator-self/${auth.operatorIdHash.slice(0, 8)}…`,
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
    return { ok: false, reason: "operatorIdHash must be 64-hex" };
  }
  if (!auth.operatorMldsaSignature || auth.operatorMldsaSignature.length === 0) {
    return { ok: false, reason: "missing operatorMldsaSignature" };
  }

  const d = auth.downstream;
  if (d.type === "customer-grant") {
    if (!HEX_64.test(d.customerIdHash)) {
      return { ok: false, reason: "customerIdHash must be 64-hex" };
    }
    if (!d.scope || d.scope.length === 0) {
      return { ok: false, reason: "missing customer-grant scope" };
    }
    const expMs = Date.parse(d.expiresAt);
    if (!Number.isFinite(expMs)) {
      return { ok: false, reason: "invalid customer-grant expiresAt" };
    }
    if (expMs <= now) {
      return { ok: false, reason: "customer-grant expired" };
    }
    if (!d.customerSignature || d.customerSignature.length === 0) {
      return { ok: false, reason: "missing customer-grant customerSignature" };
    }
  } else if (d.type === "legal-basis") {
    if (!HEX_64.test(d.subpoenaHash)) {
      return { ok: false, reason: "subpoenaHash must be 64-hex" };
    }
    if (!d.jurisdiction) {
      return { ok: false, reason: "missing legal-basis jurisdiction" };
    }
    try {
      new URL(d.publicRecordUrl);
    } catch {
      return { ok: false, reason: "invalid legal-basis publicRecordUrl" };
    }
  } else {
    return { ok: false, reason: `unknown downstream.type` };
  }

  if (verifiers?.verifyMlDsa) {
    const ok = await verifiers.verifyMlDsa(
      auth.operatorMldsaSignature,
      auth.operatorIdHash,
      auth.operatorIdHash,
    );
    if (!ok) return { ok: false, reason: "operator ML-DSA signature verify failed" };
  }

  return {
    ok: true,
    path: "operator-for-downstream",
    chainSummary: `operator-for-downstream/${auth.operatorIdHash.slice(0, 8)}…/${d.type}`,
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
  if (!coupling.ok) return { ok: false, reason: coupling.reason ?? "kind-auth coupling failed" };

  switch (auth.path) {
    case "public":
      return validateAuthPublic(auth);
    case "self":
      return validateAuthSelf(auth, verifiers, now);
    case "operator-self":
      return validateAuthOperatorSelf(auth, verifiers);
    case "operator-for-downstream":
      return validateAuthOperatorForDownstream(auth, verifiers, now);
  }
}
