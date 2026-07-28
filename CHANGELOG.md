# Changelog

All notable changes to `@saihm/mcp-server` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.9] — 2026-07-28

Onboarding release. Documentation and first-run guidance only — no protocol,
wire-format, or tool-surface change, and this package remains crypto-free.

### Fixed

- **The first-run error was a dead end.** A fresh install has no operator
  endpoint, so the first tool call throws — and the message offered only a
  website and the offline demos. It now names the free path explicitly
  (`npx -y @saihm/mcp-server-pro free-join`) alongside the operator route and
  the demos, so an agent that hits the error can act on it.
- **The documented free-trial command could not work.** The quickstart omitted
  `SAIHM_ENDPOINT_URL` and the master secret, so it failed with
  `SAIHM_ENDPOINT_URL env var required`. Corrected to a working sequence,
  including how to generate the secret.

### Changed

- **"Companion package" pointed only at `@saihm/client-pro`**, a library. It now
  names `@saihm/mcp-server-pro` first — the drop-in MCP server that performs the
  client-side cryptography itself and can self-onboard, including the free
  trial — and describes `@saihm/client-pro` as the embeddable library.
- The free trial is now surfaced at the top of the README, ahead of the offline
  demos, instead of below the configuration section that assumes an endpoint.

## [0.3.8] — 2026-07-01

Discovery release. Registry and README metadata only — no protocol,
wire-format, or runtime code change, and this package remains crypto-free.

### Changed

- **The offline demos are now visible before the install decision.** Someone
  reading the npm or MCP-registry listing had no signal that the protocol can
  be evaluated without an account. A one-line evaluate-it-offline pointer was
  added at the top of the README (above "What this is"), to the npm
  `description`, and to the `server.json` registry `description`.
- The `server.json` description was rewritten to fit the registry's length
  limit while making room for the demos: dropped "Post-quantum" and shortened
  "persistent memory" to "memory", producing
  `Sovereign encrypted memory for AI agents. 8 MCP tools. GDPR erasure. Runnable offline demos.`

## [0.3.7] — 2026-06-30

Distribution and first-run release. Adds registry/directory metadata and
automates MCP-registry publishing; the only runtime change is the text of two
configuration error messages. No protocol or wire-format change, and this
package remains crypto-free.

### Added

- **`.mcp.json`** — a standard MCP client-configuration file at the repo root
  so cursor.directory auto-detects the server instead of requiring a manual
  listing.
- **`glama.json`** — declares `maintainers: ["SAIHM-Admin"]` so the Glama
  registry ownership claim can be verified from the repo.
- **`assets/saihm-mcp-logo-400.png`** — a 400x400 project logo, the size MCP
  directory listings request.
- **Automated MCP-registry publishing.** `release.yml` now fetches
  `mcp-publisher`, authenticates with `login github-oidc`, and publishes
  `server.json` after the npm publish, so the registry entry no longer has to
  be pushed by hand. The `io.github.SAIHM-Admin/*` namespace is proven by the
  workflow's OIDC claim — no registry token is stored.

### Changed

- **The first-run error was a bare dead end.** A fresh install has no operator
  endpoint, so the first tool call threw `SAIHM_ENDPOINT_URL env var required`
  with nowhere to go. Both `bootFromEnv()` errors now append a setup hint
  naming the two next steps: obtain a live endpoint at
  <https://saihm.coti.global>, or evaluate the protocol offline first via the
  runnable demos.
- **The README Configure section assumed you already had credentials.** It now
  states that the endpoint and token are issued by an *operator* and gives both
  routes — join the hosted service, or run your own endpoint — plus the
  consequence of configuring neither.
- The README version line was a hardcoded `v0.3.4`, three releases stale. It is
  now a dynamic npm version badge, so it cannot drift again.

## [0.3.6] — 2026-06-30

Discovery release. No protocol or wire-format change; the published JavaScript
adds machine-readable tool output and a session-bootstrap prompt.

### Added

- **Structured tool output.** `saihm_remember`, `saihm_recall`, and
  `saihm_status` now advertise an `outputSchema` and return matching
  `structuredContent`, so MCP hosts and agents can consume typed results instead
  of parsing prose.
- **`saihm_session_bootstrap` prompt.** A new MCP prompt (the `prompts`
  capability is now advertised) that instructs an agent to load its SAIHM memory
  via `saihm_recall` at the start of a session.
- README tool-reference table and additional npm `keywords` (`mcp-server`,
  `persistent-memory`, `ai-agents`, `claude-desktop`, `cursor`, `gdpr`) for
  discovery.

### Changed

- `server.json` MCP-registry manifest: trimmed the `description` to the
  registry's length limit, added `websiteUrl`, and synced `version`.
- Generalized two README references to the receipt and key-derivation internals
  to describe them by class rather than by construction.

## [0.3.5] — 2026-06-27

Documentation release. No protocol, wire-format, or runtime code change.

### Added

- A "See it run" README section linking the offline cross-model demos and the
  open token benchmark.

## [0.3.4] — 2026-06-22

Documentation release. No protocol, wire-format, or runtime code change.

### Added

- A prominent "storage is the operator's responsibility (by design)" README
  section: operators choose and configure their durable backend (a local
  IPFS/Kubo node first, then a Filecoin deep-archive provider), and may instead
  Join SAIHM to use the hosted, non-custodial operator (ciphertext only).

### Changed

- Softened the legacy "persisted to Filecoin" wording to operator-configured
  durable storage.

## [0.3.3] — 2026-06-22

Documentation release. No protocol, wire-format, or runtime code change;
the published JavaScript is behavior-identical to 0.3.2.

### Changed
- Stated the IETF / Independent-Submission status precisely: the protocol
  is published as `draft-saihm-memory-protocol-01` (2026-05-27), *In ISE
  Review* in the Independent Submission Stream — not an Internet Standard,
  not endorsed by the IETF, and with no formal standing in the IETF
  standards process. Replaced the prior "draft-00 accepted into pipeline"
  wording (README Achievements) and the roadmap's "IETF RFC publication"
  with "Independent-stream (ISE) RFC publication."
- Added a companion-package cross-reference to `@saihm/client-pro`
  (production client-side post-quantum cryptography) in the README and
  refreshed the npm `description` to match.
- Corrected a misleading "Standards-track release" label on the historical
  0.1.3 entry below; that release was OpenSSF and governance work, unrelated
  to any standards-track status.

## [0.3.2] — 2026-06-22

Documentation patch. No protocol, wire-format, or runtime code change;
the published JavaScript is behavior-identical to 0.3.1.

### Fixed
- Corrected the documented operator-endpoint path from the phantom
  `/saihm/v1` to the canonical `/mcp` — in the README
  `SAIHM_ENDPOINT_URL` examples (×2) and the `saihm_runtime_client`
  configuration comment (×1).
- Corrected the distribution-integrity note: each release carries the
  npm registry signature (verify with `npm audit signatures`); the
  prior wording claimed sigstore provenance, which is not currently
  produced (no provenance attestation, no CI release workflow).

## [0.3.1] — 2026-05-28

Patch release. Fixes a long-standing version-string defect in the
MCP-server initialization: the `serverInfo.version` returned to MCP
clients on `initialize` was hardcoded to `"0.1.0"` since the very
first 0.1.0 release, regardless of the npm-published version
(observed via post-publish smoke testing of 0.3.0). The fix sources
the version string from `package.json` at boot so the reported
version always matches the npm-published version going forward.

### Fixed
- `serverInfo.version` returned to MCP clients via `initialize` now
  reflects the actual npm-published version (sourced from
  `package.json` at server-boot time). Prior to this fix, the value
  was hardcoded `"0.1.0"` for every release from 0.1.0 through
  0.3.0, which misrepresented the server's identity to any MCP
  client inspecting `serverInfo`.

### Changed
- `saihm_mcp_server.ts` now performs a synchronous `readFileSync`
  of the bundled `package.json` once at module load and passes the
  parsed `version` into the `McpServer` constructor. No new
  third-party dependencies were added (Node built-ins only:
  `node:fs`, `node:url`, `node:path`).

### Notes
- This is a metadata-only fix. There is no change to the
  `StatusSnapshot` shape, the cell tuple, the 8-tool MCP surface,
  the operator-wire protocol, or any test assertions.

## [0.3.0] — 2026-05-28

Alignment release: the public `StatusSnapshot` response shape returned
by `saihm_status` is extended to surface the spec-defined fields of
`draft-saihm-memory-protocol-01` §3.4. This fulfills the deferred
follow-up commitment recorded in the 0.2.0 "Scope" subsection. The
change is purely additive (existing consumers reading any of the
prior `prsScore` / `bfsiScore` / `storageByTier` /
`stakingPosition` / `activeSharingContracts` / `phi` /
`snapshotEpoch` fields continue to work unmodified); the version is
bumped to 0.3.0 because the public interface grew. No wire-protocol
behavior change at the operator endpoint.

The 0.2.0 "Scope" note named three deferred fields (`bfsi_R`,
`bfsi_M`, `bfsi_window_start_ts`); this release adds all eight
spec-defined fields of §3.4 (`prs`, `bfsi`, `bfsi_window_start_ts`,
`bfsi_R`, `bfsi_M`, `shards`, `contracts`, `governance`) so that the
full §3.4 surface is aligned in a single release rather than across
multiple minor versions.

### Added
- `StatusSnapshot.prs` — IEEE 754 binary64 in [0.0, 1.0], the spec
  §3.4 Process Reliability Score. Surfaced alongside the existing
  `prsScore` / `prsLevel` operator-extension fields.
- `StatusSnapshot.bfsi` — IEEE 754 binary64 in [0.0, 1.0], the spec
  §3.4 Byzantine Fault Score Index. Surfaced alongside the existing
  `bfsiScore` operator-extension field.
- `StatusSnapshot.bfsi_window_start_ts` — decimal-string UNIX epoch
  seconds, the start of the 30-day rolling window over which `bfsi`
  (and `prs`) is computed. Per spec §3.4 the bfsi inputs MUST be
  exposed to the holder so the computation is reproducible.
- `StatusSnapshot.bfsi_R` — decimal-string count of operator-anchored
  receipts attributed to the holder over the window. Surfaced as
  `string` (not `number`) so receipt counts beyond 2^53 - 1 remain
  exact.
- `StatusSnapshot.bfsi_M` — decimal-string count of those receipts
  with no corresponding tool-call event attested in the holder's
  local event log. Surfaced as `string` for the same precision
  reason.
- `StatusSnapshot.shards` — spec-aligned per-tier cell-count map
  (`Record<string, number>`), per §3.4. The pre-existing
  `storageByTier` (per-tier byte total) is retained alongside.
- `StatusSnapshot.contracts` — array of structured sharing-contract
  entries per §3.4. Each entry has `contractId` (32-byte hex),
  `mode` (uppercase spec enum `"TEMPORARY"` / `"PERMANENT"` /
  `"SYNDICATE"`), `granteeIds` (array of 32-byte hex), and
  `expiresAt` (decimal-string epoch seconds). Surfaced alongside the
  pre-existing `activeSharingContracts` count.
- `StatusSnapshot.governance` — array of structured governance-
  proposal entries per §3.4. Each entry has `propId` (32-byte hex),
  `scope`, `opens_ts`, `closes_ts`, `tally_for`, `tally_against`,
  and `tally_abstain`. Tally fields are decimal strings to preserve
  precision for unbounded vote-weight aggregates.
- Two new exported interfaces, `ContractEntry` and `GovernanceEntry`,
  for the new array-shaped fields.
- Server text-output addition: `saihm_status` now appends a §3.4
  line: `§3.4: prs=… bfsi=… (R=… M=… win=…) contracts=…
  governance=…`.
- Test-suite assertions for the new fields, including: numeric
  range checks ([0.0, 1.0]) on `prs` and `bfsi`; decimal-digit
  regex checks on `bfsi_R` / `bfsi_M` / `bfsi_window_start_ts` /
  `expiresAt` / `tally_for`; 32-byte hex shape checks on
  `contracts[].contractId` / `contracts[].granteeIds[]` /
  `governance[].propId`; mode-enum membership on
  `contracts[].mode`; and a round-trip check that
  `bfsi == 1 - (M / R)` to within a 1e-9 tolerance.

### Changed
- `ARCHITECTURE.md` now documents the `saihm_status` schema
  (`draft-saihm-memory-protocol-01` §3.4) including the `bfsi`
  formula, the R = 0 convention, and the integrity-threshold note.

### Notes
- This change is fully forward-compatible. The mock endpoint in
  `tests/integration.test.ts` was extended to return the new fields
  with values that satisfy `bfsi == 1 - (M / R)` round-trip
  (R = 8, M = 1, bfsi = 0.875). All existing assertions continue to
  pass.
- Operators implementing the SAIHM endpoint behind
  `SAIHM_ENDPOINT_URL` SHOULD return all of the new fields on
  `saihm_status` responses so the TypeScript-declared shape matches
  the runtime payload. The new fields are declared as required (not
  optional), reflecting the spec-alignment intent of this release;
  operators that omit a field will leave consumers reading that
  field with `undefined` at runtime, diverging from the declared
  shape. Consumers reading only the pre-0.3.0 fields
  (`prsScore`, `bfsiScore`, `storageByTier`, `stakingPosition`,
  `activeSharingContracts`, `phi`, `snapshotEpoch`) will not
  notice. The narrow class of consumers that *construct* a
  `StatusSnapshot` value literal (rare — the type is normally
  received from the operator endpoint) will need to provide the
  new required fields to satisfy the type checker; this is the
  only consumer-side compile-time change.
- The uppercase `"TEMPORARY"` / `"PERMANENT"` / `"SYNDICATE"` form
  used in `ContractEntry.mode` matches `draft-saihm-memory-
  protocol-01` §2.5 / §3.4 verbatim. It is independent of the
  lowercase `SharingContractType` enum (`'temporary'` /
  `'permanent'` / `'syndicate'`) used by `saihm_share` parameters,
  which is retained for legacy reasons. Operators are responsible
  for mapping between the two on the wire.
- The spec uses `bfsi_R`, `bfsi_M`, `bfsi_window_start_ts`,
  `opens_ts`, `closes_ts`, `tally_for`, `tally_against`, and
  `tally_abstain` in snake_case; the TypeScript field names mirror
  the spec verbatim rather than transforming to camelCase, so JSON
  wire encoding aligns with the spec without an intermediate
  serializer.

## [0.2.0] — 2026-05-28

Alignment release: the public `RememberResult` and `RecalledCell`
response shapes are extended to surface the public fields of the cell
tuple defined in `draft-saihm-memory-protocol-01` §2.1. The change is
purely additive (existing consumers reading only `cellId` / `tier` /
`plaintext` continue to work unmodified); the version is bumped to
0.2.0 because the public interface grew. No wire-protocol behavior
change at the operator endpoint.

Note on §2.1's recipient-side MUST-recompute of `cellId`: in this
architecture the operator is the recipient holding the ciphertext, so
the recompute runs at the operator endpoint. The client-surfaced
fields below let the agent keep a verifiable inspection record of
which nonce, KEK generation, and holder identity were bound to a
given cell.

### Added
- `RememberResult.cellNonce` — 16-byte hex per-cell nonce. Lets the
  agent log which nonce was bound to its memory cell at creation
  time. Per spec §2.1 this is a public field of the cell tuple.
- `RecalledCell.cellNonce`, `RecalledCell.kekVersion`,
  `RecalledCell.holderIdHex`, `RecalledCell.holderSignaturePrefix` —
  the public-tuple fields surfaced on recall, so the agent can
  inspect the cell's binding identity (which nonce sealed the DEK,
  which KEK generation, which holder public-key hash, and a compact
  prefix of the ML-DSA-65 holder signature). The full signature
  (~3309 bytes) is intentionally not surfaced; that is deferred to a
  future release pending consumer demand.
- Server text-output additions: `saihm_remember` now includes
  `nonce=<cellNonce>` in its `REMEMBERED` line; `saihm_recall`
  includes `kekV=<kekVersion> nonce=<cellNonce>` in each line.
- Test-suite assertions for the new fields, including a 16-byte hex
  shape check on `cellNonce` and a 32-byte hex shape check on
  `holderIdHex`.

### Changed
- `ARCHITECTURE.md` cell-tuple definition updated to the 8-field
  spec-aligned shape (`draft-saihm-memory-protocol-01` §2.1).
  Operator-side metadata (`epoch`, `feeNcoti`, `signaturePrefix`,
  `auditCellId`) is now documented separately from the spec wire
  tuple.

### Scope
This release aligns ONLY the §2.1 cell-tuple public-field surface.
Other parts of `draft-saihm-memory-protocol-01` (in particular the
§3.4 `saihm_status` schema, which adds `bfsi_R` / `bfsi_M` /
`bfsi_window_start_ts` for bfsi-input transparency) are NOT addressed
in this release and remain at the prior 0.1.x shape. A follow-up
release will perform the corresponding `StatusSnapshot` alignment.

### Notes
- This change is fully forward-compatible. The mock-endpoint in
  `tests/integration.test.ts` was extended to return the new fields,
  but the existing assertions (e.g. `r1.cellId === 'deadbeef'…`) all
  continue to pass.
- Operators implementing the SAIHM endpoint behind
  `SAIHM_ENDPOINT_URL` SHOULD return all of the new fields on
  `saihm_remember` and `saihm_recall` responses so the
  TypeScript-declared shape matches the runtime payload. The new
  fields are declared as required (not optional), reflecting the
  spec-alignment intent of this release; operators that omit a field
  will leave consumers reading that field with `undefined` at
  runtime, diverging from the declared shape. Consumers that only
  read `cellId` / `tier` / `plaintext` will not notice. The §2.1
  `cellId` recompute itself remains an operator-side duty because
  the client never receives ciphertext.

## [0.1.3] — 2026-05-19

Governance and assurance release: OpenSSF Best Practices Passing badge achieved
(project 12898, 100%); Silver criteria at 95%. Adds governance,
assurance, CI, and security tooling. Bumps runtime and dev
dependencies. No change to MCP-server runtime behavior or wire protocol.

### Added
- `SECURITY.md` — responsible disclosure policy with private channel
  (`architect@saihm.coti.global`), 14-day acknowledgment / 30-day
  fix-or-mitigation-plan targets.
- `CONTRIBUTING.md` — PR process, test policy, eight-tool MCP cap
  invariant, DCO 1.1 `Signed-off-by:` sign-off requirement, regression
  test mandate for bug-fix PRs.
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1 verbatim.
- `GOVERNANCE.md` — project governance modeled on the Linux
  Foundation's Minimum Viable Governance framework.
- `ARCHITECTURE.md` — system diagram, components, data envelope, trust
  model, threat-model summary, build/test/release flow.
- `HARDENING.md` — threat model + eight categories of enforced
  hardening choices.
- `ASSURANCE_CASE.md` — Claims-Arguments-Evidence structured argument
  for credential confidentiality, availability, distribution
  integrity, cryptographic currency, and process controls.
- `.bestpractices.json` — 115 `_status` fields (107 Met + 8 N/A) for
  OpenSSF Best Practices automation.
- `.github/workflows/ci.yml` — GitHub Actions CI on every push and PR
  (Node 20.x and 22.x): `npm ci`, lint, format:check, typecheck,
  build, test (with c8 coverage >= 80%).
- `.github/dependabot.yml` — weekly Dependabot for npm and
  github-actions ecosystems.
- ESLint (typescript-eslint recommended), Prettier, c8 coverage
  (statement >= 80% enforced; current 81.82%).
- OpenSSF Best Practices Passing badge in README — project 12898 at
  100% Passing criteria.

### Changed
- `@noble/hashes` 1.8.0 -> 2.2.0 (sha256 import path moved from
  `@noble/hashes/sha256` to `@noble/hashes/sha2.js`).
- `zod` 3.25.76 -> 4.4.3.
- `typescript` 5.9.3 -> 6.0.3 (requires `types: ["node"]` in tsconfig
  compilerOptions, now set).
- `@types/node` 20.19.40 -> 25.9.0.
- `tsx` 4.21.0 -> 4.22.2.
- GitHub Actions: `checkout` v4 -> v6, `setup-node` v4 -> v6.

## [0.1.2] — 2026-05-16

First release published to the MCP Registry (Glama) and to npm with
full metadata.

### Added
- `mcpName` field in `package.json` for MCP Registry discovery.
- `server.json` — MCP Registry submission metadata.
- `smithery.yaml` — Smithery configuration (stdio + npm).
- `Dockerfile` — multi-stage Node 20 Alpine image suitable for
  registry probes that prefer container packaging (Glama).
- Lazy initialization of `SaihmRuntimeClient` in
  `saihm_mcp_server.ts`: the server now starts cleanly without
  `SAIHM_ENDPOINT_URL` / `SAIHM_AUTH_HEADER`, so registry
  introspection (`tools/list`) works before configuration.

### Changed
- README and `package.json` description aligned with the Glama listing
  wording; removed marketing tags ("thin client", "bare-bones") in
  favor of neutral technical description. No semantic change.
- README version drift fixed (`v0.1.0` → `v0.1.2`).

### Notes
- Version `0.1.1` was skipped; the jump from `0.1.0` to `0.1.2`
  bundled the MCP Registry metadata + Glama Dockerfile + lazy-init
  changes into a single release.

## [0.1.0] — 2026-05-09

Initial release.

### Added
- Eight MCP tools wired into a single MCP server (stdio transport):
  `saihm_remember`, `saihm_recall`, `saihm_forget`, `saihm_status`,
  `saihm_share`, `saihm_revoke_share`, `saihm_governance_propose`,
  `saihm_governance_vote`. Each tool forwards to a SAIHM operator
  endpoint configured via env.
- Reporting library exported as a sub-export
  (`@saihm/mcp-server/reporting`): 280-field universe, bespoke
  template schema, four authorization-path validators, six
  receipt-emission sub-kinds, framework smoke
  (registry-attestation) for plumbing verification.
- Security defaults: HTTPS-only operator-endpoint enforcement (with
  `127.0.0.1` / `localhost` development exception), 30-second
  per-call abort window, 16 MB Content-Length response cap, no
  Authorization-header echo on errors, no filesystem reads, zero EVM
  tooling.
- Apache License 2.0.
- Integration test (`tests/integration.test.ts`) covering all eight
  MCP tools, the four reporting-library auth paths, the six receipt
  sub-kinds, the field-universe validation, and the security
  mitigations.

[Unreleased]: https://github.com/SAIHM-Admin/saihm-mcp/compare/v0.3.9...HEAD
[0.3.9]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.9
[0.3.8]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.8
[0.3.7]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.7
[0.3.6]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.6
[0.3.5]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.5
[0.3.4]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.4
[0.3.3]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.3
[0.3.2]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.2
[0.3.1]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.1
[0.3.0]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.2.0
[0.1.3]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.1.3
[0.1.2]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.1.2
[0.1.0]: https://github.com/SAIHM-Admin/saihm-mcp/commit/03f1897
