# Hardening

This document collects the security-hardening choices that are
enforced in `@saihm/mcp-server`. It is a companion to:

- [`SECURITY.md`](./SECURITY.md) — vulnerability disclosure policy
  and disclosure-process targets
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system architecture and
  trust-model summary
- [`GOVERNANCE.md`](./GOVERNANCE.md) — review process for
  security-sensitive changes

If a hardening choice is listed here, it is enforced today in the
shipped code or in the published artifact; it is not aspirational.

## Threat model

The MCP server operates in a position of partial trust between an
AI agent (the *caller*) and a SAIHM operator endpoint (the
*forwardee*). Specific threats the design considers:

| Adversary capability | Attack scenario |
|---|---|
| Network observer between MCP server and operator endpoint | Sniff Authorization header or response body in transit |
| Compromised operator endpoint | Return malicious responses; exfiltrate Authorization header via reflected error |
| Malicious or buggy MCP client | Send oversized payloads to exhaust memory or stall the server |
| Hung operator (no response) | Indefinitely block the MCP server |
| Supply-chain compromise of `@saihm/mcp-server` on npm | Substitute a malicious package version |
| Local attacker with filesystem access to user's home directory | Read configuration secrets from disk |
| Future cryptographic break (e.g., quantum break of pre-quantum signatures) | Forge holder identity on the operator side |

Out of scope for this server (these belong to other layers):

- **Operator-side key compromise** — operator endpoint's own threat
  model; not in this server's reach.
- **Agent-side prompt injection / jailbreak** — agent runtime's
  responsibility.
- **Public-chain consensus failure** — COTI V2 mainnet's threat
  model; SAIHM's audit anchor inherits from there.

## Hardening choices, enforced in `@saihm/mcp-server`

### Transport

- **HTTPS-only operator endpoints, and the scheme is held across the
  whole call.** Plain `http://` is rejected at `SaihmRuntimeClient`
  construction time, with the exception of `127.0.0.1` and `localhost`
  (for local development). The rejection is a thrown error, not a
  silent downgrade. Construction validates the configured URL only, so
  the client also sets `redirect: 'error'` on every request: a redirect
  is refused rather than followed. Without that, an endpoint answering
  `307` would carry the same POST — method and body preserved — to a
  host that was never checked, and for `saihm_remember` the body is the
  memory plaintext.
- **TLS 1.2+ via Node.js default TLS.** The Node.js HTTPS client
  defaults to TLS 1.2+ (TLS 1.3 preferred where the server supports
  it); legacy TLS / SSL versions are not negotiated.
- **Certificate verification.** Node.js verifies the operator
  endpoint's certificate against the system trust store. No
  insecure-cert bypass is exposed.

### Authorization handling

- **No header echo on error.** The `Authorization` header value
  (typically `Bearer <token>`) is never included in any thrown
  `Error.message`, stdout, or stderr. The integration test
  (`tests/integration.test.ts`) asserts this with a sentinel token
  (`"Bearer SECRET-TOKEN-DO-NOT-LEAK"`) and a forced server 500.
- **No on-disk persistence.** The server never writes to the
  filesystem, and reads no configuration, credential, or user data
  from it — configuration flows entirely through environment
  variables. It opens exactly one file: its own `package.json`, once
  at module load, so that the version reported in `initialize`'s
  `serverInfo` matches the published package (`saihm_mcp_server.ts`,
  `readPackageVersion()`; it falls back to `0.0.0-dev` rather than
  throwing). That read landed in 0.3.1 and this section described the
  server as reading nothing at all until it was corrected in 0.3.11.

### DoS resistance

- **Per-call abort window: 30 seconds.** Every request runs under an
  `AbortController` that fires after 30 seconds. A hung operator
  cannot starve the MCP server indefinitely.
- **Response-size cap: 16 MB, enforced twice.** A declared
  `Content-Length` over the cap is rejected before the body is read at
  all. Independently, the body is measured while it streams and the
  read is aborted the moment it exceeds the cap, so the control does
  not depend on the sender declaring an honest `Content-Length`, or
  any at all. The integration test asserts both: a server that emits a
  20 MB `Content-Length` header, and a chunked reply that declares
  none.

### Input validation

- **URL validation.** `SAIHM_ENDPOINT_URL` is parsed with the WHATWG
  `URL` constructor when the runtime client is constructed, and a
  malformed or non-HTTPS URL throws there. That construction is
  **lazy** — it happens on the first tool call, not at process start,
  so the server starts and answers `tools/list` with no configuration
  at all (registry introspection depends on this). The practical
  consequence is worth stating plainly: a misconfigured endpoint does
  *not* fail at boot, it fails on the first tool call. The thrown
  message does not include the Authorization header.
- **Type checking.** TypeScript strict mode (`"strict": true` in
  `tsconfig.json`) is enabled, catching common classes of error at
  compile time. `npm run typecheck` runs on every CI build and covers
  **both** the shipped sources and the test suite: the base
  `tsconfig.json` excludes `tests/` because `npm run build` emits from
  it and test files must not reach `dist/`, so a second no-emit pass
  (`tsconfig.test.json`) typechecks them without changing what is
  published. Without that second pass the test suite — the evidence
  base for every other claim in this document — would itself be
  unverified TypeScript.

### Distribution integrity

- **npm sigstore provenance, on `0.3.6` and later.** Releases are
  published by `.github/workflows/release.yml` on GitHub Actions via
  **OIDC trusted publishing**, which generates the SLSA provenance
  attestation automatically — the workflow runs a plain `npm publish`,
  with no `--provenance` flag and no long-lived npm token. That
  pipeline went live at `0.3.6`. Every version from `0.3.6` to
  `0.3.10` carries `dist.attestations` with predicate type
  `https://slsa.dev/provenance/v1`; the ten earlier versions
  (`0.1.0`–`0.3.5`) were published by hand and carry **no**
  attestation. The scope is stated because an unscoped "releases carry
  provenance" would be false of two thirds of the published versions.
  Verification:
  ```bash
  npm audit signatures
  npm view @saihm/mcp-server@0.3.10 --json | jq .dist.attestations
  ```
- **Release tags — no tag is signed, and the gaps are not uniform.**
  Tag signing is **not** enforced, and this section claims only what is
  enforced (see the preamble), so it is recorded as a gap rather than a
  control. The detail matters to anyone planning to close it:
  `v0.1.0`, `v0.2.0` and `v0.3.0`–`v0.3.5` are **annotated** tags that
  were never signed, so they could be re-signed in place; `v0.1.2` and
  `v0.3.6`–`v0.3.10` are **lightweight**, hold no tag object at all,
  and would have to be recreated as annotated tags first.
  Version-to-commit mapping has two gaps of its own: `0.1.1` is
  published on npm with no tag at all, and `v0.3.2`, `v0.3.4` and
  `v0.3.5` have tags but no GitHub Release. For `0.3.6` onward the
  artifact-to-source link to rely on is the **provenance attestation**
  above, which binds that tarball to the Actions run and commit that
  built it.

### Surface minimization

- **No EVM tooling.** The package does not depend on `ethers` or any
  Solidity-compiled artefact. Operators implementing the protocol
  stack are recommended to use `@noble/curves` and
  `@noble/post-quantum` (MIT) for primitive needs.
- **No secret-bearing cryptography in this repo.** The MCP server holds
  no signing keys, no key-derivation routines, and no AEAD — nothing
  here consumes or produces key material. The one primitive it does use
  is SHA-256, from `@noble/hashes` (audited, MIT), for content digests
  only: the `outputSha256` of a generated report and the `templateHash`
  that identifies a registered template. Both are integrity/identity
  digests over public inputs, not secrets. Everything that touches key
  material lives at the operator-endpoint layer, and `CONTRIBUTING.md`
  disallows introducing further cryptographic primitives here.
- **No additional MCP tools beyond the eight-tool cap.** Adding a
  ninth tool requires the breaking-change process documented in
  `GOVERNANCE.md`. The cap exists in part as a hardening control:
  fewer tools means a smaller attack surface and a more
  auditable protocol contract.

### Build + CI hardening

- **Pinned dependencies.** `package-lock.json` is committed; CI uses
  `npm ci`, not `npm install`, so dependency-resolver drift cannot
  introduce surprise versions between commits.
- **Reproducible build.** `npm ci && npm run build` on the same
  commit yields an identical `dist/`.
- **CI on every PR and every push to `main`.**
  `.github/workflows/ci.yml` runs lint, format check, typecheck, build
  and the full test suite on Node 20.x *and* 22.x. Treat it as a
  signal rather than a gate: `main` carries no branch protection and
  no rulesets, so a red check does not mechanically block a merge or a
  push. Promoting it to a required status check is a
  repository-settings change and is recorded here as a gap. Until
  0.3.11 this section described the checks as gating a merge.
- **Dependabot enabled.** `.github/dependabot.yml` opens weekly PRs
  for npm-ecosystem updates and security advisories on dependencies.

### Process hardening

- **DCO sign-off — documented policy, not an enforced control.**
  `CONTRIBUTING.md` §"Licensing and DCO sign-off" and `GOVERNANCE.md`
  §"Intellectual property" ask inbound contributions to carry a
  `Signed-off-by:` trailer (Developer Certificate of Origin 1.1), and
  the remedy both describe is manual — a pull request without sign-off
  is asked to rebase. Nothing automates that: there is no DCO check in
  `.github/workflows/` and no DCO app installed, so no PR is
  mechanically rejected. Maintainer practice has lapsed too. Sign-off
  was adopted during the OpenSSF Silver push and held for a run of
  commits, but most commits on `main` carry no trailer, including
  every recent one. Recorded as a gap; this section
  described sign-off as required and unsigned PRs as rejected until
  0.3.11.
- **Private vulnerability channel.** Reports are routed via
  `architect@saihm.coti.global` per
  [`SECURITY.md`](./SECURITY.md); 14-day acknowledgment, 30-day
  fix-or-mitigation-plan targets.
- **Security-sensitive change review.** `GOVERNANCE.md` requires
  founding-maintainer (or, once formed, TSC) sign-off on
  security-sensitive changes (auth, transport, crypto-adjacent code
  paths).

## Protocol-layer crypto (operator side, for completeness)

The MCP server itself does not run protocol cryptography, but the
operator-endpoint protocol stack uses publicly-published primitives
only:

- **ML-DSA-65** (NIST FIPS-204, 2024) — post-quantum identity
  binding for the holder.
- **HKDF** (RFC 5869) — per-cell DEK derivation from the holder's
  wallet-bound key material plus per-cell salt.
- **Ed25519** (RFC 8032) — short-term verifier signatures where
  used.
- **Standard NIST-approved AEAD ciphers** for cell encryption.
- **`kekVersion` rotation** — protocol supports algorithm rotation
  without invalidating older cells (they retain their version tag).

No deprecated primitives are used: no MD5/SHA-1 for integrity, no
RC4, no DES, no ECB-mode block ciphers.

## Verification

To verify the hardening choices above in the shipped artifact:

1. **Source on GitHub:** <https://github.com/SAIHM-Admin/saihm-mcp>
2. **Integration test:** clone, `npm install && npm test`. The test
   asserts the HTTPS-only enforcement, both halves of the 16 MB cap
   (declared `Content-Length` and streamed body), and the
   header-no-echo behaviour.
3. **CI green check:** <https://github.com/SAIHM-Admin/saihm-mcp/actions>
4. **npm provenance:** `npm view @saihm/mcp-server --json | jq .dist`
   then `npm audit signatures`.
5. **OpenSSF BP badge:** <https://www.bestpractices.dev/projects/12898>
   (Passing achieved 2026-05-19; Silver in progress).

## Reporting a hardening gap

If you find a hardening choice that should be enforced but is not, or
a documented choice that is *not* in fact enforced in code, please
follow [`SECURITY.md`](./SECURITY.md) — the private channel is the
preferred route. Do not open a public issue for security gaps.
