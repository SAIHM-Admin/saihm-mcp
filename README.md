# SAIHM MCP Server

**Sovereign, encrypted, sharable, persistent memory protocol for AI agents.**

[![npm version](https://img.shields.io/npm/v/@saihm/mcp-server)](https://www.npmjs.com/package/@saihm/mcp-server) · Apache-2.0 · COTI V2 mainnet

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12898/badge)](https://www.bestpractices.dev/projects/12898)

> **Evaluate it offline first:** runnable demos across every major model, no account needed — **[See it run](#see-it-run)**.

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

## Tool reference

| Tool | Title | Behavior |
|---|---|---|
| `saihm_remember` | Remember | writes a new memory cell |
| `saihm_recall` | Recall | read-only; safe to repeat |
| `saihm_forget` | Forget (GDPR erasure) | **destructive** — irreversible erasure |
| `saihm_status` | Status | read-only |
| `saihm_share` | Share | writes a sharing contract |
| `saihm_revoke_share` | Revoke share | withdraws a grant |
| `saihm_governance_propose` | Propose (governance) | opens a proposal |
| `saihm_governance_vote` | Vote (governance) | casts a vote |

Each tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) and a human-readable `title`, so MCP hosts can gate confirmations and agents can select the right tool at reasoning time.

## Companion package

This package speaks MCP. For production **client-side** cryptography —
post-quantum sealing, authenticated sharing, and provable erasure performed on
your own machine so the operator stays blind — pair it with
[`@saihm/client-pro`](https://www.npmjs.com/package/@saihm/client-pro).

## See it run

Runnable, one-command demos ground a memory you own in every major model — Claude, GPT, DeepSeek, Qwen, Kimi, GLM — then prove you can erase it, alongside drop-in adapters for LangChain, LlamaIndex, CrewAI, AutoGen, and LangGraph. Each runs offline in about a minute; no account needed.

- **Live demos:** <https://citw2.github.io/saihm-demos/>
- **`demo-claude-code`** wires this server into Claude Code and Cursor as an MCP server.

**Measured — up to ~86% fewer context tokens.** Most agents re-send their entire transcript every turn, so context spend grows ~O(N²) over a session; recalling a bounded set of memory cells instead cut input tokens by **62.8%–85.9%** across a realistic multi-session coding task. The benchmark is open, offline, and deterministic — reproduce the number rather than trust it:

```bash
git clone https://github.com/citw2/saihm-token-benchmark
cd saihm-token-benchmark && npm install && node benchmark.mjs
```

## Install

```bash
npm install @saihm/mcp-server
# or run directly without install:
npx @saihm/mcp-server
```

## Configure

The server needs two env vars:

```
SAIHM_ENDPOINT_URL=https://operator.example.com/mcp
SAIHM_AUTH_HEADER=Bearer <token-issued-by-your-operator>
```

> **Don't have an endpoint and token yet?** They're issued by a SAIHM *operator*.
> The quickest path is a **free trial** — sign in with GitHub, no card, for
> testing on real infrastructure (see [Free trial](#free-trial-sign-in-with-github)
> below). Otherwise **join the hosted SAIHM service** at
> <https://saihm.coti.global> (managed, non-custodial storage — see
> [Join SAIHM](#prefer-not-to-run-storage-yourself-join-saihm) below), or
> **run your own operator endpoint**. Until one is configured, the tools have
> nowhere to reach and will return an error.

- **`SAIHM_ENDPOINT_URL`** — the SAIHM operator endpoint. Operators publish
  their endpoint URLs at <https://saihm.coti.global>.
- **`SAIHM_AUTH_HEADER`** — the `Authorization` header value the operator
  expects (typically a `Bearer <token>` issued to you after key-bound
  enrolment). The server is authentication-agnostic and **never transmits
  raw private keys**; the operator's enrolment flow keeps your
  signing key on your machine.

Place these in a `.env` file alongside the server (the `.gitignore` excludes
all `.env*` files from any future repo).

## Free trial (sign in with GitHub)

Want to test SAIHM on real infrastructure before you pay? Start a **free trial**
— for testing purposes, no card — by proving you're a unique person once through
a GitHub device sign-in. It runs through the non-custodial
[`@saihm/mcp-server-pro`](https://www.npmjs.com/package/@saihm/mcp-server-pro)
client, which seals cells on your own machine so the operator stays blind:

```bash
SAIHM_TIER=FREE \
  npx -y @saihm/mcp-server-pro free-join
```

It prints a short code and a link: open <https://github.com/login/device> in
your browser and enter the code. The sign-in stays in your browser — this
client never sees or holds your GitHub token; it is exchanged server-side and
kept ephemeral. When `free-join` returns, start the server normally (drop
`free-join`) and it self-onboards on the free trial. **No card, and nothing to
cancel** — it's a fixed, one-time allowance, not an auto-renewing subscription.

Ready for production? Upgrade in place to a **monthly** plan — same signing key,
same memories, no re-onboarding.

## Wire into Claude Code

```jsonc
{
  "mcpServers": {
    "saihm": {
      "command": "npx",
      "args": ["@saihm/mcp-server"],
      "env": {
        "SAIHM_ENDPOINT_URL": "https://operator.example.com/mcp",
        "SAIHM_AUTH_HEADER": "Bearer <token>"
      }
    }
  }
}
```

## What gets persisted, where

The server itself persists nothing. The operator endpoint runs the
full protocol stack: cells are encrypted under a per-cell DEK, sealed by a
per-agent KEK, persisted to the operator's configured durable storage, and
audited on COTI V2 mainnet. See the operator's documentation for tier details,
and **[Storage is the operator's responsibility (by design)](#storage-is-the-operators-responsibility-by-design)**
below.

## Storage is the operator's responsibility (by design)

> **For operators — read this first.** SAIHM does **not** hard-wire your
> durable storage to any single provider, and it does **not** silently
> provision storage for you. **Choosing and configuring where cells are
> persisted is your job, on purpose.** This is a deliberate design choice for
> operator convenience and data sovereignty — not a missing feature. If
> memory writes fail with a storage error, it almost always means the backend
> has not been configured yet.

Why it works this way:

- **Provider sovereignty.** You decide where your tenants' encrypted cells
  live. The protocol never locks you to one vendor or one network.
- **Local-first, then deep-archive.** A typical operator routes writes to a
  **local IPFS (Kubo) node first** — fast, authoritative, and under your own
  control — and then **asynchronously to a Filecoin deep-archive** provider
  such as Pinata, Synapse, or Lighthouse. The same content addressing spans
  both tiers.
- **Your memory and your tenants' take the same path.** Whatever backend you
  configure serves both the operator's own memory and every tenant's — there
  is no separate hidden sink hard-coded to one provider.

What you configure (your operator deployment guide lists the exact settings):

- a reachable IPFS / Kubo endpoint (a local node is recommended) for the
  authoritative low-latency tier, and
- credentials for at least one Filecoin / IPFS pinning provider for durable
  deep-archive.

If neither is configured, the endpoint has nowhere durable to put cells and
will **reject writes rather than lose data**. That refusal is intentional.

### Prefer not to run storage yourself? Join SAIHM.

You have two paths, and either is fine:

1. **Run your own operator endpoint** and configure the storage backend as
   described above — full sovereignty, your infrastructure.
2. **Join the hosted SAIHM operator** and let it provide durable storage for
   you. It runs **blind / non-custodial**: paired with client-side sealing
   (see [`@saihm/client-pro`](https://www.npmjs.com/package/@saihm/client-pro)
   and [`@saihm/mcp-server-pro`](https://www.npmjs.com/package/@saihm/mcp-server-pro)),
   it only ever stores **ciphertext** and never holds your keys — so you get
   managed storage without giving up custody. Enrol via **Join SAIHM** at
   <https://saihm.coti.global> (a paid hosted service).

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
- **Receipt emission** — 6 sub-kinds (`report_generated` / `report_rejected` / `template_registered` / `template_superseded` / `erasure_chain_broken` / `rate_limit_exceeded`) under a stable, domain-separated receipt namespace.
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

For distribution integrity, each release carries the npm registry signature; verify with `npm audit signatures` (and inspect `npm view @saihm/mcp-server --json | jq .dist`).

## Dependencies

The published npm package has a minimal runtime surface:

| Dependency | License | Role |
|---|---|---|
| Node.js (≥ 20.x) | MIT | Runtime |
| `@modelcontextprotocol/sdk` | MIT | MCP SDK; binds the eight-tool surface |
| TypeScript | Apache-2.0 | Build-time only |
| `tsx` | MIT | TypeScript runner for tests + CLI |

No copyleft, no proprietary dependencies. Cryptographic primitives at the
operator-endpoint layer (ML-DSA-65 / Ed25519 / key derivation) are not bundled into
this MCP server; operators implementing the protocol stack are recommended
to use `@noble/post-quantum` and `@noble/curves` (MIT) rather than rolling
custom code.

## Achievements

- **OpenSSF Best Practices Passing badge** — project 12898, 100% Passing
  criteria (2026-05-19). <https://www.bestpractices.dev/projects/12898>
- **IETF Independent Submission Stream** — `draft-saihm-memory-protocol-01`
  (2026-05-27) is *In ISE Review* in the Independent Submission Stream. It is
  **not an Internet Standard, is not endorsed by the IETF, and has no formal
  standing in the IETF standards process.**
  <https://datatracker.ietf.org/doc/draft-saihm-memory-protocol/>
- **npm registry** — `@saihm/mcp-server@0.3.4` published (2026-06-22) adds a
  conspicuous "Storage is the operator's responsibility (by design)" section —
  documenting BYO storage and the Join-SAIHM hosted, non-custodial option.
  `0.3.3` (2026-06-22) was
  a documentation release that states the Independent-Submission status
  precisely (no implied IETF endorsement) and cross-references the
  companion package `@saihm/client-pro`. 0.3.2 (2026-06-22) corrected
  the documented operator-endpoint path to `/mcp` (the
  canonical `SAIHM_ENDPOINT_URL` path) across the README and client
  comments. 0.3.1 (2026-05-28) was a metadata patch that sources the
  MCP `serverInfo.version` from `package.json` (was hardcoded
  `"0.1.0"` from 0.1.0 through 0.3.0).
  0.3.0 (also 2026-05-28) aligned the `saihm_status` response shape
  with `draft-saihm-memory-protocol-01` §3.4 (full eight-field
  schema: `prs`, `bfsi`, `bfsi_window_start_ts`, `bfsi_R`,
  `bfsi_M`, `shards`, `contracts`, `governance`). 0.2.0 (also
  2026-05-28) aligned the cell-tuple response shape with §2.1;
  0.1.3 was the OpenSSF Best Practices Passing badge release
  (2026-05-19).
- **MCP Registry / Glama** — server listed for discovery (2026-05-16).

## Roadmap

A 12-month roadmap is maintained in the project's
[AAIF proposal](https://github.com/SAIHM-Admin/saihm-mcp/) and will be
mirrored to <https://saihm.coti.global/roadmap> with the v0.2.x release.
Near-term tracks:

- **2026-Q2** — Operator-endpoint reference implementation; OpenSSF Silver
  pursuit (governance, code-of-conduct, DCO, signed releases, coverage
  tooling, assurance case).
- **2026-Q3** — First 2–3 external organization deployments; formal AAIF
  Project Proposal submission when adoption blockers clear.
- **2026-Q4** — NIST AI RMF crosswalk public review; EU AI Act
  compliance-checklist generator. OpenSSF Silver award (target).
- **2027-Q1** — Independent-stream (ISE) RFC publication, subject to
  RFC-Editor review — not an IETF-consensus standard; v1.0 reference
  implementation.

## License

Apache-2.0 — see [`LICENSE`](./LICENSE).

## Project

- Site: <https://saihm.coti.global>
- Issue tracker: <https://github.com/SAIHM-Admin/saihm-mcp/issues>
- Security: see [`SECURITY.md`](./SECURITY.md) for private vulnerability
  disclosure
- Contributing: see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
  [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- Governance: see [`GOVERNANCE.md`](./GOVERNANCE.md)
- Changelog: see [`CHANGELOG.md`](./CHANGELOG.md)
