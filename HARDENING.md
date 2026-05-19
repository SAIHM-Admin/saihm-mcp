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

- **HTTPS-only operator endpoints.** Plain `http://` is rejected at
  `SaihmRuntimeClient` construction time, with the exception of
  `127.0.0.1` and `localhost` (for local development). The rejection
  is a thrown error, not a silent downgrade.
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
- **No on-disk persistence.** The server never reads from or writes
  to the filesystem. Configuration flows entirely through environment
  variables.

### DoS resistance

- **Per-call abort window: 30 seconds.** Every request runs under an
  `AbortController` that fires after 30 seconds. A hung operator
  cannot starve the MCP server indefinitely.
- **Response-size cap: 16 MB.** Responses whose `Content-Length`
  exceeds 16 MB are rejected before deserialization. The integration
  test asserts this with a server that emits a 20 MB `Content-Length`
  header.

### Input validation

- **URL validation.** `SAIHM_ENDPOINT_URL` is parsed with the WHATWG
  `URL` constructor at startup; malformed URLs cause an immediate
  fatal error with a message that *does not* include the
  Authorization header.
- **Type checking.** TypeScript strict mode (`"strict": true` in
  `tsconfig.json`) is enabled, catching common classes of error at
  compile time. The `npm run typecheck` script runs `tsc --noEmit`
  on every CI build.

### Distribution integrity

- **npm sigstore provenance.** Releases are published with
  `npm publish --provenance`, generating an in-toto attestation that
  links the published tarball back to the GitHub Actions run that
  built it. Verification:
  ```bash
  npm audit signatures
  npm view @saihm/mcp-server --json | jq .dist
  ```
- **Signed git tags (going forward).** Tags are signed with the
  founding-maintainer's GPG key. The v0.1.2 tag predates this policy;
  v0.1.3 and onward will be signed.

### Surface minimization

- **No EVM tooling.** The package does not depend on `ethers` or any
  Solidity-compiled artefact. Operators implementing the protocol
  stack are recommended to use `@noble/curves` and
  `@noble/post-quantum` (MIT) for primitive needs.
- **No cryptographic primitives in this repo.** The MCP server holds
  no signing keys, no derivation routines, and no AEAD. All
  cryptography lives at the operator-endpoint layer or in the
  recommended primitive libraries. `CONTRIBUTING.md` explicitly
  disallows introducing new cryptographic primitives in this
  repository.
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
- **CI on every PR.** Tests and type-check must pass on Node 20.x
  *and* 22.x before merge.
- **Dependabot enabled.** `.github/dependabot.yml` opens weekly PRs
  for npm-ecosystem updates and security advisories on dependencies.

### Process hardening

- **DCO sign-off required.** Every commit must include a
  `Signed-off-by:` trailer (Developer Certificate of Origin 1.1).
  PRs without sign-off are rejected.
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
   asserts the HTTPS-only enforcement, the Content-Length cap, and
   the header-no-echo behaviour.
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
