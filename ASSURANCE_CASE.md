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
| In-transit | HTTPS-only enforcement at `SaihmRuntimeClient` construction; plain `http://` rejected except for `127.0.0.1`/`localhost` (dev). Construction validates the configured URL only, so every request also sets `redirect: 'error'` — a redirect is refused, keeping the validated scheme and host as the ones actually used. | `tests/integration.test.ts` test cases "ctor rejects http:// non-localhost endpoint", "ctor allows http://127.0.0.1 (dev)", and the R26-A cases asserting a `307` is refused and its body never reaches the redirect target. Code: `saihm_runtime_client.ts` constructor URL check and the `redirect: 'error'` fetch option. |
| At-rest (filesystem) | Nothing is written to disk, and no configuration, credential, or user data is read from it — configuration is exclusively via env vars. The server opens one file, its own `package.json`, to report `serverInfo.version`. | Source review over every `node:fs` call in shipped source, not only the client: the sole reader is `readPackageVersion()` in `saihm_mcp_server.ts`, which reads `package.json` and falls back to `0.0.0-dev`. `saihm_runtime_client.ts` reads no files at all. `HARDENING.md` §"No on-disk persistence". This row previously asserted the server read *no* files, citing a source review that would have found this one — the read landed in 0.3.1 and the row was not revisited until 0.3.11. |
| Via-error | Error messages explicitly do not include the header value. | `tests/integration.test.ts` test "error message does not echo Authorization header" — uses sentinel `Bearer SECRET-TOKEN-DO-NOT-LEAK` and asserts the token does not appear in any thrown error's `.message`. |
| Via-logging | Nothing is written to stdout or stderr except one line: `saihm_mcp_server.ts` writes a fatal startup error to stderr before exiting. The header is never part of it. | Source review over **every** write path, not just `console.*`: the only match for `console.` / `process.stdout` / `process.stderr` in shipped source is that single `process.stderr.write(String(e))`. A reviewer grepping for `console.log` alone would find nothing and conclude clean without having checked the path that actually writes. |
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
| Time | 30-second per-call abort via `AbortController` | `saihm_runtime_client.ts` abort wiring. `tests/integration.test.ts` R26-B cases: a server that accepts the request and never answers, against a client constructed with a 60 ms window, throws "timed out after 60ms" in well under a second; further cases assert the message does not echo the header, states the outcome is unknown rather than implying failure, and that the shipped default is still 30 s. The abort window is a constructor parameter defaulting to `REQUEST_TIMEOUT_MS` **so that this row can cite a real test** — the previous citation pointed at an assertion that always passed. |
| Memory | 16 MB cap, enforced twice: a declared `Content-Length` over the cap is rejected before the body is read, and independently the body is measured while it streams and the read is aborted on exceeding the cap — so the cap does not depend on the sender declaring an honest `Content-Length`, or any at all | `tests/integration.test.ts` tests "Content-Length over 16 MB rejected" (server advertises 20 MB; call throws "response too large") and "R14-A chunked response over 16 MB rejected (no Content-Length)" (17x1 MB chunked reply with no header; call throws "while still streaming"). |
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
bind a published tarball to a specific GitHub Actions workflow run
and a specific source commit. `npm audit signatures` verifies the
attestation chain locally.

This argument holds **from 0.3.6 onward**, and the scope is stated
rather than glossed. The automated release pipeline went live at
0.3.6; the ten earlier versions (`0.1.0`–`0.3.5`) were published by
hand and carry no attestation. Verified per version with
`npm view @saihm/mcp-server@<v> dist.attestations`.

### Evidence

| Property | Evidence |
|---|---|
| Provenance generated at publish | `.github/workflows/release.yml` publishes from GitHub Actions with `id-token: write` and OIDC trusted publishing, which generates the SLSA attestation automatically (no `--provenance` flag, no npm token). Confirmed live: `npm view @saihm/mcp-server@0.3.10 --json` reports `dist.attestations` with predicate type `https://slsa.dev/provenance/v1`. |
| Provenance verifiable by user | `npm audit signatures` works against the published `@saihm/mcp-server` package; `npm view @saihm/mcp-server --json | jq .dist` shows the attestation URLs. Attestations are present on `0.3.6`–`0.3.10` and absent on `0.1.0`–`0.3.5`. |
| CI provenance | `.github/workflows/ci.yml` is the CI workflow; runs are public at <https://github.com/SAIHM-Admin/saihm-mcp/actions> |
| Version-to-commit mapping, with its gaps stated | Every published npm version from `0.3.0` onward has a git tag of the same name, so it maps to a commit. Two gaps a reviewer will otherwise find alone: `0.1.1` is on npm with **no** tag and **no** changelog entry, and `v0.3.2`, `v0.3.4` and `v0.3.5` have tags but **no GitHub Release** (they predate the automated pipeline). `/releases/tag/<tag>` resolves for a bare tag, so the `CHANGELOG.md` links still work. |
| Tag signing — not a control | **No tag is signed.** The situation is not uniform, and an earlier version of this row described them all as lightweight, which was wrong about most of them: `v0.1.0`, `v0.2.0` and `v0.3.0`–`v0.3.5` are **annotated** tags that simply were never signed, while `v0.1.2` and `v0.3.6`–`v0.3.10` hold no tag object at all. Closing the gap therefore means re-signing the first group and recreating the second. Recorded in `HARDENING.md` §"Distribution integrity" as a gap, not claimed as a control; for `0.3.6`+ the artifact-to-source link to rely on is the provenance attestation above. |

### Residual risk

The architect's npm + GitHub credentials remain a single point of
failure for the supply chain. Mitigation: publishing does not use a
long-lived npm token at all — `.github/workflows/release.yml` is the
only publish path and it authenticates by GitHub Actions OIDC, so
there is no npm credential to steal or replay, and the residual
control is GitHub account security plus branch/release protection.
When the project moves to AAIF or a similar foundation, the release
flow transfers to the foundation's managed process, removing the
single-point dependency.

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
| Sign-off | **Gap — documented, not enforced.** `CONTRIBUTING.md` §"Licensing and DCO sign-off" asks inbound contributions to carry a `Signed-off-by:` trailer (DCO 1.1); the remedy it describes is a manual rebase request. No DCO check or app enforces it, and most commits on `main` carry no trailer. `HARDENING.md` §"Process hardening". |
| Review | **Gap — convention, not enforced.** `GOVERNANCE.md` §"Code review" describes maintainer approval, but `main` has no branch protection and no rulesets, so no approval is mechanically required, and the sole maintainer commits to `main` directly. |
| CI | Lint, format check, typecheck, build and the full test suite run on Node 20.x + 22.x for every PR and every push to `main` (`.github/workflows/ci.yml`). **Not a merge gate** — no required status check is configured. |
| Release | Publishing runs only from `.github/workflows/release.yml` on GitHub Actions using OIDC trusted publishing — no long-lived npm token exists to steal, and the SLSA provenance attestation is generated automatically. Release process described in `ARCHITECTURE.md` §"Build, test, release flow". |
| Security-sensitive changes | Founding-maintainer (or, once formed, TSC) sign-off required. `GOVERNANCE.md` §"Implementation decisions" → "Security-sensitive changes". |
| Dependency update review | Dependabot opens PRs that go through the same review + CI process. Dependabot config: `.github/dependabot.yml`. |

### Residual risk

The founding-maintainer-as-sole-approver pattern is a pre-1.0
pragmatic choice (and one OpenSSF Best Practices flags via the
`bus_factor` criterion). The mitigation is documented in
`GOVERNANCE.md`: when a second maintainer joins from a different
organization, the TSC is formed and approval can be distributed
across organizations. This is one of the AAIF eligibility gates.

Sole approvership is not the only residual risk here. The sign-off,
review and CI controls above are conventions rather than mechanisms:
`main` carries no branch protection and no rulesets, so nothing stops
an unreviewed, unsigned, CI-red push. They hold because one maintainer
chooses to follow them, and the sign-off convention has already lapsed
— most commits on `main` carry no trailer. Closing this is a
repository-settings change (required status checks, required review, a
DCO check) rather than a code change, and it is tracked as an open gap
alongside release-tag signing. Until 0.3.11 this section claimed all
three as enforced controls.

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
      the `AbortController` wiring, and both halves of the 16 MB
      response cap — the declared-`Content-Length` early-out in
      `call()` and the streamed-body cap in `readCapped()`, which is
      what holds when the sender declares no `Content-Length` or a
      dishonest one.
- [ ] Inspect `tests/integration.test.ts` for the security
      assertions (HTTPS reject, oversized-`Content-Length` reject,
      oversized chunked reply with no `Content-Length` reject, no
      header echo).
- [ ] Inspect `package.json` for `prepack: "npm run build"` and
      `prepublishOnly: "npm run typecheck && npm test"` — so a
      published tarball is always rebuilt from the committed source,
      and never ships unless the sources *and* the test suite both
      typecheck.
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
