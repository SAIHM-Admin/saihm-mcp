# Security policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in the SAIHM MCP server
(`@saihm/mcp-server`), please report it privately so that we can investigate
and remediate before public disclosure.

**Private channel:** architect@saihm.coti.global

Please include, where possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof-of-concept
- Affected version(s) of `@saihm/mcp-server`
- Whether the issue is in the MCP-server shim, the SAIHM operator endpoint
  it talks to, or in a dependency
- Your name or handle if you wish to be credited in the fix

We acknowledge reports within **14 days**. We aim to provide an initial
assessment and a fix or mitigation plan within **30 days** for confirmed
vulnerabilities, depending on severity and complexity.

## Scope

In scope:

- The published npm package `@saihm/mcp-server` and its source in this
  repository
- The way this package talks to a SAIHM operator endpoint (configuration,
  authentication header handling, tool input/output forwarding)

Out of scope (please report to the relevant project instead):

- Vulnerabilities in third-party MCP clients (Claude Code, Claude Desktop,
  Cursor, etc.) — report to the client vendor
- Vulnerabilities in the underlying Model Context Protocol — report to
  https://github.com/modelcontextprotocol
- Vulnerabilities in the COTI V2 blockchain network — report to COTI Group
- Vulnerabilities in your specific SAIHM operator deployment — report to your
  operator
- Vulnerabilities in unrelated open-source dependencies — please report
  upstream and let us know so we can pull a patched version

## Disclosure

We follow a coordinated-disclosure model. Once a fix or mitigation is
available we will:

1. Release a patched version of `@saihm/mcp-server` to npm
2. Publish a security advisory on the GitHub repository
3. Credit the reporter (with permission) in the advisory and release notes
4. Notify SAIHM operator deployments via the SAIHM operations channel

If a reporter has urgent operational concerns, the SAIHM operations team can
be reached via the same private channel for emergency coordination.

## Cryptographic and protocol-level concerns

The MCP server itself is intentionally a thin tool surface — it holds no
cryptographic keys, no storage, and no protocol runtime; those live behind the
SAIHM operator endpoint. The protocol stack uses:

- ML-DSA-65 (NIST FIPS-204) for post-quantum agent identity binding
- HKDF (RFC 5869) for per-cell key derivation
- Standard NIST-approved AEAD ciphers for cell encryption
- Public-chain (COTI V2 mainnet) anchoring for audit receipts

If a vulnerability is in the protocol specification itself rather than a
specific implementation, please indicate that in your report so we can route
it to the standards track (IETF Independent Submission Stream
`draft-saihm-memory-protocol`) for coordinated handling.

## Thank you

Responsible disclosure protects the broader agent ecosystem. We appreciate
the time and care of security researchers who report issues to us privately.
