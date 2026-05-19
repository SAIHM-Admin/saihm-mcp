# Contributing to `@saihm/mcp-server`

Thank you for your interest in contributing. This is the MCP-server reference
implementation for the SAIHM (Sovereign AI Horizontal Memory) protocol.

## Ways to contribute

- **Bug reports.** File a public issue at
  https://github.com/SAIHM-Admin/saihm-mcp/issues. Include version, MCP
  client, configuration (with secrets redacted), and reproduction steps.
- **Security vulnerabilities.** Please **do not** open a public issue. See
  [`SECURITY.md`](SECURITY.md) for the private reporting channel.
- **Documentation fixes.** Pull requests against `README.md` are welcome.
- **Feature ideas.** Open an issue first to discuss scope, especially around
  the eight-tool MCP cap, which is an invariant of the protocol.
- **Standards-track feedback.** The protocol itself is being progressed via
  the IETF Independent Submission Stream as
  `draft-saihm-memory-protocol`. Standards-level comments are welcome
  there or via issue here.

## Pull-request process

1. Fork the repository and create a topic branch off `main`.
2. Make your change. Keep PRs focused — one logical change per PR.
3. **Tests.** New non-trivial functionality must include a test. The existing
   suite is in `tests/`. Run `npm test` locally before opening the PR.
4. **Regression tests for bug fixes.** Every bug-fix PR must include a
   regression test that would have caught the bug (i.e., a test that
   fails on the pre-fix code and passes on the post-fix code). PRs that
   fix a reported bug without a corresponding regression test will be
   asked to add one before merge. Documentation-only or
   metadata-only fixes are exempt.
5. **Types.** Run `npm run typecheck`. TypeScript strict mode is enabled.
6. **Build.** Run `npm run build` to verify the published artefact still
   compiles.
7. Update `README.md` if you change tool behaviour, configuration, or the
   externally-visible interface.
8. Open a pull request. Describe what changed and why. Link any related
   issues.

## Coding conventions

- TypeScript, ES modules, strict mode.
- Keep the MCP-server surface minimal — the server is a thin forwarding shim
  to the SAIHM operator endpoint. Protocol logic lives behind the operator
  endpoint, not here.
- No new cryptographic primitives in this repository. Identity binding,
  encryption, and audit anchoring are provided by the operator endpoint and
  specified in the protocol draft.
- Do not introduce a ninth MCP tool. The eight-tool cap is a protocol
  invariant.

## Licensing and DCO sign-off

By submitting a contribution, you agree that your contribution is licensed
under the same [Apache License 2.0](LICENSE) as the rest of the project, and
that you have the right to grant that license.

This project uses the **Developer Certificate of Origin (DCO) 1.1**
(<https://developercertificate.org/>) instead of a CLA. Every commit must
include a `Signed-off-by:` trailer attesting to the DCO. You can add it
automatically by passing `-s` to `git commit`:

```bash
git commit -s -m "Your commit message"
```

The trailer looks like:

```
Signed-off-by: Real Name <email@example.com>
```

Use your real name and an email you can be reached at. By signing off, you
certify the four points of the DCO 1.1 (origin, license-compatibility, third
party with permission, and acceptance that the contribution and your sign-off
become a public record).

PRs whose commits lack `Signed-off-by:` trailers will be asked to rebase
with sign-off before merge. To retroactively sign off existing commits in a
branch:

```bash
git rebase -i HEAD~N --exec "git commit --amend --no-edit -s"
```

## Code of conduct

This project adopts the [Contributor Covenant v2.1](CODE_OF_CONDUCT.md).
By participating in this project, you agree to abide by its terms. Reports of
unacceptable behavior can be sent privately to `architect@saihm.coti.global`,
as described in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Questions

If you are unsure whether your contribution fits, open a draft issue and ask.
We would rather discuss scope early than rework a PR later.
