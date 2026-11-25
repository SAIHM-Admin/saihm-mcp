# Security policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in the SAIHM MCP server
(`@saihm/mcp-server`), please report it privately so that we can investigate
and remediate before public disclosure.

**Private channels** (use either one):

- **Email:** security@saihm.net
- **GitHub private vulnerability reporting:** open a private advisory from
  this repository's Security tab ("Report a vulnerability", or
  <https://github.com/SAIHM-Admin/saihm-mcp/security/advisories/new>).

Reports through either channel follow the same process and targets.

Please include, where possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof-of-concept
- Affected version(s) of `@saihm/mcp-server`
- Whether the issue is in the MCP server, the SAIHM operator endpoint
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
4. Notify known SAIHM operator deployments privately by email

If a reporter has urgent operational concerns, use either private channel and
mark the subject line or advisory title `[URGENT]`. Urgent reports follow the
acknowledgment and assessment targets above. This project is maintained by
SAIHM, Inc. (see
[`GOVERNANCE.md`](GOVERNANCE.md)).

## Cryptographic and protocol-level concerns

The MCP server itself holds no cryptographic keys, no storage, and no
protocol runtime; those live behind the SAIHM operator endpoint. The protocol
stack uses:

- ML-DSA-65 (NIST FIPS-204) for post-quantum agent identity binding
- HKDF (RFC 5869) to derive the holder's identity key from the holder seed
- Standard NIST-approved AEAD ciphers under random per-cell keys, wrapped by a
  versioned key-encryption key
- A public append-only audit log for receipts (the reference deployment
  anchors it on COTI V2 mainnet)

If a vulnerability is in the protocol specification itself rather than a
specific implementation, please indicate that in your report. Specification
issues are handled through the same private channels above and are carried
into the next revision of the Internet-Draft
`draft-saihm-memory-protocol` (current revision `-03`).

## Thank you

Responsible disclosure protects the broader agent ecosystem. We appreciate
the time and care of security researchers who report issues to us privately.
