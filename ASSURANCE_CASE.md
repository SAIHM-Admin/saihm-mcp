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
distribution integrity — are the core security promises of a
forwarding client. The assurance case justifies each in turn, then
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
| At-rest (filesystem) | Nothing is written to disk, and no configuration, credential, or user data is read from it — configuration is exclusively via env vars. The server's only file read is a `package.json`, for the version it reports as `serverInfo.version`: its own packaged `package.json`, or `package.json` in the current working directory if that cannot be read. Only the `version` field is used. | Source review over every `node:fs` call in shipped source, not only the client: the sole reader is `readPackageVersion()` in `saihm_mcp_server.ts`, which tries the packaged `package.json` and then the working directory's, uses only `version`, and falls back to `0.0.0-dev`. `saihm_runtime_client.ts` reads no files at all. `HARDENING.md` §"No on-disk persistence". |
| Via-error | Error messages are built without the header value. Node's `fetch` quotes a header value with a line break or other control character inside it, and an endpoint URL with userinfo, in its own errors, so the constructor refuses both with fixed messages that quote neither, and `call()` replaces any other error `fetch` raises while building a request. | `tests/integration.test.ts` test "error message does not echo Authorization header" — uses sentinel `Bearer SECRET-TOKEN-DO-NOT-LEAK` and asserts the token does not appear in any thrown error's `.message`. The R33-A cases plant a sentinel in seven header shapes and four userinfo shapes, at construction, from the environment and past the constructor into `call()`, and search each error's message, stack and cause for it; a positive control shows that `fetch` itself quotes both shapes. |
| Via-logging | Nothing is written to stdout or stderr except one line: `saihm_mcp_server.ts` writes a fatal startup error to stderr before exiting. The header is never part of it. | Source review over **every** write path, not just `console.*`: the only match for `console.` / `process.stdout` / `process.stderr` in shipped source is that single `process.stderr.write(String(e))`. A reviewer grepping for `console.log` alone would find nothing and conclude clean without having checked the path that actually writes. |
| Via-third-party reflection | The MCP server reports the operator's result after shape checks, with no caching and no enrichment that could echo header content. | Source review: `SaihmRuntimeClient.call()` returns parsed JSON; no header is folded into the returned object. |

### Residual risk

A malicious operator endpoint could attempt to coax an agent into
sending the Bearer token via an alternate channel (e.g., a tool
response that prompts the agent to re-emit the header). This is an
operator-side and agent-side concern outside the MCP server's
control; the server enforces HTTPS-only so a network attacker cannot
combine with a malicious operator to MITM.

## G2 — Availability under adversarial input

**Claim.** A hung or malicious operator, or an oversized tool call,
cannot cause the MCP server to consume unbounded resources or block its
caller indefinitely.

### Argument

Four resource exhaustion paths exist for a forwarding client: time
(operator never responds), memory (operator emits an oversized
response), tool input (caller sends an oversized argument), and surface
(an unbounded tool surface lets attackers exercise rarely-tested code
paths). The project caps each.

### Evidence

| Resource | Limit | Verification |
|---|---|---|
| Time | 30-second per-call abort via `AbortController` | `saihm_runtime_client.ts` abort wiring. `tests/integration.test.ts` R26-B cases: a server that accepts the request and never answers, against a client constructed with a 60 ms window, throws "timed out after 60ms" in well under a second; further cases assert the message does not echo the header, states the outcome is unknown rather than implying failure, and that the shipped default is still 30 s. The abort window is a constructor parameter defaulting to `REQUEST_TIMEOUT_MS`, so the test can exercise it with a short window. |
| Memory | 16 MB cap, enforced twice: a declared `Content-Length` over the cap is rejected before the body is read, and independently the body is measured while it streams and the read is aborted on exceeding the cap — so the cap does not depend on the sender declaring an honest `Content-Length`, or any at all | `tests/integration.test.ts` tests "Content-Length over 16 MB rejected" (server advertises 20 MB; call throws "response too large") and "R14-A chunked response over 16 MB rejected (no Content-Length)" (17x1 MB chunked reply with no header; call throws "while still streaming"). |
| Tool input | zod schemas on every tool. `saihm_share` accepts at most 1,024 grantee ids and 1,024 shard ids, each at most 256 characters, and an over-long list is refused on its size check before any entry is read (zod `^4.6.6`); its `expiryEpoch` accepts at most 20 characters. The MCP SDK's stdio transport caps each message at 10 MB. | `tests/integration.test.ts` R32-A cases: `tools/list` advertises both bounds; a 1,025-entry and a 1,000,000-entry list are each refused with a single `too_big` issue and no per-entry issues, in milliseconds; no over-limit list reaches the operator; a call at both limits succeeds. R33-B cases: a 21-digit and a 4,000,000-character `expiryEpoch` are refused in milliseconds without being quoted, and a 20-digit one is forwarded exactly. |
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

This argument holds **from 0.3.6 onward**. The automated release
pipeline went live at 0.3.6, and every version since carries an
attestation; the ten earlier versions (`0.1.0`–`0.3.5`) were
published by hand and carry none. Verified per version with
`npm view @saihm/mcp-server@<version> dist.attestations`.

### Evidence

| Property | Evidence |
|---|---|
| Provenance generated at publish | `.github/workflows/release.yml` publishes from GitHub Actions with `id-token: write` and OIDC trusted publishing, which generates the SLSA attestation automatically (no `--provenance` flag, no npm token). To confirm on the current release: `npm view @saihm/mcp-server@latest dist.attestations --json` reports predicate type `https://slsa.dev/provenance/v1`. |
| Provenance verifiable by user | `npm audit signatures` works against the published `@saihm/mcp-server` package; `npm view @saihm/mcp-server --json | jq .dist` shows the attestation URLs. Attestations are present on `0.3.6` and later and absent on `0.1.0`–`0.3.5`. |
| CI provenance | `.github/workflows/ci.yml` is the CI workflow; runs are public at <https://github.com/SAIHM-Admin/saihm-mcp/actions> |
| Version-to-commit mapping | Every published npm version except `0.1.1` has a git tag of the same name, so it maps to a commit. `v0.1.0`, `v0.1.2`, `v0.3.2`, `v0.3.4` and `v0.3.5` have tags without a GitHub Release (they predate the automated pipeline). `/releases/tag/<tag>` resolves for a bare tag, so the `CHANGELOG.md` links still work. |
| Artifact-to-source link | Release tags are not signed (`v0.1.2` and `v0.3.6`–`v0.3.10` are lightweight tags; the other release tags are annotated and can be signed in place). For `0.3.6` and later the link to rely on is the provenance attestation above; see `HARDENING.md` §"Distribution integrity". |

### Residual risk

Supply-chain security rests on the security of the project's GitHub
and npm accounts. Publishing uses no long-lived npm token:
`.github/workflows/release.yml` is the only publish path and it
authenticates by GitHub Actions OIDC, so there is no npm token to
steal or replay. SAIHM, Inc. owns the project and is accountable for
securing both accounts; the GitHub account uses two-factor
authentication, and branch protection on `main` adds a further control.

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
| HKDF (key derivation) | RFC 5869 (2010) — <https://datatracker.ietf.org/doc/html/rfc5869> | IETF RFC (Informational); widely deployed |
| AEAD (cell encryption) | NIST-approved AEAD ciphers (AES-GCM family) | Current NIST recommendation |
| `@noble/post-quantum` (library) | MIT-licensed; pure TS implementation of ML-DSA + others — <https://www.npmjs.com/package/@noble/post-quantum> | Active maintenance; well-reviewed in the JS crypto community |
| `@noble/curves` (library) | MIT-licensed; pure TS implementation of secp256k1, Ed25519 and other curves — <https://www.npmjs.com/package/@noble/curves> | Active maintenance; well-reviewed |

### Anti-evidence (primitives explicitly NOT used)

`HARDENING.md` §"Protocol-layer crypto" enumerates explicitly: no
MD5/SHA-1 for integrity, no RC4, no DES, no ECB-mode block ciphers.
The `crypto_weaknesses` and `crypto_working` criteria in
`.bestpractices.json` document this.

### Residual risk

A future cryptographic break (most plausibly a partial break in
ML-DSA-65) is handled at the protocol layer: primitives change through
the specification's breaking-change process (`GOVERNANCE.md` §"Decision
process"), and key-encryption keys rotate by generation (`kekVersion`).
The MCP server does not need to change to accommodate either.

## G5 — Process controls prevent unauthorized changes

**Claim.** Code, configuration, and release artifacts cannot be
modified without traceable maintainer action.

### Argument

Process controls operate at three layers: source control (who can
commit), review (who can approve), and release (who can publish).

### Evidence

| Control | Mechanism |
|---|---|
| Source control | Repository is on GitHub; only the founding maintainer (and any future maintainers added per `GOVERNANCE.md`) has push access. |
| Sign-off | **Documented policy, manual remedy.** `CONTRIBUTING.md` §"Licensing and DCO sign-off" asks inbound contributions to carry a `Signed-off-by:` trailer (DCO 1.1), and a pull request without it is asked to rebase. No DCO check or app automates this. `HARDENING.md` §"Process hardening". |
| Review | **Maintainer approval.** `GOVERNANCE.md` §"Code review" describes maintainer approval. Branch protection on `main` requires no review while the project has one maintainer; a required-review rule can be added once a second maintainer joins. |
| CI | Lint, format check, typecheck, build and the full test suite run on Node 20.x + 22.x for every PR and every push to `main`, together with a REUSE licensing check (`.github/workflows/ci.yml`). Branch protection on `main` requires the `build (20.x)`, `build (22.x)` and `reuse` status checks to pass and blocks force-pushes and deletion. It is not enforced for administrators. |
| Release | Publishing runs only from `.github/workflows/release.yml` on GitHub Actions using OIDC trusted publishing — no long-lived npm token exists to steal, and the SLSA provenance attestation is generated automatically. Release process described in `ARCHITECTURE.md` §"Build, test, release flow". |
| Security-sensitive changes | Founding-maintainer (or, once formed, TSC) sign-off required. `GOVERNANCE.md` §"Implementation decisions" → "Security-sensitive changes". |
| Dependency update review | Dependabot opens PRs that go through the same review + CI process. Dependabot config: `.github/dependabot.yml`. |

### Residual risk

Approval currently rests with the founding maintainer, and SAIHM, Inc.
is accountable for that arrangement as the project's owner. The company
owns the project and its trademarks (`GOVERNANCE.md` §"Intellectual
property"); when a second core maintainer joins from a different
organization, the TSC is formed and approval is distributed across
organizations.

Branch protection on `main` requires the `build (20.x)`, `build (22.x)`
and `reuse` checks and blocks force-pushes and deletion. It is not
enforced for administrators and requires no review while there is one
maintainer, so sign-off and review are maintainer practice, with CI and
REUSE as the automated gates. Required review and a DCO check are
repository-settings options for when maintainers are added; they sit
beside release-tag signing among the open items in the README roadmap.

## Questions reviewers ask

1. **"Do the security promises belong to the operator?"** The client's
   promises (G1–G5) are the ones a user can verify locally without
   trusting the operator. The operator has further promises (key
   custody, audit-anchor correctness) that are out of scope for this
   assurance case and are documented in the protocol draft.
2. **"What do the OpenSSF Best Practices criteria add?"** They ask the
   project to write down the controls that exist, so reviewers can check
   them without reading all the source. The assurance case above is the
   index into that documentation.
3. **"How is continuity assured?"** SAIHM, Inc. owns and stewards the
   project and its trademarks (`GOVERNANCE.md` §"Intellectual
   property"), the code is Apache-2.0, and `GOVERNANCE.md` §"Adding and
   removing maintainers" covers nomination, stepping down, inactivity
   and removal for cause. The path for adding maintainers from other
   organizations is in `GOVERNANCE.md` §"Technical Steering Committee
   (TSC)".

## Verification checklist for reviewers

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
      header echo, over-limit `saihm_share` lists refused).
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
one of the private channels in [`SECURITY.md`](./SECURITY.md).

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
