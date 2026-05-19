# Architecture

This document describes the high-level architecture of
`@saihm/mcp-server` and its place in the SAIHM (Sovereign AI
Horizontal Memory) protocol stack. It is intended for contributors,
reviewers, and security auditors who need a mental model of *where
things live* before reading the code.

## Project scope, restated

The repository at `SAIHM-Admin/saihm-mcp` contains the **reference
MCP-server implementation** for the SAIHM protocol. It does **not**
contain:

- The protocol specification itself (progressed via
  [IETF ISE `draft-saihm-memory-protocol`](https://datatracker.ietf.org/doc/draft-saihm-memory-protocol/)).
- The operator-endpoint runtime (the component that actually executes
  the protocol — key derivation, cell encryption, blockchain
  anchoring, audit-receipt emission). Operators run this separately.
- Any cryptographic keys, persistent storage, or network state. The
  MCP server holds none of these.

The MCP server is a **thin forwarding shim**: it exposes eight MCP
tools, validates inputs, and forwards JSON-RPC calls to whatever
operator endpoint the user has configured via environment variables.

## System diagram

```
┌─────────────────────────────┐
│  MCP-capable AI agent       │
│  (Claude Code, Claude       │
│   Desktop, custom agent)    │
└──────────────┬──────────────┘
               │  MCP / stdio  (JSON-RPC 2.0)
               ▼
┌─────────────────────────────┐
│  @saihm/mcp-server          │
│  (this repository)          │
│                             │
│  - 8 tool definitions       │
│  - URL + auth validation    │
│  - 30s abort window         │
│  - 16 MB Content-Length cap │
│  - No persistence, no crypto│
└──────────────┬──────────────┘
               │  HTTPS  (operator-issued Bearer token)
               ▼
┌─────────────────────────────┐
│  SAIHM operator endpoint    │
│  (external; per operator)   │
│                             │
│  - ML-DSA-65 identity bind  │
│  - HKDF per-cell DEK derive │
│  - AEAD cell encryption     │
│  - DEK destruction (Art.17) │
│  - Audit-receipt emission   │
└──────────────┬──────────────┘
               │  Persistence + anchor
               ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│  Filecoin / IPFS            │  │  COTI V2 mainnet (chainId    │
│  (cell ciphertext storage)  │  │   2632500) — audit anchor    │
└─────────────────────────────┘  └─────────────────────────────┘
```

The bold arrow direction is **agent → MCP server → operator → chain**.
There is **no** path from chain back to agent inside this package —
audit verification is consumer-side and out of scope for the MCP
server. (The operator can do its own verification; agents that need to
verify receipts against COTI V2 should consume the returned
`cellId` / `auditCellId` and use a separate SAIHM mainnet read path.)

## Components

### `saihm_mcp_server.ts` — MCP tool surface

Exposes the eight protocol tools via the `@modelcontextprotocol/sdk`
stdio server. Each tool definition specifies:

- An input schema (JSON Schema via zod).
- A handler that constructs the JSON-RPC request and calls
  `SaihmRuntimeClient` (see below).
- A response that returns the operator's reply verbatim — no
  transformation, no caching, no enrichment.

The eight tools are a **protocol invariant** (the "eight-tool MCP
cap"; see `CONTRIBUTING.md` and `GOVERNANCE.md`):

| Tool | Purpose |
|---|---|
| `saihm_remember` | Encrypted-cell write |
| `saihm_recall` | Encrypted-cell read (decrypted on the operator side) |
| `saihm_forget` | GDPR Art.17 cryptographic erasure (DEK destroy + tombstone + CID blacklist) |
| `saihm_status` | PRS / BFSI / storage / staking / sharing / PHI dashboard |
| `saihm_share` | Issue a sharing contract (temporary / permanent / syndicate) |
| `saihm_revoke_share` | Revoke a sharing contract |
| `saihm_governance_propose` | Submit a gSAIHM governance proposal |
| `saihm_governance_vote` | Vote on a gSAIHM governance proposal |

Adding a ninth tool, removing a tool, or renaming a tool requires the
breaking-change process in `GOVERNANCE.md`. The eight-tool cap exists
to make SAIHM's tool surface predictable in any MCP host's tool list
and to keep the protocol surface auditable.

### `saihm_runtime_client.ts` — operator-endpoint client

The thin HTTPS client that talks to the operator endpoint:

- **URL validation** at construction. The endpoint URL must be HTTPS,
  with the exceptions of `127.0.0.1` and `localhost` (for local
  development). Plain `http://` to any other host is rejected.
- **Authorization header forwarding.** The `SAIHM_AUTH_HEADER` env var
  (typically `Bearer <token>`) is included on every request. The
  header value is **never** echoed in thrown error messages.
- **Per-call abort window.** Each request runs under an
  `AbortController` that aborts after 30 seconds. A hung operator
  endpoint cannot starve the MCP server.
- **Response-size cap.** Responses whose `Content-Length` exceeds
  16 MB are rejected before deserialization.
- **No retries.** Failed calls bubble up to the agent immediately;
  retry logic is the agent's responsibility (and avoids accidental
  duplicate `saihm_forget` requests).

The client does **not** read from disk, does **not** maintain any
session or cookie state, and does **not** transform operator
responses.

### `types.ts` — protocol type definitions

TypeScript types that describe the JSON shapes the operator endpoint
is expected to accept and return. These mirror the
`draft-saihm-memory-protocol` schema. Type checking happens
client-side via `tsc --noEmit` (strict mode).

### `reporting/` — sub-exported reporting library

A bundled sub-export at `@saihm/mcp-server/reporting` provides
primitives for operators who need to compose bespoke compliance
reports on top of the eight MCP calls. The reporting library is **not**
part of the MCP server's tool surface — it is a separate library
import, not a ninth tool, and is intended for operator-side report
generation:

- `FIELD_UNIVERSE` — 280 fields (262 framework + 18 ledger) that
  bespoke templates may project from.
- Template schema (zod validator + universe-membership + scope/cap
  enforcement).
- Authorization-path validators (4 paths: `public` / `self` /
  `operator-self` / `operator-for-downstream`).
- Receipt-emission builders (6 sub-kinds: `report_generated` /
  `report_rejected` / `template_registered` / `template_superseded` /
  `erasure_chain_broken` / `rate_limit_exceeded`).
- Framework smoke (`registry-attestation` for end-to-end plumbing
  verification).

See `README.md` "Reporting engine" section for usage.

### `tests/integration.test.ts` — integration test

Self-contained integration test: spins up an in-process HTTP mock
server on `127.0.0.1`, configures the runtime client to point at it,
and exercises all eight MCP tools plus the reporting library. CI runs
this on every push and pull request on Node 20.x and 22.x.

## Data envelope (operator-side, for context)

The MCP server itself does not see plaintext cell content beyond what
the agent provides — encryption happens at the operator. For
auditability the architecture document captures the protocol-level
envelope here:

```
Cell {
  cellId            — 32-byte hex (SHA-256 of canonical content)
  holderIdentity    — ML-DSA-65 public key hash
  kekVersion        — KEK rotation generation
  epoch             — block-anchored time
  tier              — "filecoin" | "ipfs"
  receiptId         — public-chain audit-receipt key
  ciphertext        — AEAD output, DEK derived via HKDF from holder
                      identity + cell-specific salt + KEK
  metadata          — small struct (size, MIME hint, label tags)
}
```

`saihm_forget` removes the DEK from the operator's keystore,
publishes a tombstone audit receipt, and blacklists the CID. The
ciphertext remains on the storage tier (Filecoin is intentionally
unmodifiable to preserve auditability), but is no longer decryptable
— this is the GDPR Article 17 "cryptographic erasure" pattern.

See [GDPR Art.17 crosswalk](https://saihm.coti.global/standards/gdpr-art-17-crosswalk/)
for the regulator-mapping detail.

## Trust model

- **The agent trusts the user's choice of operator endpoint.** The
  MCP server does not vouch for any particular operator. Operator
  selection (and the trust judgement that comes with it) is the user's
  responsibility.
- **The agent trusts the operator's response verbatim.** Cell IDs,
  audit anchors, and report receipts returned from the operator are
  surfaced to the agent without modification. Verifying receipts
  against COTI V2 mainnet anchors is out of scope for the MCP server
  — that's a consumer-side responsibility.
- **The MCP server does not trust the operator with secrets in
  transit.** It refuses plain HTTP (except for localhost dev) so that
  the `Authorization` header can never be sniffed.
- **The operator does not see the user's private key.** The protocol
  is wallet-bound; the user holds Wallet C, and operator-issued
  Bearer tokens reflect a prior key-bound enrolment. Rotating the
  Bearer token rotates the operator-visible auth surface without
  touching the user's wallet key.

## Threat model summary

| Threat | Mitigation |
|---|---|
| Authorization-header leak in transit | HTTPS-only enforcement (except localhost) |
| Authorization-header leak via error | Header value never included in `Error.message` |
| Operator endpoint compromised | User can rotate to a different operator; cells encrypted under user-bound DEKs cannot be decrypted by a new operator without user re-enrolment |
| Hung operator (DoS to MCP server) | 30-second per-call abort |
| Oversized response (DoS / memory exhaustion) | 16 MB Content-Length cap |
| Crypto algorithm break | `kekVersion` rotation + `crypto_algorithm_agility` (see protocol draft) |
| Supply-chain attack on `@saihm/mcp-server` | npm sigstore provenance attestation; `npm audit signatures` verifies |
| Missing test coverage hides regression | CI gate (Node 20.x + 22.x integration test) |
| Quiet protocol drift | Tool surface is a protocol invariant; ninth tool requires breaking-change process per `GOVERNANCE.md` |

Detailed hardening documentation: see [`HARDENING.md`](./HARDENING.md).

## Build, test, release flow

```
   git push origin main
         │
         ▼
 GitHub Actions CI (.github/workflows/ci.yml)
         │
         ├─ npm ci
         ├─ npm run typecheck   (tsc --noEmit)
         ├─ npm run build       (tsc -p . + chmod)
         ├─ npm test            (tsx tests/integration.test.ts)
         │
         ▼
   Green on Node 20.x AND 22.x

   ─── release ───
   git tag -s vX.Y.Z (signed; GPG-key configured locally)
   git push origin vX.Y.Z
   npm publish --provenance   (sigstore attestation)
```

## Anti-overreach principles

The architecture intentionally **does not** include:

- **An operator-endpoint reference implementation in this repo.**
  That belongs in a separate repository or in the protocol-draft
  reference appendix. Mixing the two would make the MCP server's
  attack surface larger than it needs to be.
- **A "memory store" inside the MCP server.** Memory persistence is
  the operator's job; the MCP server has no place caching plaintext.
- **Vector-database semantics.** SAIHM is orthogonal to retrieval —
  cells can be indexed by any retrieval method, but indexing isn't a
  protocol concern.
- **Agent runtime semantics.** Covered by MCP, Goose, and agent
  frameworks. The MCP server's only job is to expose the eight tools.

## References

- Protocol specification: <https://datatracker.ietf.org/doc/draft-saihm-memory-protocol/>
- Standards crosswalks: <https://saihm.coti.global/standards/>
- COTI V2 mainnet (audit anchor): <https://mainnet.cotiscan.io>
- MCP specification: <https://modelcontextprotocol.io/>
- NIST FIPS-204 (ML-DSA): <https://csrc.nist.gov/pubs/fips/204/final>
- RFC 5869 (HKDF): <https://datatracker.ietf.org/doc/html/rfc5869>
- RFC 8032 (Ed25519): <https://datatracker.ietf.org/doc/html/rfc8032>
