# Governance

This document describes the governance of the SAIHM Project (the
"Sovereign AI Horizontal Memory Protocol" and its reference MCP server
`@saihm/mcp-server`). It is modeled on the
[Linux Foundation Minimum Viable Governance](https://github.com/linuxfoundation/OpenMVG)
template, adapted for a single-protocol project that has not yet been
adopted into a foundation.

This file is intended to evolve as the project matures. The current
state reflects honest pre-adoption reality: a single founding
maintainer, an interim decision process, and a clear plan for how that
will broaden as adoption grows or as the project is accepted by a
foundation (AAIF is the stated target — see the project's standards
campaign).

## Project scope

The project consists of:

- The **SAIHM protocol specification**, progressed via the IETF
  Independent Submission Stream as
  [`draft-saihm-memory-protocol`](https://datatracker.ietf.org/doc/draft-saihm-memory-protocol/).
- The **reference MCP server**, published to npm as
  [`@saihm/mcp-server`](https://www.npmjs.com/package/@saihm/mcp-server)
  and to GitHub at
  [`SAIHM-Admin/saihm-mcp`](https://github.com/SAIHM-Admin/saihm-mcp).
- The **standards crosswalk pages** at
  <https://saihm.coti.global/standards/> (NIST AI RMF, ISO/IEC 42001,
  ISO/IEC 27001, EU AI Act, GDPR Art.17, MCP).

The **eight-tool MCP cap** is a protocol invariant. Changes that add a
ninth tool, or remove or rename an existing tool, require a breaking-
change revision of the specification under the process described
below.

## Roles

### Contributor

Anyone who submits a bug report, feature request, documentation
improvement, or pull request. Contributors do not need any formal
status. The contribution process is described in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

### Maintainer

A maintainer has commit access to the `SAIHM-Admin/saihm-mcp`
repository and can review and merge pull requests. Maintainers are
expected to:

- Review pull requests in their area of responsibility within a
  reasonable time (target: 14 days).
- Maintain a working knowledge of the protocol invariants
  (eight-tool MCP cap; HTTPS-only operator endpoints; no EVM tooling;
  Apache-2.0 inbound = outbound).
- Follow the code-review process described below.
- Uphold the code of conduct described in
  [`CONTRIBUTING.md`](CONTRIBUTING.md).

### Founding maintainer

The role of founding maintainer is held until either (a) a Technical
Steering Committee is formed (see below), or (b) the project is
accepted by a foundation that defines its own leadership model. The
founding maintainer's responsibilities are the union of the maintainer
role plus:

- Final say on specification revisions until a TSC exists.
- Initiating the process to add new maintainers.
- Responsible disclosure of vulnerabilities reported via
  [`SECURITY.md`](SECURITY.md).
- Trademark stewardship until any cession to a foundation.

The current founding maintainer is Russell Jackson, on behalf of the
SAIHM Project, reachable at `architect@saihm.coti.global`.

### Technical Steering Committee (TSC)

The TSC does not yet exist. It will be formed at the earlier of:

- Acceptance of the SAIHM Project by the Agentic AI Foundation (AAIF)
  or another open-source foundation that requires a TSC, or
- The first time a second core maintainer joins from a different
  organization than the founding maintainer's.

When the TSC is formed, it will have an odd number of seats (initially
3), drawn from active maintainers across at least two distinct
organizations. Seat allocation, chair selection, and meeting cadence
will be documented in a TSC charter committed to this repository
before the TSC takes its first decision.

## Decision process

### Specification decisions

The SAIHM protocol specification governs the wire format, the
cryptographic primitives, and the audit-receipt structure that the
reference implementation (and any other conforming implementation)
must obey.

- **Non-breaking clarifications** (typos, prose edits, examples that
  do not change normative behavior): merged on the standard
  pull-request flow by any maintainer.
- **Non-breaking additions** (new optional fields, new informational
  sections): merged after one maintainer approval, with a 7-day
  public-comment window on the corresponding issue or pull request.
- **Breaking changes** (changes to the wire format, the eight-tool
  cap, identity binding, cryptographic primitives, or any other
  field that conforming implementations are required to honor):
  require a 14-day public-comment window, founding-maintainer
  ratification (or, once formed, a TSC supermajority), and a
  version-major bump in the specification draft.

Specification work currently happens in two surfaces in parallel:

- The IETF ISE draft track (`draft-saihm-memory-protocol`),
  publicly visible on IETF Datatracker.
- The reference implementation repository
  (`SAIHM-Admin/saihm-mcp`), where the spec text lives in the
  `standards-campaign/` area of the project and is mirrored into the
  IETF draft on each version bump.

When a Working Group or independent track formalizes the
specification at a SDO (W3C, IETF, AAIF), that body's process
supersedes the process above for the surfaces it governs.

### Implementation decisions

Implementation decisions cover the reference MCP server and its
test suite and CI.

- **Standard pull requests** (bug fixes, dependency bumps, test
  additions, documentation): one maintainer review and approval; CI
  must be green.
- **Refactors that affect the eight-tool surface or the server's
  public TypeScript types**: two maintainer reviews (where two
  maintainers exist; one for now).
- **New features that change behavior visible to MCP clients**:
  treated as specification changes (see above) if they touch the wire
  format, otherwise treated as standard pull requests with an
  attached design issue.
- **Security-sensitive changes** (auth, transport, crypto-adjacent):
  require explicit founding-maintainer (or, once formed, TSC) sign-off
  in addition to standard review.

### Releases

Releases follow [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

- Patch releases (`0.X.Y` → `0.X.Y+1`): any maintainer.
- Minor releases (`0.X.Y` → `0.X+1.0`): founding maintainer (until a
  TSC exists), with release notes captured in the git commit message
  and/or a `CHANGELOG.md` entry.
- Major releases (`X.Y.Z` → `X+1.0.0`): require the breaking-change
  specification process above plus a 30-day deprecation window for
  any removed behavior.

Releases are signed via npm sigstore provenance attestation; users
can verify with `npm audit signatures`.

### Adding and removing maintainers

- **Adding** a maintainer: a contributor who has had three or more
  non-trivial pull requests merged, has demonstrated familiarity with
  the protocol invariants, and has the trust of the existing
  maintainers may be nominated. Nomination is a public issue;
  ratification requires founding-maintainer approval (until a TSC
  exists) or TSC simple majority.
- **Stepping down**: a maintainer may voluntarily step down by
  opening a public issue; the founding maintainer (or TSC) confirms
  the date and updates the maintainer list.
- **Inactivity**: a maintainer who has had no review or commit
  activity for 12 consecutive months may be moved to "emeritus"
  status by founding-maintainer (or TSC) decision after a 30-day
  notice issue. Emeritus maintainers retain attribution but not
  commit access.
- **Removal for cause**: a maintainer who repeatedly violates the
  code of conduct or the project's invariants may be removed by
  founding-maintainer decision (until a TSC exists), with the reason
  documented in a public issue. Once a TSC exists, removal requires
  TSC supermajority.

## Conflict resolution

The project follows lazy consensus: silence on a public issue for the
applicable comment window equals agreement. When a non-trivial
disagreement arises:

1. The disagreement is escalated to a public issue with all positions
   summarized.
2. The founding maintainer (or, once formed, the TSC) facilitates a
   reasonable discussion window — at least 7 days for implementation
   matters, at least 14 days for specification matters.
3. If no consensus emerges, the founding maintainer rules (until a
   TSC exists). Once a TSC exists, the TSC chair calls a vote;
   simple majority decides for implementation matters, supermajority
   for specification matters.

Disagreement about the protocol invariants (the eight-tool MCP cap,
HTTPS-only operator endpoints, the zero-EVM-tooling rule) requires a
breaking-change process; these invariants exist because they protect
specific safety, security, or compatibility properties of the
protocol.

## Code review

Every pull request must:

1. Pass CI on every target Node version (`20.x` and `22.x` currently).
2. Receive at least one maintainer review approval.
3. Not regress any tested behavior (`npm test` green before merge).

Reviews focus on:

- Correctness against the protocol specification.
- Test coverage for new behavior (per the test policy in
  [`CONTRIBUTING.md`](CONTRIBUTING.md)).
- Security-sensitive code paths (auth header handling, URL
  validation, response size caps, abort-controller wiring).

Reviewers should be specific in their feedback and patient with
first-time contributors. Bikeshedding is discouraged; pull requests
that have been open for more than 30 days without a substantive review
should be flagged in a public issue.

## Code of conduct

The project follows the spirit of the
[Contributor Covenant](https://www.contributor-covenant.org/) without
adopting its full text. The expectation is straightforward: be civil,
be substantive, and uphold each other's right to participate.

Maintainers may take action up to and including removing disruptive
participants from the project's public spaces, as described in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Intellectual property

- The reference implementation is licensed under the
  [Apache License 2.0](LICENSE).
- Inbound contributions are accepted under the same Apache 2.0
  license, with no CLA required for typical contributions. A DCO
  process may be requested for substantial contributions; see
  [`CONTRIBUTING.md`](CONTRIBUTING.md).
- The specification is being progressed through the IETF Independent
  Submission Stream; the IETF Trust Legal Provisions apply to the
  draft text as published on IETF Datatracker. The Apache-2.0 license
  applies to the specification text as published in this repository.
- The "SAIHM" name and any associated wordmark are currently held by
  the SAIHM Project. On acceptance of the project by AAIF (the stated
  primary foundation target) or another foundation, all project
  trademarks and accounts will be donated to that foundation per the
  applicable foundation charter.

## Amending this document

This governance document may be amended by:

- The founding maintainer, with a 14-day public-comment window on a
  pull request that links to a public issue describing the proposed
  change, until a TSC exists.
- The TSC by supermajority, once it exists.

Substantive changes (introduction of a new role, change to the
decision-process windows, change to the breaking-change definition)
must be announced on the project's public discussion channels at the
start of the comment window.

## References

- [Linux Foundation Minimum Viable Governance template](https://github.com/linuxfoundation/OpenMVG)
- [Contributor Covenant](https://www.contributor-covenant.org/)
- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
- [AAIF Foundation Charter §8 (Trademark)](https://github.com/aaif/foundation/blob/main/charter.md)
- [Project standards page](https://saihm.coti.global/standards)
- [Project blog](https://saihm.coti.global/blog/)
