# SAIHM MCP Server

**Sovereign, encrypted, sharable, persistent memory protocol for AI agents.**

`v0.1.2` · Apache-2.0 · COTI V2 mainnet

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12898/badge)](https://www.bestpractices.dev/projects/12898)

## What this is

A [Model Context Protocol](https://modelcontextprotocol.io/) server
that exposes eight tools any MCP-capable AI agent (Claude Code, Claude Desktop,
custom agents) can call to gain a persistent, encrypted memory layer the
**user** owns:

- `saihm_remember` — store an encrypted memory cell
- `saihm_recall` — retrieve and decrypt your memories
- `saihm_forget` — true cryptographic erasure (GDPR Art. 17)
- `saihm_status` — your protocol-runtime stats and storage tier dashboard
- `saihm_share` / `saihm_revoke_share` — selectively share a memory with another agent or user
- `saihm_governance_propose` / `saihm_governance_vote` — protocol governance via gSAIHM

Each tool forwards to a SAIHM operator endpoint that runs the full protocol
stack on COTI V2 mainnet. The server itself holds no crypto, no storage, and
no protocol runtime — those live behind the operator endpoint.

## Install

```bash
npm install @saihm/mcp-server
# or run directly without install:
npx @saihm/mcp-server
```

## Configure

The server needs two env vars:

```
SAIHM_ENDPOINT_URL=https://operator.example.com/saihm/v1
SAIHM_AUTH_HEADER=Bearer <token-issued-by-your-operator>
```

- **`SAIHM_ENDPOINT_URL`** — the SAIHM operator endpoint. Operators publish
  their endpoint URLs at <https://saihm.coti.global>.
- **`SAIHM_AUTH_HEADER`** — the `Authorization` header value the operator
  expects (typically a `Bearer <token>` issued to you after key-bound
  enrolment). The server is authentication-agnostic and **never transmits
  raw private keys**; the operator's enrolment flow keeps your
  Wallet C key on your machine.

Place these in a `.env` file alongside the server (the `.gitignore` excludes
all `.env*` files from any future repo).

## Wire into Claude Code

```jsonc
{
  "mcpServers": {
    "saihm": {
      "command": "npx",
      "args": ["@saihm/mcp-server"],
      "env": {
        "SAIHM_ENDPOINT_URL": "https://operator.example.com/saihm/v1",
        "SAIHM_AUTH_HEADER": "Bearer <token>"
      }
    }
  }
}
```

## What gets persisted, where

The server itself persists nothing. The operator endpoint runs the
full protocol stack: cells are encrypted under a per-cell DEK, sealed by a
per-agent KEK, persisted to Filecoin, and audited on COTI V2 mainnet. See the
operator's documentation for tier details.

## Reporting engine

A reporting library is bundled as a sub-export, so operators can compose the
eight MCP calls into bespoke reports with their own tooling (no extra
dependency, no extra service):

```ts
import {
  validateBespokeTemplate,
  registerTemplate,
  generateRegistryAttestation,
  StubPublicRegistry,
  InMemoryReportingRuntime,
  GDPR_ART15_FIELDS,
  REGISTRY_ATTESTATION_FIELDS,
  type BespokeReportTemplate,
} from "@saihm/mcp-server/reporting";
```

### What it covers

- **Field universe** (`FIELD_UNIVERSE`) — 280 fields (262 framework + 18 ledger). Templates that project a field outside this set are rejected at validation.
- **Bespoke template schema** — zod validator + universe-membership check + scope/cap enforcement.
- **Authorization path validators** — 4 paths: `public` / `self` / `operator-self` / `operator-for-downstream`.
- **Receipt emission** — 6 sub-kinds (`report_generated` / `report_rejected` / `template_registered` / `template_superseded` / `erasure_chain_broken` / `rate_limit_exceeded`) under a stable HKDF receipt domain.
- **Framework smoke** — `registry-attestation` (public auth) for end-to-end plumbing verification.

### Constraints

- Every `fieldProjections[]` entry MUST be in `FIELD_UNIVERSE`.
- `scope.customerIdHashes` 64-hex; max 10,000 per template.
- `scope.timeRange` window ≤ 366 days.
- `fieldProjections` length 1–200.
- `framework` ∈ {`gdpr-art-15`, `gdpr-art-17`, `soc2-t1`, `soc2-t2`, `iso27001`, `aml`, `audit-export`, `billing-history`, `registry-attestation`}.
- `format` ∈ {`pdfa3`, `json`, `csv`}.

### Worked example

```ts
const template: BespokeReportTemplate = {
  templateId: "acme-q1-summary",
  templateVersion: 1,
  operatorIdHash: "ab".repeat(32),
  scope: {
    customerIdHashes: ["cd".repeat(32)],
    timeRange: { from: "2026-01-01T00:00:00Z", to: "2026-04-01T00:00:00Z" },
  },
  framework: "gdpr-art-15",
  fieldProjections: [GDPR_ART15_FIELDS[0], GDPR_ART15_FIELDS[1]],
  format: "pdfa3",
};
const v = validateBespokeTemplate(template);
if (!v.valid) throw new Error(v.errors.join(", "));

const runtime = new InMemoryReportingRuntime(); // replace with your audit-ledger runtime
const reg = await registerTemplate(template, runtime);
if (reg.ok) console.log("registered:", reg.templateHash);
```

In production, replace `InMemoryReportingRuntime` with a runtime that persists audit payloads to your operator's audit ledger. Operators who inject signature verifiers should use pure-crypto libraries (`@noble/curves` for EIP-712, `@noble/post-quantum` for FIPS 204 ML-DSA) — the package itself bundles no EVM tooling.

## Security

The server enforces a small set of defaults so misconfiguration cannot leak the `Authorization` header in transit:

- **HTTPS-only endpoints.** `SAIHM_ENDPOINT_URL` must use `https://`. Plain `http://` is rejected at construction time, except for `127.0.0.1` and `localhost` (so a local operator endpoint works during development).
- **Per-call abort window.** Each request runs under an `AbortController` that aborts after 30s, preventing a hung endpoint from starving the MCP server.
- **Response-size cap.** Responses whose `Content-Length` exceeds 16 MB are rejected before deserialisation.
- **No header echo.** `Authorization` is never included in thrown error messages or stdout.
- **No filesystem reads.** The package never reads from disk; configuration flows entirely through env vars.
- **Zero EVM tooling.** No `ethers`, no `eth_*`, no Solidity. If operators inject signature verifiers via `AuthVerifiers`, they should use pure-crypto libraries (`@noble/curves`, `@noble/post-quantum`).

Trust model: this client trusts whatever endpoint the operator configures. Cell IDs, audit anchors, and report receipts returned from that endpoint are surfaced to the agent verbatim — operators are the authority for content shown via `saihm_recall`. Verifying receipts against COTI V2 mainnet anchors is out of scope for this server; consume the `cellId` and `auditCellId` fields and verify against your own SAIHM mainnet read path.

For distribution integrity, the SAIHM publisher signs releases via npm sigstore provenance; verify with `npm view @saihm/mcp-server --json | jq .dist` and `npm audit signatures`.

## License

Apache-2.0 — see [`LICENSE`](./LICENSE).

## Project

- Site: <https://saihm.coti.global>
- Issue tracker: see homepage for current contact channel.
