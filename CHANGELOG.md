# Changelog

All notable changes to `@saihm/mcp-server` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Changes since the v0.1.2 release tag. These are documentation,
governance, and CI improvements added in support of the project's
standards-track work (IETF ISE, OpenSSF Best Practices). They do not
change the published npm artifact's runtime behavior and will be
rolled into the next release.

### Added
- `SECURITY.md` — responsible disclosure policy with private channel
  (`architect@saihm.coti.global`), 14-day acknowledgment / 30-day
  fix-or-mitigation-plan targets, scope and out-of-scope listing.
- `CONTRIBUTING.md` — PR process, test policy, eight-tool MCP cap
  invariant, Apache-2.0 inbound = outbound, security-not-public-issue
  pointer.
- `GOVERNANCE.md` — project governance modeled on the Linux
  Foundation's Minimum Viable Governance framework: roles, decision
  process (specification vs implementation vs releases), adding /
  removing maintainers, conflict resolution, code review, code of
  conduct, intellectual property and trademark stewardship.
- `.bestpractices.json` — pre-populated OpenSSF Best Practices badge
  answers for all 67 Passing-level criteria. Used by the
  bestpractices.dev Chief automation for first-edit form population.
- `.github/workflows/ci.yml` — GitHub Actions CI running `npm ci`,
  `npm run typecheck`, `npm run build`, and `npm test` on every push
  to `main` and every pull request, against Node 20.x and 22.x.
- OpenSSF Best Practices Passing badge in README — project 12898 at
  100% Passing criteria.

### Changed
- README references the new CI workflow and Passing badge.

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

[Unreleased]: https://github.com/SAIHM-Admin/saihm-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.1.2
[0.1.0]: https://github.com/SAIHM-Admin/saihm-mcp/commit/03f1897
