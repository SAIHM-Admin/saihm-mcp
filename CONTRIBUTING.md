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
4. **Types.** Run `npm run typecheck`. TypeScript strict mode is enabled.
5. **Build.** Run `npm run build` to verify the published artefact still
   compiles.
6. Update `README.md` if you change tool behaviour, configuration, or the
   externally-visible interface.
7. Open a pull request. Describe what changed and why. Link any related
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

## Licensing

By submitting a contribution, you agree that your contribution is licensed
under the same [Apache License 2.0](LICENSE) as the rest of the project, and
that you have the right to grant that license. No CLA is required for typical
contributions.

If your contribution is substantial and you would prefer a more formal
Developer Certificate of Origin (DCO) or CLA process, please open an issue to
discuss.

## Code of conduct

Be civil. Be substantive. We follow the spirit of the
[Contributor Covenant](https://www.contributor-covenant.org/) without adopting
its full text. Behaviour that derails contribution or harasses participants
will be addressed by maintainer action up to and including removal.

## Questions

If you are unsure whether your contribution fits, open a draft issue and ask.
We would rather discuss scope early than rework a PR later.
