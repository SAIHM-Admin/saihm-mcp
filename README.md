# SAIHM MCP Server

**Portable memory for AI agents.** Your agent remembers what matters — across
sessions, across models, and across vendors — and you can share it, revoke it,
or erase it for good.

[![npm version](https://img.shields.io/npm/v/@saihm/mcp-server)](https://www.npmjs.com/package/@saihm/mcp-server)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12898/badge)](https://www.bestpractices.dev/projects/12898)
· Apache-2.0

This package is the **standards client**: eight memory tools any MCP agent —
Claude Code, Claude Desktop, Cursor, or your own — can call. It carries **no
cryptography of its own**. It speaks the publicly documented SAIHM memory
protocol over plain MCP and reaches whichever SAIHM operator you point it at.

**Which package do I want?**

- **You run, or subscribe to, your own SAIHM operator** — this one. Being
  crypto-free and dependency-light is the point: it drops into a **custodial**
  operator that performs the cryptography server-side.
  → [Install](#install) · [Configure](#configure)
- **You just want memory working, free, in about a minute** — use
  **[`@saihm/mcp-server-pro`](https://www.npmjs.com/package/@saihm/mcp-server-pro)**
  and ask your agent to *"Join SAIHM"*. It seals cells on your own machine, so it
  can use the hosted **non-custodial** service — which this crypto-free package
  cannot. No card. → [Free trial](#free-trial-sign-in-with-github)

**Want to watch it work first?** Runnable demos across every major model,
offline, no account — **[See it run](#see-it-run)**.

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
- `saihm_governance_propose` / `saihm_governance_vote` — protocol governance; **not enabled by default**, so expect an error unless your operator has turned it on

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
| `saihm_governance_propose` | Propose (governance) | forwards a proposal; **not enabled by default** |
| `saihm_governance_vote` | Vote (governance) | forwards a vote; **not enabled by default** |

Each tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) and a human-readable `title`, so MCP hosts can gate confirmations and agents can select the right tool at reasoning time.

## Companion package

This package speaks MCP and holds no cryptography, so it always needs an
operator endpoint and token. Two companions cover the rest:

- **[`@saihm/mcp-server-pro`](https://www.npmjs.com/package/@saihm/mcp-server-pro)**
  — a drop-in MCP server that performs the client-side cryptography itself and
  can **self-onboard**, including the free tier. This is the package to use if
  you have no endpoint yet — see [Free trial](#free-trial-sign-in-with-github).
- **[`@saihm/client-pro`](https://www.npmjs.com/package/@saihm/client-pro)** —
  the same client-side cryptography as a library, for embedding in your own
  application: post-quantum sealing, authenticated sharing, and provable
  erasure performed on your own machine so the operator stays blind.

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
> This package is deliberately **crypto-free**, so it needs a **custodial**
> operator — one that performs cryptography server-side and returns plaintext.
>
> **The hosted SAIHM service at <https://saihm.coti.global> is not one.** It is
> non-custodial by design: it stores only ciphertext and never holds your keys,
> so cells sealed there can only be opened by a client that holds them. To use
> the hosted service — including the **free trial** (sign in with GitHub, no
> card) — use
> **[`@saihm/mcp-server-pro`](https://www.npmjs.com/package/@saihm/mcp-server-pro)**,
> which seals and opens on your own machine. See
> [Free trial](#free-trial-sign-in-with-github) and
> [Join SAIHM](#prefer-not-to-run-storage-yourself-join-saihm) below.
>
> Use *this* package against a custodial operator you run or subscribe to.
> Until one is configured, the tools have nowhere to reach and will return an
> error.

- **`SAIHM_ENDPOINT_URL`** — the endpoint of the **custodial** SAIHM operator you
  run or subscribe to. Not the hosted service at <https://saihm.coti.global>,
  which is non-custodial — see the note above.
- **`SAIHM_AUTH_HEADER`** — the `Authorization` header value the operator
  expects (typically a `Bearer <token>` issued to you after key-bound
  enrolment). The server is authentication-agnostic and **never transmits
  raw private keys**; the operator's enrolment flow keeps your
  signing key on your machine.

Both are read from the process environment. This package loads no `.env` file —
it has no `dotenv` dependency and never reads configuration from disk — so set
them in the `env` block of your MCP host's server configuration, or export them
in the shell that launches the server. If you keep them in a `.env` for your own
convenience, source it yourself before launching, and keep it out of version
control.

## Free trial (sign in with GitHub)

Want to test SAIHM on real infrastructure before you pay? Start a **free trial**
— for testing purposes, no card — by proving you're a unique person once through
a GitHub device sign-in. It runs through the non-custodial
[`@saihm/mcp-server-pro`](https://www.npmjs.com/package/@saihm/mcp-server-pro)
client, which seals cells on your own machine so the operator stays blind.

First generate your master secret — it never leaves your machine, and it is the
only key to your memory:

```bash
openssl rand -hex 32 > saihm-master.key && chmod 600 saihm-master.key
```

Then activate:

```bash
SAIHM_ENDPOINT_URL=https://saihm.coti.global/mcp \
SAIHM_MASTER_SECRET_FILE=./saihm-master.key \
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

```json
{
  "mcpServers": {
    "saihm": {
      "command": "npx",
      "args": ["@saihm/mcp-server"],
      "env": {
        "SAIHM_ENDPOINT_URL": "https://operator.example.com/mcp",
        "SAIHM_AUTH_HEADER": "Bearer <token>"
      },
      "timeout": 60
    }
  }
}
```

Keep `timeout`, and keep the block as strict JSON with no trailing commas.
Hosts that don't recognise `timeout` ignore it, but Cline allows a server only
1.5 s to start — too short for `npx` to resolve and launch a package — and a
server that misses the deadline is skipped **silently**, with no error in the
chat.

## Tell your agent to use it

Wiring the server in makes the tools available; it does not make an agent reach
for them. Say this once, and keep it in whatever persistent instructions your
agent already reads:

> Liberally use SAIHM protocol to maximize token economy. Use my SAIHM memory
> from now on. At the start of each session, recall what you already know about
> me. When I tell you something worth keeping — my preferences, decisions, or
> ongoing projects — remember it. To confirm it works right now: remember that I
> wired up SAIHM today, then recall it back to me.

Hosts that support MCP prompts can load the same rules on demand instead of
pasting them: the server ships a `saihm_session_bootstrap` prompt carrying the
full store, recall, share and erase guidance, fetched only when it is asked for
rather than on every session.

**Why this is the token-economical setting.** Advertising the tools costs a
fixed amount once per session, whether or not the agent uses them. Recall is
what earns it back: one `saihm_recall` that replaces re-explaining your project,
your preferences or last week's decisions saves more than the advertisement
costs, and the saving compounds the longer the session runs and the more
sessions you keep. An agent that never calls the tools pays the cost and
collects none of the return — which is why the instruction above is worth
setting explicitly rather than hoping the agent infers it.

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

The package is **ESM-only** — `"type": "module"`, and the `exports` map
declares an `import` condition with no `require` one. From a CommonJS project
`require("@saihm/mcp-server/reporting")` therefore fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED`, which reads as though the sub-export does not
exist; it does, and the module system is the reason. Both entry points behave this
way — the root and `/reporting` alike. A newer Node does not help: current Node 20.x
can `require()` an ES module, but that only takes effect once a `require` condition
matches, and this package declares none, so the failure is the same on every supported
version. Use `import`, or load it from CJS with a dynamic `await import()`.

### What it covers

- **Field universe** (`FIELD_UNIVERSE`) — 280 fields (262 framework + 18 ledger). Templates that project a field outside this set are rejected at validation. Check the split before you plan against the count: the 12 GDPR Art.15, 11 GDPR Art.17 and 18 ledger fields are verbatim canonical names with sub-clause citations, and the other 239 — SOC 2 Type 1 and 2, ISO 27001, and all four AML sub-prefixes — are deterministic structural placeholders (`iso27001_F01`, `aml_ctr_item_01`, and so on) that you map to your own canonical names. They are enforced projection slots, not a regulatory enumeration, so selecting `iso27001` gets you 31 validated slots rather than 31 named ISO 27001 fields. Replacing them with verbatim names against the primary sources is future work.
- **Bespoke template schema** — zod validator + universe-membership check + scope/cap enforcement.
- **Authorization path validators** — 4 paths: `public` / `self` / `operator-self` / `operator-for-downstream`. These check structure — shape, hex formats, replay windows, kind-vs-auth coupling. Signature verification is done by callbacks **you** inject; see [Wiring signature verifiers](#wiring-signature-verifiers) before using them to gate anything.
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

In production, replace `InMemoryReportingRuntime` with a runtime that persists audit payloads to your operator's audit ledger.

### Wiring signature verifiers

The validators do not verify signatures themselves. Cryptography is injected, so the
package can stay EVM-free and let you choose your own libraries — but that means the
default posture is deliberate and must not be mistaken for enforcement:

- **With no verifier wired, the validators are shape-only.** They check structure and
  return `ok: true` without any signature having been checked. This is a legitimate
  smoke-test posture; it is **not** authorization. Do not gate a disclosure on a
  validator result until you have injected verifiers.
- **Unverified results say so — with one of three markers.** A path that returns
  `ok: true` without a signature having been checked appends a marker to its
  `chainSummary`, which `generateRegistryAttestation` copies into the receipt as
  `authChainSummary`, so a smoke run stays distinguishable from a verified disclosure
  after the fact. `self` and `operator-self` append `/UNVERIFIED-shape-only`;
  `operator-for-downstream` reports its two halves separately as
  `/operator-sig-unverified` and `/customer-sig-unverified`. Audit with the exported
  `chainSummaryIsUnverified()` rather than matching a substring by hand — a
  case-sensitive substring test for the upper-case marker matches only the first of the
  three and reads a wholly unverified downstream disclosure as verified.
- **Once you wire any verifier, every path that cannot be covered is refused.** Wiring
  any one of the three callbacks is what distinguishes a live deployment from a smoke
  run, so from that point on a path whose own verifier is missing is rejected instead of
  returned as shape-only. On `self` the caller supplies `surface` and `surface` selects
  the verifier (`web` → `verifyEip712`, `mcp` → `verifyMlDsa`), so wiring only one means
  a request naming the other surface is refused — otherwise the caller could pick the
  surface you left unwired and skip verification entirely. `operator-self` and the
  operator half of `operator-for-downstream` both require `verifyMlDsa` on the same
  terms: wire `verifyEip712` alone and every operator-path request is refused rather
  than authorized unchecked.
  The one deliberate exception is the customer half of a `customer-grant`, which stays
  a marker rather than a refusal because grants may be authenticated out of band — see
  `verifyCustomerGrant`, and expect `/customer-sig-unverified` in the `chainSummary`
  when you leave it undefined.
- **Sign the same bytes this package verifies.** `selfChallengeMessage`,
  `operatorSelfChallengeMessage`, `operatorDownstreamMessage` and
  `customerGrantMessage` are exported for exactly this: each path is domain-tagged, and
  a signature over anything else will not verify.

Use pure-crypto libraries for the verifiers (`@noble/curves` for EIP-712,
`@noble/post-quantum` for FIPS 204 ML-DSA) — the package itself bundles no EVM tooling.

```ts
const verifiers: AuthVerifiers = {
  verifyMlDsa: async (signature, message, publicKeyHash) => {
    /* your FIPS 204 verify over exactly `message` */
  },
};
const result = await validateAuthForKind("audit-export", auth, verifiers);
if (!result.ok) throw new Error(result.reason);
if (chainSummaryIsUnverified(result.chainSummary)) throw new Error("not actually verified");
```

## Security

The server enforces a small set of defaults so misconfiguration cannot leak the `Authorization` header in transit:

- **HTTPS-only endpoints, held across the whole call.** `SAIHM_ENDPOINT_URL` must use `https://`. Plain `http://` is rejected at construction time, except for `127.0.0.1` and `localhost` (so a local operator endpoint works during development). Because that check covers the configured URL and nothing past it, requests also set `redirect: 'error'` — an endpoint cannot redirect the call, and the request body with it, to a host that was never validated.
- **Per-call abort window.** Each request runs under an `AbortController` that aborts after 30s, preventing a hung endpoint from starving the MCP server.
- **Response-size cap.** 16 MB, enforced twice. A `Content-Length` over the cap is rejected before the body is read at all; independently, the body is measured while it streams and the read is aborted the moment it exceeds the cap. The cap therefore does not depend on the sender declaring an honest `Content-Length`, or any at all.
- **No header echo.** `Authorization` is never included in thrown error messages or stdout.
- **No configuration or user data read from disk.** Configuration flows entirely through env vars, and nothing is ever written to disk. The package opens exactly one file: its own `package.json`, once at startup, so `serverInfo.version` matches the published version (falling back to `0.0.0-dev` if it cannot be read). No credential, cell, or user-data path touches the filesystem.
- **Zero EVM tooling.** No `ethers`, no `eth_*`, no Solidity. If operators inject signature verifiers via `AuthVerifiers`, they should use pure-crypto libraries (`@noble/curves`, `@noble/post-quantum`).

Trust model: this client trusts whatever endpoint the operator configures. Cell IDs, audit anchors, and report receipts returned from that endpoint are surfaced to the agent verbatim — operators are the authority for content shown via `saihm_recall`. Verifying receipts against COTI V2 mainnet anchors is out of scope for this server; consume the `cellId` and `auditCellId` fields and verify against your own SAIHM mainnet read path.

For distribution integrity, each release carries the npm registry signature; verify with `npm audit signatures` (and inspect `npm view @saihm/mcp-server --json | jq .dist`).

## Dependencies

The published npm package has a minimal runtime surface:

| Dependency | License | Role |
|---|---|---|
| Node.js (≥ 20.x) | MIT | Runtime |
| `@modelcontextprotocol/sdk` | MIT | Runtime; MCP SDK, binds the eight-tool surface |
| `zod` | MIT | Runtime; validates tool inputs and report templates |
| `@noble/hashes` | MIT | Runtime; SHA-256 for content digests only — a template's `templateHash` and a report's `outputSha256`. No key material passes through it; see `HARDENING.md` §"Surface minimization" |
| TypeScript | Apache-2.0 | Build-time only — not installed by `npm install @saihm/mcp-server` |
| `tsx` | MIT | Build-time only; TypeScript runner for tests + CLI |

No copyleft, no proprietary dependencies. Cryptographic primitives at the
operator-endpoint layer (ML-DSA-65 / Ed25519 / key derivation) are not bundled into
this MCP server; operators implementing the protocol stack are recommended
to use `@noble/post-quantum` and `@noble/curves` (MIT) rather than rolling
custom code.

## Achievements

- **OpenSSF Best Practices Passing badge** — project 12898, 100% Passing
  criteria (2026-05-19). <https://www.bestpractices.dev/projects/12898>
- **IETF** — `draft-saihm-memory-protocol-01` (2026-05-27) was submitted to the
  Independent Submission Stream; on 2026-07-25 the ISE concluded its consideration
  and released it from the queue (datatracker stream now None), directing the work
  toward IETF working-group activity (the `agentproto` effort). It is
  **not an Internet Standard, is not endorsed by the IETF, and has no formal
  standing in the IETF standards process.** The `-01` draft remains available on
  the datatracker as the current reference text.
  <https://datatracker.ietf.org/doc/draft-saihm-memory-protocol/>
- **npm registry** — releases from `0.3.6` (2026-06-30) onward are published
  from GitHub Actions over OIDC trusted publishing and carry an npm sigstore
  provenance attestation; `0.3.6`–`0.3.10` all do, and the ten earlier
  versions (`0.1.0`–`0.3.5`), published by hand, do not — see `HARDENING.md`
  §"Distribution integrity", which also records that no release tag is signed.
  `0.3.4` (2026-06-22) adds a
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
  The OpenSSF Best Practices Passing badge was achieved on 2026-05-19
  alongside the governance and assurance files; those files first
  reached npm in 0.2.0 (2026-05-28), as the 0.1.3 version they were
  prepared under was never published.
- **MCP Registry / Glama** — server listed for discovery (2026-05-16).

## Roadmap

A 12-month roadmap is maintained in the project's
[AAIF proposal](https://github.com/SAIHM-Admin/saihm-mcp/) and is published at
<https://saihm.coti.global/roadmap>. Near-term tracks:

- **2026-Q2 (closed — one gap carried forward)** — Of the OpenSSF Silver
  pursuit, governance, code-of-conduct, DCO sign-off, coverage tooling and the
  assurance case all landed. Release-tag signing did **not**; `GOVERNANCE.md`
  §"Releases" and `HARDENING.md` §"Distribution integrity" both record it as an
  open gap, and it is carried into the Silver track below.
- **2026-Q3** — First 2–3 external organization deployments; formal AAIF
  Project Proposal submission when adoption blockers clear.
- **2026-Q4** — NIST AI RMF crosswalk public review; EU AI Act
  compliance-checklist generator. OpenSSF Silver award (target).
- **2027-Q1** — v1.0 reference implementation. The specification's
  standards path is open: the ISE route closed on 2026-07-25, and the
  intent is to re-anchor the normative reference on an IETF
  working-group document once one exists that can be cited. No
  publication date is being claimed for that, because none is in the
  project's gift.

## Support

SAIHM is developed and maintained by a solo founder. If it's useful to you or
your organization, please consider
**[sponsoring the project](https://github.com/sponsors/SAIHM-Admin)** — it funds
continued protocol, client, and open-standards work and keeps this open
reference implementation maintained.

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
