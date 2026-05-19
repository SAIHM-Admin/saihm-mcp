# Security Assurance Case

This document presents the project's **security assurance case** —
a structured argument that the project's security claims hold under
its documented threat model. It is intended for security reviewers,
RFP responders, and contributors who need to justify (or challenge)
specific security claims about `@saihm/mcp-server`.

The assurance case uses a **Claims–Arguments–Evidence (CAE)**
structure: each claim is supported by an argument, and each argument
is grounded in evidence that a reviewer can independently verify.

The threat model itself is documented in
[`HARDENING.md`](./HARDENING.md) §"Threat model"; the system
architecture (and its trust boundaries) is in
[`ARCHITECTURE.md`](./ARCHITECTURE.md). This assurance case builds on
both — it does not duplicate them.

---

## Top-level claim (G0)

**`@saihm/mcp-server` does not leak its caller's `Authorization`
secret, does not become a vector for DoS against the caller, and is
distributed with verifiable provenance.**

The three sub-properties — credential confidentiality, availability,
distribution integrity — are the core security promises of a thin
forwarding shim. They are the properties that, if violated, would
make the shim a *worse* choice than the caller talking to the
operator directly. The assurance case justifies each in turn, then
addresses cryptographic and process controls that back the promises
end-to-end.

## G1 — Credential confidentiality

**Claim.** The `Authorization` header value (typically `Bearer
<token>`) is never disclosed to an unintended audience.

### Argument

There are five distinct disclosure paths a reviewer should consider:
in-transit (network), at-rest (filesystem), via-error (thrown
`Error.message`), via-logging (stdout/stderr), and via-third-party
(operator-mediated reflection back into a response field). The
project addresses each.

### Evidence

| Disclosure path | Mitigation | Verification |
|---|---|---|
| In-transit | HTTPS-only enforcement at `SaihmRuntimeClient` construction; plain `http://` rejected except for `127.0.0.1`/`localhost` (dev). | `tests/integration.test.ts` test cases "ctor rejects http:// non-localhost endpoint" and "ctor allows http://127.0.0.1 (dev)". Code: `saihm_runtime_client.ts` constructor URL check. |
| At-rest (filesystem) | Server reads no files. Configuration is exclusively via env vars. | Source review: no `fs.read*` / `import('node:fs')` reads in the runtime path. `HARDENING.md` §"No on-disk persistence". |
| Via-error | Error messages explicitly do not include the header value. | `tests/integration.test.ts` test "error message does not echo Authorization header" — uses sentinel `Bearer SECRET-TOKEN-DO-NOT-LEAK` and asserts the token does not appear in any thrown error's `.message`. |
| Via-logging | No `console.log` / `console.error` of the auth header. | Source review (no calls to logging APIs that include the header in any code path). |
| Via-third-party reflection | The MCP server forwards operator responses verbatim, with no enrichment that could echo header content. | Source review: `SaihmRuntimeClient.call()` returns parsed JSON; no header is folded into the returned object. |

### Residual risk

A malicious operator endpoint could attempt to coax an agent into
sending the Bearer token via an alternate channel (e.g., a tool
response that prompts the agent to re-emit the header). This is an
operator-side and agent-side concern outside the MCP server's
control; the server enforces HTTPS-only so a network attacker cannot
combine with a malicious operator to MITM.

## G2 — Availability under adversarial input

**Claim.** A hung or malicious operator cannot cause the MCP server
to consume unbounded resources or block its caller indefinitely.

### Argument

Three resource exhaustion paths exist for a forwarding shim: time
(operator never responds), memory (operator emits an oversized
response), and surface (an unbounded tool surface lets attackers
exercise rarely-tested code paths). The project caps each.

### Evidence

| Resource | Limit | Verification |
|---|---|---|
| Time | 30-second per-call abort via `AbortController` | `saihm_runtime_client.ts` abort wiring. `tests/integration.test.ts` notes abort path is exercised on natural test shutdown. |
| Memory | 16 MB `Content-Length` cap; oversized responses rejected before deserialization | `tests/integration.test.ts` test "Content-Length over 16 MB rejected" — uses a server that advertises 20 MB and asserts the call throws "response too large". |
| Surface | Eight-tool protocol invariant — no ninth tool without a breaking-change process | `GOVERNANCE.md` §"Decision process" + `CONTRIBUTING.md` §"Coding conventions" both restate the cap. |

### Residual risk

A coordinated DoS where the operator responds slowly *but within the
30 s window* on every call could still degrade caller throughput.
This is detectable and the user can switch operators; it is not a
crash-level failure.

## G3 — Distribution integrity

**Claim.** A user who installs `@saihm/mcp-server` from npm can
verify that the artifact corresponds to a specific commit in this
repository, built by this repository's CI.

### Argument

npm provenance attestations (sigstore-backed in-toto attestations)
bind each published tarball to a specific GitHub Actions workflow
run and a specific source commit. `npm audit signatures` verifies the
attestation chain locally.

### Evidence

| Property | Evidence |
|---|---|
| Provenance generated at publish | `package.json` (publishConfig) + the release flow described in `ARCHITECTURE.md` §"Build, test, release flow" |
| Provenance verifiable by user | `npm audit signatures` works against the published `@saihm/mcp-server` package; `npm view @saihm/mcp-server --json | jq .dist` shows the attestation URLs |
| CI provenance | `.github/workflows/ci.yml` is the CI workflow; runs are public at <https://github.com/SAIHM-Admin/saihm-mcp/actions> |
| Git tags signed | Going forward (v0.1.3+) tags are signed with the founding-maintainer GPG key. v0.1.2 predates the policy. |

### Residual risk

The architect's npm + GitHub credentials remain a single point of
failure for the supply chain. Mitigation: 2FA on both accounts (npm
publish requires 2FA). When the project moves to AAIF or a similar
foundation, the publish credentials transfer to the foundation's
managed release flow, removing the single-point dependency.

## G4 — Cryptographic primitives are publicly-validated and current

**Claim.** Every cryptographic primitive named in the protocol or
the recommended verifier libraries is publicly documented, currently
recommended by its standards body, and not known to be broken.

### Argument

The MCP server itself runs no cryptography (see `ARCHITECTURE.md`).
The claim therefore concerns the protocol layer (operator-side) and
the recommended verifier-injection libraries.

### Evidence

| Primitive | Standard / library | Status |
|---|---|---|
| ML-DSA-65 (post-quantum signature) | NIST FIPS 204 (2024) — <https://csrc.nist.gov/pubs/fips/204/final> | Current NIST recommendation; Category 3 |
| HKDF (key derivation) | RFC 5869 (2010) — <https://datatracker.ietf.org/doc/html/rfc5869> | IETF Proposed Standard; widely deployed |
| Ed25519 (verifier signature) | RFC 8032 (2017) — <https://datatracker.ietf.org/doc/html/rfc8032> | IETF Standards Track; widely deployed |
| AEAD (cell encryption) | NIST-approved AEAD ciphers (AES-GCM family) | Current NIST recommendation |
| `@noble/post-quantum` (library) | MIT-licensed; pure TS implementation of ML-DSA + others — <https://www.npmjs.com/package/@noble/post-quantum> | Active maintenance; well-reviewed in the JS crypto community |
| `@noble/curves` (library) | MIT-licensed; pure TS implementation of Ed25519, HKDF, etc. — <https://www.npmjs.com/package/@noble/curves> | Active maintenance; well-reviewed |

### Anti-evidence (primitives explicitly NOT used)

`HARDENING.md` §"Protocol-layer crypto" enumerates explicitly: no
MD5/SHA-1 for integrity, no RC4, no DES, no ECB-mode block ciphers.
The `crypto_weaknesses` and `crypto_working` criteria in
`.bestpractices.json` document this.

### Residual risk

A future cryptographic break (most plausibly: a *partial* break in
ML-DSA-65 that motivates rotation to a higher-category parameter set)
is addressed by `kekVersion` rotation in the protocol — older cells
retain their version tag and can be migrated lazily. The MCP server
does not need to change to accommodate such a rotation.

## G5 — Process controls prevent unauthorized changes

**Claim.** Code, configuration, and release artefacts cannot be
modified without traceable maintainer action.

### Argument

Process controls operate at three layers: source control (who can
commit), review (who can approve), and release (who can publish).

### Evidence

| Control | Mechanism |
|---|---|
| Source control | Repository is on GitHub; only the founding maintainer (and any future maintainers added per `GOVERNANCE.md`) has push access. |
| Sign-off | Every commit must include a `Signed-off-by:` trailer (DCO 1.1). `CONTRIBUTING.md` §"Licensing and DCO sign-off". |
| Review | PRs require maintainer approval before merge. `GOVERNANCE.md` §"Code review". |
| CI gate | CI must pass on Node 20.x + 22.x before merge — `.github/workflows/ci.yml`. |
| Release | npm publish requires 2FA + sigstore provenance attestation. Release process described in `ARCHITECTURE.md` §"Build, test, release flow". |
| Security-sensitive changes | Founding-maintainer (or, once formed, TSC) sign-off required. `GOVERNANCE.md` §"Implementation decisions" → "Security-sensitive changes". |
| Dependency update review | Dependabot opens PRs that go through the same review + CI process. Dependabot config: `.github/dependabot.yml`. |

### Residual risk

The founding-maintainer-as-sole-approver pattern is a pre-1.0
pragmatic choice (and one OpenSSF Best Practices flags via the
`bus_factor` criterion). The mitigation is documented in
`GOVERNANCE.md`: when a second maintainer joins from a different
organization, the TSC is formed and approval can be distributed
across organizations. This is one of the AAIF eligibility gates.

## Counterarguments considered (and dismissed or scoped)

1. **"The MCP server is just a forwarding shim — security promises
   should be the operator's responsibility."** Partially true. The
   shim's promises are narrow on purpose (G1–G5), and they are the
   ones the user *can* verify locally without trusting the operator.
   The operator has additional promises (key custody, audit-anchor
   correctness) that are out of scope for this assurance case but
   documented in the protocol draft.
2. **"OpenSSF Best Practices criteria are paperwork, not real
   security."** The criteria's value here is precisely that they
   force the project to *write down* the controls that already exist,
   so independent reviewers can spot gaps without having to read all
   the source code. The assurance case above is the human-friendly
   index into that documentation.
3. **"Single maintainer = brittle = unsafe to depend on."** Real
   risk; documented (`bus_factor`) and mitigated via the foundation
   cession path in `GOVERNANCE.md` §"Intellectual property". Users
   making procurement decisions should weigh this against the
   project's maturity stage (pre-1.0) and the explicit roadmap to
   broaden maintainership.

## Verification roadmap for an independent reviewer

A reviewer who wants to validate this assurance case end-to-end can
follow this checklist:

- [ ] Read `ARCHITECTURE.md` and `HARDENING.md` to understand the
      claimed boundaries.
- [ ] Clone the repository; verify the integration test (`npm test`)
      passes on a fresh Node 20.x or 22.x install.
- [ ] Inspect `saihm_runtime_client.ts` for the HTTPS-only URL check,
      the `AbortController` wiring, and the `Content-Length` cap.
- [ ] Inspect `tests/integration.test.ts` for the three security
      assertions (HTTPS reject, oversized response reject, no
      header echo).
- [ ] Inspect `package.json` for `prepublishOnly: "npm run build && npm test"`.
- [ ] Verify the OpenSSF BP badge at
      <https://www.bestpractices.dev/projects/12898>.
- [ ] Verify provenance: `npm audit signatures` on a fresh install of
      `@saihm/mcp-server`.
- [ ] Inspect `.github/workflows/ci.yml` for the build + typecheck +
      test matrix.

If any item above does not behave as described, please report via
the private channel in [`SECURITY.md`](./SECURITY.md).

## Document scope and lifecycle

This assurance case targets the **published `@saihm/mcp-server`
npm package** and its source in this repository. It does not
attempt to make claims about:

- Specific operator deployments (each operator runs its own
  assurance case).
- Agent runtimes that consume this MCP server (their own assurance
  cases apply).
- The COTI V2 mainnet's consensus properties (audit-anchor inherits
  from there; out of scope).

The assurance case is reviewed and updated on each significant
release. Substantive changes to claims G1–G5 require security-
sensitive-change review per `GOVERNANCE.md`.
