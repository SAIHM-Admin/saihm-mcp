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

- The **SAIHM protocol specification**, published as the Internet-Draft
  [`draft-saihm-memory-protocol`](https://datatracker.ietf.org/doc/draft-saihm-memory-protocol/).
  The `-01` revision (2026-05-27) was submitted to the IETF Independent
  Submission Stream; on 2026-07-25 the ISE concluded its consideration
  and released it from the queue, and the datatracker stream is now
  None. The draft is **not** an Internet Standard, is not endorsed by
  the IETF, and has no formal standing in the IETF standards process.
  The `-01` text remains available on the datatracker as the current
  reference text.
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
- Uphold the code of conduct in
  [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

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

Specification work has one surface of record:

- The published Internet-Draft `draft-saihm-memory-protocol-01` on the
  IETF Datatracker is the specification text of record. It sits on no
  IETF stream today (see *Project scope* above) and carries the normal
  Internet-Draft expiry. The project's intent is to re-anchor the
  normative reference on a working-group document once one exists that
  can be cited.

This repository holds the reference implementation, **not** the
specification text — a point `ARCHITECTURE.md` makes explicitly. Draft
revisions are prepared and submitted to the datatracker separately;
there is no copy of the specification in this repository to keep in
sync.

When a Working Group or other body formalizes the specification at an
SDO (W3C, IETF, AAIF), that body's process supersedes the process above
for the surfaces it governs.

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

Releases from `0.3.6` onward are published from GitHub Actions over
OIDC trusted publishing and carry an npm sigstore provenance
attestation; users can verify with `npm audit signatures`. Earlier
versions (`0.1.0`–`0.3.5`) were published by hand and carry no
attestation. Release tags are not signed — see `HARDENING.md`
§"Distribution integrity", which records that as a gap.

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

The project adopts the
[Contributor Covenant v2.1](CODE_OF_CONDUCT.md) **in full**; its text is
committed to this repository as
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and
[`CONTRIBUTING.md`](CONTRIBUTING.md) restates that adoption for
contributors who arrive there first.

Enforcement — up to and including removing disruptive participants from
the project's public spaces — follows the *Enforcement* and *Enforcement
Guidelines* sections of that document. Reports go privately to
`architect@saihm.coti.global`.

## Intellectual property

- The reference implementation is licensed under the
  [Apache License 2.0](LICENSE).
- Inbound contributions are accepted under the same Apache 2.0
  license. There is no CLA. In its place the project requires a
  Developer Certificate of Origin 1.1 sign-off on **every** commit —
  a `Signed-off-by:` trailer, which `git commit -s` adds. Pull requests
  whose commits lack it are asked to rebase with sign-off before merge.
  See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- The specification was submitted to the IETF Independent Submission
  Stream and is published on the IETF Datatracker as an Internet-Draft.
  The IETF Trust Legal Provisions apply to that draft text as published
  there, and continue to apply now that the ISE has released it from
  the queue. The Apache-2.0 license applies to the reference
  implementation in this repository.
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
- [Project blog](https://saihm.coti.global/blog)
