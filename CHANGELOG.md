# Changelog

All notable changes to `@saihm/mcp-server` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.12] — 2026-08-31

Discovery and steering release. No new tools, no removed tools, and no schema
change: the eight tools and their input schemas are byte-identical to `0.3.11`.
No input that `0.3.11` accepted is refused here, so unlike the previous release
this upgrade is transparent at the tool boundary.

What changed is what an agent is *told*. Every tool description was rewritten to
say what the tool does, what it returns, and what it will not do — so that a
model choosing between tools can choose correctly without calling one to find
out. Two long-standing gaps are closed: `saihm_share` now states that grantees
are agent-id hashes rather than names and that sharing does not copy the memory,
and `saihm_revoke_share` now states that revocation is forward-only and cannot
retract what a grantee has already read.

### Added

- **Server `instructions`.** `initialize` now returns a short statement of what
  SAIHM is and how to start a session, which MCP hosts surface to the model
  before any tool call. Hosts that ignore the field are unaffected.
- **A fuller `saihm_session_bootstrap` prompt.** The prompt body now carries the
  scoping rules for when to store, recall, share and erase — store what is
  durable rather than chatter, recall instead of re-asking, erase only on an
  explicit request, and name both recipient and shards before sharing. It is
  fetched through `prompts/get` on demand, so it costs nothing per session.
- **README guidance on getting the return.** A new *Tell your agent to use it*
  section: wiring the server in makes the tools available but does not make an
  agent reach for them, and the per-session cost below is only earned back by
  agents that actually recall.

### Changed

- Tool descriptions total 1451 → 2029 characters. The full `tools/list`
  response grew 6910 → 7488 bytes on the wire, and with the new `instructions`
  the per-session metadata an agent loads grew **6910 → 7748 bytes, or +12.1%**
  (~209 tokens). Input schemas dominate that payload and did not change; the
  entire increase is description and `instructions` text.
- The zero-weight vote message no longer names the governance token by ticker,
  describing the balance by role instead.

### Internal

- Two regression tests hold the budget: one asserts descriptions are measured
  across all eight tools and stay within the ratified per-session allowance, the
  other that the registry manifest description keeps its positioning sentence and
  fits the registry length limit.

## [0.3.11] — 2026-08-26

Hardening release. No new tools, no new configuration and no schema change: the
eight tools and their input schemas are the same as `0.3.10`. What changed is
that every value this client reads from an operator — and every value the
reporting module reads from a caller — is now treated as untrusted, and that the
Smithery listing can finally be scanned.

That tightening is visible at the tool boundary, so treat the upgrade as
behaviour-changing rather than transparent: inputs `0.3.10` accepted are now
refused instead of being stored or forwarded — an empty `saihm_remember` write
and a malformed agent-id hash among them. The schemas did not change; the set of
values that survive them narrowed. Operators of the reporting module have one
further break: every signed message is regenerated this release, detailed under
`challengeIssuedAt` below.

### Security

- **A downstream-disclosure approval was a replayable bearer token.** The
  operator's signature on the `operator-for-downstream` path was verified
  against `auth.operatorIdHash` — the operator's own identity, a constant. A
  signature over a constant commits to none of the claim, so one observed
  request yielded a credential that stayed valid for every later request while
  the customer id, scope, expiry, subpoena hash and jurisdiction could all be
  swapped underneath it. The operator now signs the claim itself, encoded as a
  JSON array so that field boundaries survive concatenation.
- **The customer half of "two-of-two" was never checked.** The data subject's
  signature was length-checked and then discarded, so a disclosure *about* a
  party required no act *by* that party. It is now verified through a
  `verifyCustomerGrant` callback, and the customer's signature is bound inside
  the operator's signed message so a valid approval cannot be lifted onto a
  different grant. The check engages once that callback is wired, and wiring it
  is not optional in the sense the other two are: this is the single place where
  a missing verifier does not refuse the path, because a grant may have been
  authenticated out of band. Leave it undefined and the disclosure still
  proceeds — but the receipt now says so, carrying
  `/customer-sig-unverified` in its `chainSummary` where it previously read the
  same as a fully verified one.
- **Signatures were verified over an untagged blob, allowing transfer between
  paths.** `self` and `operator-self` verified a signature over the
  caller-supplied `auth.challenge` alone. Operators wire one `verifyMlDsa`
  callback for every path, so any string that operator had ever signed verified
  here — an observed downstream message could be resent as `challenge` and pass
  as `operator-self`, which `audit-export` and `billing-history` accept.
  Each path now has a domain-tagged message that commits to
  `challengeIssuedAt`.
- **Unwired verifiers returned `ok: true`.** Shape-only smoke-test mode is
  legitimate, but the test for it lived in one function. `operator-self` and the
  operator half of `operator-for-downstream` kept the older shape — verify if
  the callback happens to be present, otherwise pass — so an operator who wired
  `verifyEip712` for a web surface and nothing else authorized every
  operator-path request with no signature check at all. The same hole existed
  one layer down on `self`, where the caller-supplied `surface` field selected
  the verifier and one of the choices was none. Opting in is now asked in a
  single place: once **any** verifier is wired, a path whose own verifier is
  missing is refused rather than waved through.
- **The audit marker for unverified disclosures could not be matched as
  documented.** There are three markers, not one, because
  `operator-for-downstream` reports its two halves separately, and `README` told
  operators to test the chain summary for the upper-case marker as a substring
  — a case-sensitive test matching none of the other two. Following that advice
  exactly, a wholly unverified downstream disclosure read as verified. The set
  is now exported as a single predicate.
- **`sourceUrl` on a registry attestation accepted any scheme.** `new URL()`
  alone admits `javascript:`, `data:` and `file:`, and this value is signed into
  the operator's message and kept as the auditor's evidence link. The scheme is
  now allowlisted. It is deliberately weaker than the runtime client's
  https-only endpoint rule — plain `http` is accepted because some official
  registries and court record systems still publish over it — and the comment
  that claimed parity with that rule has been corrected.
- **`checkKindAuthCoupling` threw instead of refusing on an unknown kind.** The
  requirements table is keyed by a type that does not exist at runtime, so an
  unrecognised kind indexed to `undefined` and crashed on `.includes`. Guarding
  `=== undefined` alone left the inherited half open: `constructor`,
  `toString`, `hasOwnProperty` and `__proto__` answer from `Object.prototype`
  and walked past the guard into the same `TypeError`. The lookup now requires
  an array, which every real entry is and nothing inherited is.
- **`challengeIssuedAt` is enforced on the operator paths.** `self` bounded a
  challenge to 30 minutes; the more privileged paths bounded it to nothing. The
  field stays optional — requiring it would reject operators' live traffic —
  but when present it is now enforced on the same terms. On
  `operator-for-downstream` the field did not exist at all. That mattered
  unevenly across its two branches: a `customer-grant` carries its own
  `expiresAt` and is refused once it passes, but a `legal-basis` claim commits
  to a subpoena hash, a jurisdiction and a record URL and to no point in time,
  so an observed approval stayed valid indefinitely and returned *fresh* data
  under a *stale* legal basis. It is the only operator path that can produce an
  `erasure-confirmation`, and it was also the only path that neither bounded a
  challenge nor recorded that it had not — `operator-self` marks an unbounded
  challenge `/no-replay-window` in the chain summary precisely so an auditor can
  see the absence. The field is accepted there on the same optional terms, bound
  into the signed message, and its absence is now marked the same way. Adding
  the slot costs operators nothing beyond this release: every path's signed
  message is new in `0.3.11`, so signatures are regenerated regardless.
- **A malformed agent-id hash silently became a valid one.** `parseInt` stops at
  the first character it does not understand and yields `NaN`, which a
  `Uint8Array` stores as `0`, so every malformed id still produced a well-formed
  byte string. Since this value decides *who* a sharing contract grants access
  to, the decode now rejects anything that is not hex.
- **Oversized responses were only bounded by a header.** The `Content-Length`
  check was an early-out, not enforcement: a chunked reply carries no such
  header, `Number(null ?? '0')` is `0`, and anything that streamed its response
  reached `res.json()` with no limit on how much it could buffer. Bytes are now
  counted as they arrive and the stream is cancelled mid-flight, so a hostile
  endpoint is cut off rather than downloaded in full and complained about
  afterwards. Decoding is streamed too, so a UTF-8 character straddling a chunk
  boundary is no longer corrupted.
- **A registered template's identity committed to data nothing validated.**
  `validateBespokeTemplate` parses with a non-strict schema, which strips unknown
  keys, but `registerTemplate` hashed the raw argument. A template carrying
  arbitrary extra keys therefore validated clean and still changed its
  `templateHash` — the durable identity of the registration, which
  `template_registered` records and both halves of `template_superseded`
  reference. The audit ledger was committing to content that nothing validated,
  capped or read, while every field that *is* validated is capped. It also forked
  identity on something that was never part of the template. The hash is now taken
  over the validated projection; a template that was already conformant hashes to
  exactly what it did before, because the canonical form sorts keys at every level
  and drops undefined either way.
- **The `verifyEip712` callback's declared contract misdescribed two of its three
  parameters.** The operator supplies this callback, and on the `web` surface it is
  the only signature check in front of `audit-export` and `billing-history`. Its
  second parameter was declared `challenge` but receives the domain-tagged message
  (`SAIHM-REPORT-SELF-v1`), not the caller's raw `auth.challenge`; its third was
  declared `walletAddress` but receives a 64-hex id hash, which is whichever of
  `walletIdHash` or `agentIdHash` the caller supplied and so may not describe a
  wallet at all. An Ethereum address is 40 hex, so an operator implementing to the
  old names recovers a signer address, compares it against a 32-byte hash and never
  matches — the `web` surface fails closed. The unsafe way to get it wrong is to
  drop a comparison that never works and return true on any well-formed signature.
  Both sibling verifiers already named these correctly. The parameters are renamed
  to `message` and `walletOrAgentIdHash`, the real contract is documented on the
  declaration, and a test now inspects the arguments the callback actually receives
  — previously every test wired `async () => true` and never looked at them.
- **An operator could forge extra receipts inside a receipt identifier.** The values
  that say which cell was written, erased or shared were the only operator-controlled
  data in the tool surface that reached the output as *structure* rather than as
  content, and the only ones emitted with no shape check. Everything beside them is
  defended: non-primitives are refused and hashes are truncated before printing. So an
  operator answering `saihm_forget` with a cell id of `<the id you asked for>] DEK
  destroyed\nFORGOTTEN [<some other cell>` produced **two** well-formed erasure
  receipts from one call, the second attesting the destruction of a cell that was never
  asked about and never erased — defeating the guard that exists because erasure is the
  one claim here nobody can verify afterwards. Reading a cell's plaintext back cannot do
  this; plaintext prints after a `|` on an indented recall line, never as a receipt of
  its own. A receipt identifier must now be a single-line printable token within
  `MAX_RECEIPT_ID_LEN`, and is refused rather than truncated, because a shortened cell
  id cannot be handed to `saihm_forget`. The same bound also stops an operator emitting
  a multi-kilobyte identifier straight into the transcript.


### Fixed

- **A hash that arrived as a number is no longer displayed as a hash.** Anchors
  and agent-id hashes are shown truncated with an ellipsis, so a numeric `12345`
  rendered as `anchor=12345…` — a number dressed as the first characters of a
  32-byte hash that was never sent. Scalars that are genuinely numeric, such as
  an epoch or a fee, are unaffected.
- **A vote recorded in the opposite direction no longer slips past the mismatch
  check.** An operator that serialises `false` as `"false"` read as "not
  reported" against a bare `typeof === 'boolean'` test, dropping the very
  mismatch warning that exists to catch it. Boolean fields are now read through
  a check that accepts every unambiguous spelling. The two callers are not
  symmetric and the reader leans accordingly: an unrecognised `revoked` is read
  as "not true", which errs toward warning about access that was in fact
  withdrawn.
- **`saihm_forget` no longer reports an erasure it cannot evidence.** Erasure is
  the one claim here that a user cannot check afterwards — by construction
  nothing is left to look at — so it is now reported only on a receipt that
  names *which* cell was destroyed. `success: true` with no cell id is an
  acknowledgement, not evidence, and would have rendered as
  `FORGOTTEN [undefined]` under a GDPR Art. 17 request. A response that is not
  an object, or a `success` that is neither true nor false, is diagnosed rather
  than reported as "not found or already destroyed", which asserts a cause the
  operator never gave.
- **A malformed recall response is no longer misdiagnosed as a non-custodial
  operator.** `Array.isArray` vouches for the container, not the contents: a
  list of `null`s or primitives has no string plaintext, satisfied the
  all-sealed test, and sent the user to install a different package to fix a
  malformed reply. Arrays needed excluding explicitly, since `typeof [] ===
  'object'` let a list of lists land on the same misdiagnosis. A cell id that
  cannot be quoted back is now diagnosed at the point of reading rather than
  surfacing later as a raw output-schema error naming a path into an object the
  user never saw.
- **"No memories stored" is no longer said after a query that simply matched
  nothing.** It is a claim about the whole store, and said in the wrong place it
  tells a user their memory is gone.
- **`saihm_remember` refuses an empty write.** An empty write still costs a
  creation fee and still returns `REMEMBERED` with a cell id, so nothing
  downstream revealed that the memory had no content — and `z.string()` accepts
  `''`, which is exactly what an agent assembling content from a template that
  resolved to nothing will send.
- **Reading a field off a `null` container no longer throws before any
  diagnosis can run.** The three tools written first did not guard their
  response container; a `storageByTier` that arrived as an array rendered its
  indices as tier names, and one that arrived as an object rendered
  `filecoin=[object Object]B`. A blank `walletIdHash` alongside a valid
  `agentIdHash` is also no longer rejected as "missing or malformed", since
  `??` treats `''` as a value.

### Changed

- **The Smithery listing can be scanned.** `configSchema.required` listed both
  settings, which blocked Smithery's scanner from ever launching the server, so
  the listing showed no tools at all. Boot is lazy and the server enumerates its
  eight tools with no environment set — a missing endpoint surfaces as a typed
  error on first call, not a crash — so `required` is now empty while both
  fields are still prompted for in the UI. The `saihmEndpointUrl` description
  now states that it is a **custodial** operator, not the non-custodial hosted
  service.
- **`saihm_recall`'s description no longer says "retrieve and decrypt".** This
  client holds no keys and runs no cryptography; the operator decrypts and
  returns plaintext, as every other document in the repo says.
- **`npm pack` now builds.** `prepack` runs the build, so a tarball can no
  longer be produced from a stale or absent `dist`. `prepublishOnly` runs
  typecheck and tests, and `typecheck` now covers the test sources as well; the
  release workflow no longer tolerates a missing `typecheck` script.

### Documentation

- **Corrected the release history for `0.1.1`–`0.1.3`.** `0.1.3` was prepared
  but never published — there is no npm version, no tag and no GitHub Release —
  and is now labelled as such rather than deleted, since other documents cite
  its date for the OpenSSF badge. `0.1.1` did reach npm but was never written
  up; its entry is reconstructed from the published tarball metadata. The
  `mcpName` casing correction is attributed to `0.1.2`, where it happened,
  rather than being described there as an addition.

## [0.3.10] — 2026-07-28

### Fixed

- **`saihm_status` and `saihm_recall` no longer fail against a non-custodial
  operator.** An operator only reports what its custody model lets it see: one
  that holds ciphertext and no keys has no stored-byte totals to report and no
  plaintext to return. `saihm_status` assumed every field was always present and
  crashed with `Cannot convert undefined or null to object` on the first absent
  one; `saihm_recall` returned cells with no `plaintext` and failed its own
  output schema. `saihm_status` now reports whatever the operator does provide
  and names what it cannot, and `saihm_recall` explains that the operator is
  non-custodial and points to
  [`@saihm/mcp-server-pro`](https://www.npmjs.com/package/@saihm/mcp-server-pro),
  which seals and opens cells on your own machine. A partially sealed response is
  reported as its own distinct fault rather than blamed on custody. Output for a
  fully custodial operator is unchanged.
- **Absent fields are omitted, never defaulted.** A fabricated `shards=0` reads
  as "you have no memories"; an empty epoch reads as fact. Both are now left out,
  as are `contracts` and `governance` counts for an operator that sent no such
  arrays — `contracts=0` is an answer when the operator returns an empty list and
  a fabrication when it returns nothing.
- **A field being present no longer implies it has the declared type.** The
  operator's JSON is cast, not validated, so `bfsi` arriving as `"1.0"` instead of
  `1.0` — ordinary for a protocol that already carries `bfsi_R`, `bfsi_M` and
  `snapshotEpoch` as strings — crashed `saihm_status` with `d.bfsi.toFixed is not
  a function`. Numeric fields are now read through a check that accepts a numeric
  string, treats `NaN`, `Infinity` and non-numbers as not reported, and keeps
  unusable values out of the `z.number()` slots in structured output. Printed
  fields are read the same way, so a value that arrives as an object no longer
  renders as `[object Object]`; an `agentIdHashHex` that is not a string used to
  take the whole tool down on its first line with `.slice is not a function`. A
  `storageByTier` that is not an object is no longer enumerated character by
  character, a non-array `contracts` is no longer counted, and a `saihm_recall`
  response that is not a list is diagnosed instead of failing as
  `cells.filter is not a function`.
- **`saihm_remember` no longer reports an unconfirmed write as stored.** A
  receipt carrying no `cellId` confirms nothing and leaves nothing for
  `saihm_forget` to erase later, so it is now an explained failure rather than a
  `REMEMBERED` line. Receipt fields the operator did not send are left out
  instead of being rendered as the literal `undefined` — `String(undefined)` is
  a valid string, so the output schema could not catch it. `saihm_recall` treats
  absent cell metadata the same way. A full receipt renders exactly as before.
- **PRS carried as the §3.4 `prs` field is no longer announced as unreported.**
  It is reported either as the `prsScore` operator extension or as the spec's
  `prs`; the notice now requires both to be absent, so status can no longer print
  a PRS value and deny having one in the same breath. The §3.4 line likewise
  renders whichever of `bfsi`, `bfsi_R`, `bfsi_M` and the window start an
  operator sends, instead of being skipped unless `prs` was among them.

### Changed

- **Corrected setup guidance that pointed this client at an incompatible
  service.** The README and the first-run hint directed readers to the hosted
  SAIHM service at <https://saihm.coti.global> for an endpoint and token. That
  service is non-custodial by design and cannot serve this deliberately
  crypto-free client. The README, the first-run hint and the `SAIHM_ENDPOINT_URL`
  description in the MCP registry listing now state that plainly and route
  hosted-service users — including the free trial — to `@saihm/mcp-server-pro`,
  and describe `SAIHM_ENDPOINT_URL` as a **custodial** operator you run or
  subscribe to.

### Added

- `StatusSnapshot.custody` (optional) — the operator's declared custody model.

## [0.3.9] — 2026-07-28

Onboarding release. Documentation and first-run guidance only — no protocol,
wire-format, or tool-surface change, and this package remains crypto-free.

### Fixed

- **The first-run error was a dead end.** A fresh install has no operator
  endpoint, so the first tool call throws — and the message offered only a
  website and the offline demos. It now names the free path explicitly
  (`npx -y @saihm/mcp-server-pro free-join`) alongside the operator route and
  the demos, so an agent that hits the error can act on it.
- **The documented free-trial command could not work.** The quickstart omitted
  `SAIHM_ENDPOINT_URL` and the master secret, so it failed with
  `SAIHM_ENDPOINT_URL env var required`. Corrected to a working sequence,
  including how to generate the secret.

### Changed

- **"Companion package" pointed only at `@saihm/client-pro`**, a library. It now
  names `@saihm/mcp-server-pro` first — the drop-in MCP server that performs the
  client-side cryptography itself and can self-onboard, including the free
  trial — and describes `@saihm/client-pro` as the embeddable library.
- The free trial is now surfaced at the top of the README, ahead of the offline
  demos, instead of below the configuration section that assumes an endpoint.

## [0.3.8] — 2026-07-01

Discovery release. Registry and README metadata only — no protocol,
wire-format, or runtime code change, and this package remains crypto-free.

### Changed

- **The offline demos are now visible before the install decision.** Someone
  reading the npm or MCP-registry listing had no signal that the protocol can
  be evaluated without an account. A one-line evaluate-it-offline pointer was
  added at the top of the README (above "What this is"), to the npm
  `description`, and to the `server.json` registry `description`.
- The `server.json` description was rewritten to fit the registry's length
  limit while making room for the demos: dropped "Post-quantum" and shortened
  "persistent memory" to "memory", producing
  `Sovereign encrypted memory for AI agents. 8 MCP tools. GDPR erasure. Runnable offline demos.`

## [0.3.7] — 2026-06-30

Distribution and first-run release. Adds registry/directory metadata and
automates MCP-registry publishing; the only runtime change is the text of two
configuration error messages. No protocol or wire-format change, and this
package remains crypto-free.

### Added

- **`.mcp.json`** — a standard MCP client-configuration file at the repo root
  so cursor.directory auto-detects the server instead of requiring a manual
  listing.
- **`glama.json`** — declares `maintainers: ["SAIHM-Admin"]` so the Glama
  registry ownership claim can be verified from the repo.
- **`assets/saihm-mcp-logo-400.png`** — a 400x400 project logo, the size MCP
  directory listings request.
- **Automated MCP-registry publishing.** `release.yml` now fetches
  `mcp-publisher`, authenticates with `login github-oidc`, and publishes
  `server.json` after the npm publish, so the registry entry no longer has to
  be pushed by hand. The `io.github.SAIHM-Admin/*` namespace is proven by the
  workflow's OIDC claim — no registry token is stored.

### Changed

- **The first-run error was a bare dead end.** A fresh install has no operator
  endpoint, so the first tool call threw `SAIHM_ENDPOINT_URL env var required`
  with nowhere to go. Both `bootFromEnv()` errors now append a setup hint
  naming the two next steps: obtain a live endpoint at
  <https://saihm.coti.global>, or evaluate the protocol offline first via the
  runnable demos.
- **The README Configure section assumed you already had credentials.** It now
  states that the endpoint and token are issued by an *operator* and gives both
  routes — join the hosted service, or run your own endpoint — plus the
  consequence of configuring neither.
- The README version line was a hardcoded `v0.3.4`, three releases stale. It is
  now a dynamic npm version badge, so it cannot drift again.

## [0.3.6] — 2026-06-30

Discovery release. No protocol or wire-format change; the published JavaScript
adds machine-readable tool output and a session-bootstrap prompt.

### Added

- **Structured tool output.** `saihm_remember`, `saihm_recall`, and
  `saihm_status` now advertise an `outputSchema` and return matching
  `structuredContent`, so MCP hosts and agents can consume typed results instead
  of parsing prose.
- **`saihm_session_bootstrap` prompt.** A new MCP prompt (the `prompts`
  capability is now advertised) that instructs an agent to load its SAIHM memory
  via `saihm_recall` at the start of a session.
- README tool-reference table and additional npm `keywords` (`mcp-server`,
  `persistent-memory`, `ai-agents`, `claude-desktop`, `cursor`, `gdpr`) for
  discovery.

### Changed

- `server.json` MCP-registry manifest: trimmed the `description` to the
  registry's length limit, added `websiteUrl`, and synced `version`.
- Generalized two README references to the receipt and key-derivation internals
  to describe them by class rather than by construction.

## [0.3.5] — 2026-06-27

Documentation release. No protocol, wire-format, or runtime code change.

### Added

- A "See it run" README section linking the offline cross-model demos and the
  open token benchmark.

## [0.3.4] — 2026-06-22

Documentation release. No protocol, wire-format, or runtime code change.

### Added

- A prominent "storage is the operator's responsibility (by design)" README
  section: operators choose and configure their durable backend (a local
  IPFS/Kubo node first, then a Filecoin deep-archive provider), and may instead
  Join SAIHM to use the hosted, non-custodial operator (ciphertext only).

### Changed

- Softened the legacy "persisted to Filecoin" wording to operator-configured
  durable storage.

## [0.3.3] — 2026-06-22

Documentation release. No protocol, wire-format, or runtime code change;
the published JavaScript is behavior-identical to 0.3.2.

### Changed
- Stated the IETF / Independent-Submission status precisely: the protocol
  is published as `draft-saihm-memory-protocol-01` (2026-05-27), *In ISE
  Review* in the Independent Submission Stream — not an Internet Standard,
  not endorsed by the IETF, and with no formal standing in the IETF
  standards process. Replaced the prior "draft-00 accepted into pipeline"
  wording (README Achievements) and the roadmap's "IETF RFC publication"
  with "Independent-stream (ISE) RFC publication."
- Added a companion-package cross-reference to `@saihm/client-pro`
  (production client-side post-quantum cryptography) in the README and
  refreshed the npm `description` to match.
- Corrected a misleading "Standards-track release" label on the historical
  0.1.3 entry below; that release was OpenSSF and governance work, unrelated
  to any standards-track status.

## [0.3.2] — 2026-06-22

Documentation patch. No protocol, wire-format, or runtime code change;
the published JavaScript is behavior-identical to 0.3.1.

### Fixed
- Corrected the documented operator-endpoint path from the phantom
  `/saihm/v1` to the canonical `/mcp` — in the README
  `SAIHM_ENDPOINT_URL` examples (×2) and the `saihm_runtime_client`
  configuration comment (×1).
- Corrected the distribution-integrity note: each release carries the
  npm registry signature (verify with `npm audit signatures`); the
  prior wording claimed sigstore provenance, which is not currently
  produced (no provenance attestation, no CI release workflow).

## [0.3.1] — 2026-05-28

Patch release. Fixes a long-standing version-string defect in the
MCP-server initialization: the `serverInfo.version` returned to MCP
clients on `initialize` was hardcoded to `"0.1.0"` since the very
first 0.1.0 release, regardless of the npm-published version
(observed via post-publish smoke testing of 0.3.0). The fix sources
the version string from `package.json` at boot so the reported
version always matches the npm-published version going forward.

### Fixed
- `serverInfo.version` returned to MCP clients via `initialize` now
  reflects the actual npm-published version (sourced from
  `package.json` at server-boot time). Prior to this fix, the value
  was hardcoded `"0.1.0"` for every release from 0.1.0 through
  0.3.0, which misrepresented the server's identity to any MCP
  client inspecting `serverInfo`.

### Changed
- `saihm_mcp_server.ts` now performs a synchronous `readFileSync`
  of the bundled `package.json` once at module load and passes the
  parsed `version` into the `McpServer` constructor. No new
  third-party dependencies were added (Node built-ins only:
  `node:fs`, `node:url`, `node:path`).

### Notes
- This is a metadata-only fix. There is no change to the
  `StatusSnapshot` shape, the cell tuple, the 8-tool MCP surface,
  the operator-wire protocol, or any test assertions.

## [0.3.0] — 2026-05-28

Alignment release: the public `StatusSnapshot` response shape returned
by `saihm_status` is extended to surface the spec-defined fields of
`draft-saihm-memory-protocol-01` §3.4. This fulfills the deferred
follow-up commitment recorded in the 0.2.0 "Scope" subsection. The
change is purely additive (existing consumers reading any of the
prior `prsScore` / `bfsiScore` / `storageByTier` /
`stakingPosition` / `activeSharingContracts` / `phi` /
`snapshotEpoch` fields continue to work unmodified); the version is
bumped to 0.3.0 because the public interface grew. No wire-protocol
behavior change at the operator endpoint.

The 0.2.0 "Scope" note named three deferred fields (`bfsi_R`,
`bfsi_M`, `bfsi_window_start_ts`); this release adds all eight
spec-defined fields of §3.4 (`prs`, `bfsi`, `bfsi_window_start_ts`,
`bfsi_R`, `bfsi_M`, `shards`, `contracts`, `governance`) so that the
full §3.4 surface is aligned in a single release rather than across
multiple minor versions.

### Added
- `StatusSnapshot.prs` — IEEE 754 binary64 in [0.0, 1.0], the spec
  §3.4 Process Reliability Score. Surfaced alongside the existing
  `prsScore` / `prsLevel` operator-extension fields.
- `StatusSnapshot.bfsi` — IEEE 754 binary64 in [0.0, 1.0], the spec
  §3.4 Byzantine Fault Score Index. Surfaced alongside the existing
  `bfsiScore` operator-extension field.
- `StatusSnapshot.bfsi_window_start_ts` — decimal-string UNIX epoch
  seconds, the start of the 30-day rolling window over which `bfsi`
  (and `prs`) is computed. Per spec §3.4 the bfsi inputs MUST be
  exposed to the holder so the computation is reproducible.
- `StatusSnapshot.bfsi_R` — decimal-string count of operator-anchored
  receipts attributed to the holder over the window. Surfaced as
  `string` (not `number`) so receipt counts beyond 2^53 - 1 remain
  exact.
- `StatusSnapshot.bfsi_M` — decimal-string count of those receipts
  with no corresponding tool-call event attested in the holder's
  local event log. Surfaced as `string` for the same precision
  reason.
- `StatusSnapshot.shards` — spec-aligned per-tier cell-count map
  (`Record<string, number>`), per §3.4. The pre-existing
  `storageByTier` (per-tier byte total) is retained alongside.
- `StatusSnapshot.contracts` — array of structured sharing-contract
  entries per §3.4. Each entry has `contractId` (32-byte hex),
  `mode` (uppercase spec enum `"TEMPORARY"` / `"PERMANENT"` /
  `"SYNDICATE"`), `granteeIds` (array of 32-byte hex), and
  `expiresAt` (decimal-string epoch seconds). Surfaced alongside the
  pre-existing `activeSharingContracts` count.
- `StatusSnapshot.governance` — array of structured governance-
  proposal entries per §3.4. Each entry has `propId` (32-byte hex),
  `scope`, `opens_ts`, `closes_ts`, `tally_for`, `tally_against`,
  and `tally_abstain`. Tally fields are decimal strings to preserve
  precision for unbounded vote-weight aggregates.
- Two new exported interfaces, `ContractEntry` and `GovernanceEntry`,
  for the new array-shaped fields.
- Server text-output addition: `saihm_status` now appends a §3.4
  line: `§3.4: prs=… bfsi=… (R=… M=… win=…) contracts=…
  governance=…`.
- Test-suite assertions for the new fields, including: numeric
  range checks ([0.0, 1.0]) on `prs` and `bfsi`; decimal-digit
  regex checks on `bfsi_R` / `bfsi_M` / `bfsi_window_start_ts` /
  `expiresAt` / `tally_for`; 32-byte hex shape checks on
  `contracts[].contractId` / `contracts[].granteeIds[]` /
  `governance[].propId`; mode-enum membership on
  `contracts[].mode`; and a round-trip check that
  `bfsi == 1 - (M / R)` to within a 1e-9 tolerance.

### Changed
- `ARCHITECTURE.md` now documents the `saihm_status` schema
  (`draft-saihm-memory-protocol-01` §3.4) including the `bfsi`
  formula, the R = 0 convention, and the integrity-threshold note.

### Notes
- This change is fully forward-compatible. The mock endpoint in
  `tests/integration.test.ts` was extended to return the new fields
  with values that satisfy `bfsi == 1 - (M / R)` round-trip
  (R = 8, M = 1, bfsi = 0.875). All existing assertions continue to
  pass.
- Operators implementing the SAIHM endpoint behind
  `SAIHM_ENDPOINT_URL` SHOULD return all of the new fields on
  `saihm_status` responses so the TypeScript-declared shape matches
  the runtime payload. The new fields are declared as required (not
  optional), reflecting the spec-alignment intent of this release;
  operators that omit a field will leave consumers reading that
  field with `undefined` at runtime, diverging from the declared
  shape. Consumers reading only the pre-0.3.0 fields
  (`prsScore`, `bfsiScore`, `storageByTier`, `stakingPosition`,
  `activeSharingContracts`, `phi`, `snapshotEpoch`) will not
  notice. The narrow class of consumers that *construct* a
  `StatusSnapshot` value literal (rare — the type is normally
  received from the operator endpoint) will need to provide the
  new required fields to satisfy the type checker; this is the
  only consumer-side compile-time change.
- The uppercase `"TEMPORARY"` / `"PERMANENT"` / `"SYNDICATE"` form
  used in `ContractEntry.mode` matches `draft-saihm-memory-
  protocol-01` §2.5 / §3.4 verbatim. It is independent of the
  lowercase `SharingContractType` enum (`'temporary'` /
  `'permanent'` / `'syndicate'`) used by `saihm_share` parameters,
  which is retained for legacy reasons. Operators are responsible
  for mapping between the two on the wire.
- The spec uses `bfsi_R`, `bfsi_M`, `bfsi_window_start_ts`,
  `opens_ts`, `closes_ts`, `tally_for`, `tally_against`, and
  `tally_abstain` in snake_case; the TypeScript field names mirror
  the spec verbatim rather than transforming to camelCase, so JSON
  wire encoding aligns with the spec without an intermediate
  serializer.

## [0.2.0] — 2026-05-28

Alignment release: the public `RememberResult` and `RecalledCell`
response shapes are extended to surface the public fields of the cell
tuple defined in `draft-saihm-memory-protocol-01` §2.1. The change is
purely additive (existing consumers reading only `cellId` / `tier` /
`plaintext` continue to work unmodified); the version is bumped to
0.2.0 because the public interface grew. No wire-protocol behavior
change at the operator endpoint.

Note on §2.1's recipient-side MUST-recompute of `cellId`: in this
architecture the operator is the recipient holding the ciphertext, so
the recompute runs at the operator endpoint. The client-surfaced
fields below let the agent keep a verifiable inspection record of
which nonce, KEK generation, and holder identity were bound to a
given cell.

### Added
- `RememberResult.cellNonce` — 16-byte hex per-cell nonce. Lets the
  agent log which nonce was bound to its memory cell at creation
  time. Per spec §2.1 this is a public field of the cell tuple.
- `RecalledCell.cellNonce`, `RecalledCell.kekVersion`,
  `RecalledCell.holderIdHex`, `RecalledCell.holderSignaturePrefix` —
  the public-tuple fields surfaced on recall, so the agent can
  inspect the cell's binding identity (which nonce sealed the DEK,
  which KEK generation, which holder public-key hash, and a compact
  prefix of the ML-DSA-65 holder signature). The full signature
  (~3309 bytes) is intentionally not surfaced; that is deferred to a
  future release pending consumer demand.
- Server text-output additions: `saihm_remember` now includes
  `nonce=<cellNonce>` in its `REMEMBERED` line; `saihm_recall`
  includes `kekV=<kekVersion> nonce=<cellNonce>` in each line.
- Test-suite assertions for the new fields, including a 16-byte hex
  shape check on `cellNonce` and a 32-byte hex shape check on
  `holderIdHex`.

### Changed
- `ARCHITECTURE.md` cell-tuple definition updated to the 8-field
  spec-aligned shape (`draft-saihm-memory-protocol-01` §2.1).
  Operator-side metadata (`epoch`, `feeNcoti`, `signaturePrefix`,
  `auditCellId`) is now documented separately from the spec wire
  tuple.

### Scope
This release aligns ONLY the §2.1 cell-tuple public-field surface.
Other parts of `draft-saihm-memory-protocol-01` (in particular the
§3.4 `saihm_status` schema, which adds `bfsi_R` / `bfsi_M` /
`bfsi_window_start_ts` for bfsi-input transparency) are NOT addressed
in this release and remain at the prior 0.1.x shape. A follow-up
release will perform the corresponding `StatusSnapshot` alignment.

### Notes
- This change is fully forward-compatible. The mock-endpoint in
  `tests/integration.test.ts` was extended to return the new fields,
  but the existing assertions (e.g. `r1.cellId === 'deadbeef'…`) all
  continue to pass.
- Operators implementing the SAIHM endpoint behind
  `SAIHM_ENDPOINT_URL` SHOULD return all of the new fields on
  `saihm_remember` and `saihm_recall` responses so the
  TypeScript-declared shape matches the runtime payload. The new
  fields are declared as required (not optional), reflecting the
  spec-alignment intent of this release; operators that omit a field
  will leave consumers reading that field with `undefined` at
  runtime, diverging from the declared shape. Consumers that only
  read `cellId` / `tier` / `plaintext` will not notice. The §2.1
  `cellId` recompute itself remains an operator-side duty because
  the client never receives ciphertext.

## [0.1.3] — 2026-05-19 — PREPARED BUT NEVER PUBLISHED

> **This version does not exist on npm.** `npm view @saihm/mcp-server@0.1.3`
> returns E404, there is no `v0.1.3` git tag, and there is no GitHub Release.
> The work below was really done on this date, but it first reached npm in
> `0.2.0` (2026-05-28). The entry is kept because the files it describes are
> real and other documents cite this date for the OpenSSF badge; it is labelled
> rather than deleted so that nobody tries to install it or cite it as shipped.

Governance and assurance release: OpenSSF Best Practices Passing badge achieved
(project 12898, 100%); Silver criteria at 95%. Adds governance,
assurance, CI, and security tooling. Bumps runtime and dev
dependencies. No change to MCP-server runtime behavior or wire protocol.

### Added
- `SECURITY.md` — responsible disclosure policy with private channel
  (`architect@saihm.coti.global`), 14-day acknowledgment / 30-day
  fix-or-mitigation-plan targets.
- `CONTRIBUTING.md` — PR process, test policy, eight-tool MCP cap
  invariant, DCO 1.1 `Signed-off-by:` sign-off requirement, regression
  test mandate for bug-fix PRs.
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1 verbatim.
- `GOVERNANCE.md` — project governance modeled on the Linux
  Foundation's Minimum Viable Governance framework.
- `ARCHITECTURE.md` — system diagram, components, data envelope, trust
  model, threat-model summary, build/test/release flow.
- `HARDENING.md` — threat model + eight categories of enforced
  hardening choices.
- `ASSURANCE_CASE.md` — Claims-Arguments-Evidence structured argument
  for credential confidentiality, availability, distribution
  integrity, cryptographic currency, and process controls.
- `.bestpractices.json` — 115 `_status` fields (107 Met + 8 N/A) for
  OpenSSF Best Practices automation.
- `.github/workflows/ci.yml` — GitHub Actions CI on every push and PR
  (Node 20.x and 22.x): `npm ci`, lint, format:check, typecheck,
  build, test (with c8 coverage >= 80%).
- `.github/dependabot.yml` — weekly Dependabot for npm and
  github-actions ecosystems.
- ESLint (typescript-eslint recommended), Prettier, c8 coverage
  (statement >= 80% enforced; current 81.82%).
- OpenSSF Best Practices Passing badge in README — project 12898 at
  100% Passing criteria.

### Changed
- `@noble/hashes` 1.8.0 -> 2.2.0 (sha256 import path moved from
  `@noble/hashes/sha256` to `@noble/hashes/sha2.js`).
- `zod` 3.25.76 -> 4.4.3.
- `typescript` 5.9.3 -> 6.0.3 (requires `types: ["node"]` in tsconfig
  compilerOptions, now set).
- `@types/node` 20.19.40 -> 25.9.0.
- `tsx` 4.21.0 -> 4.22.2.
- GitHub Actions: `checkout` v4 -> v6, `setup-node` v4 -> v6.

## [0.1.2] — 2026-05-16

First release published to the MCP Registry (Glama) and to npm with
full metadata.

### Fixed
- `mcpName` casing corrected to `io.github.SAIHM-Admin/saihm-mcp`. It was
  added in `0.1.1` as `io.github.saihm-admin/saihm-mcp`, and the MCP Registry
  namespace must match the GitHub organization exactly, so the lowercase form
  could not be registered. (This entry previously claimed `mcpName` was *added*
  here; it was added one version earlier.)

### Added
- `server.json` — MCP Registry submission metadata.

## [0.1.1] — 2026-05-16

Registry-metadata release. This version went to npm at the time but was never
written up here; the entry was reconstructed from the published tarball
metadata.

### Added
- `mcpName` field in `package.json` for MCP Registry discovery, as
  `io.github.saihm-admin/saihm-mcp`. The casing is corrected in `0.1.2`.
- `smithery.yaml` — Smithery configuration (stdio + npm).
- `Dockerfile` — multi-stage Node 20 Alpine image suitable for
  registry probes that prefer container packaging (Glama). Repository
  files: neither is carried in the published tarball.
- Lazy initialization of `SaihmRuntimeClient` in
  `saihm_mcp_server.ts`: the server now starts cleanly without
  `SAIHM_ENDPOINT_URL` / `SAIHM_AUTH_HEADER`, so registry
  introspection (`tools/list`) works before configuration.

### Changed
- README and `package.json` description aligned with the Glama listing
  wording; removed marketing tags ("thin client", "bare-bones") in
  favor of neutral technical description. No semantic change.
- README version drift fixed (`v0.1.0` → `v0.1.2`).

### Note
- No `v0.1.1` git tag or GitHub Release was cut for this version, so it is the
  one published version that cannot be mapped to a commit by tag.
  `HARDENING.md` §"Distribution integrity" records this.
- A previous revision of this entry ended with a note claiming the version had
  been skipped and its contents folded into `0.1.2`. That was wrong and is
  withdrawn: `npm view @saihm/mcp-server versions` lists `0.1.1`, the tarball
  is served at `.../@saihm/mcp-server/-/mcp-server-0.1.1.tgz`, and its
  `package.json` carries the lower-case `mcpName` described above — which is
  precisely what `0.1.2` then corrected. The claim was a leftover from before
  this entry was reconstructed, and it contradicted both the entry's own
  opening line and the npm link at the foot of this file.

## [0.1.0] — 2026-05-09

Initial release.

### Added
- Eight MCP tools wired into a single MCP server (stdio transport):
  `saihm_remember`, `saihm_recall`, `saihm_forget`, `saihm_status`,
  `saihm_share`, `saihm_revoke_share`, `saihm_governance_propose`,
  `saihm_governance_vote`. Each tool forwards to a SAIHM operator
  endpoint configured via env.
- Reporting library exported as a sub-export
  (`@saihm/mcp-server/reporting`): 280-field universe, bespoke
  template schema, four authorization-path validators, six
  receipt-emission sub-kinds, framework smoke
  (registry-attestation) for plumbing verification.
- Security defaults: HTTPS-only operator-endpoint enforcement (with
  `127.0.0.1` / `localhost` development exception), 30-second
  per-call abort window, 16 MB Content-Length response cap, no
  Authorization-header echo on errors, no filesystem reads, zero EVM
  tooling.
- Apache License 2.0.
- Integration test (`tests/integration.test.ts`) covering all eight
  MCP tools, the four reporting-library auth paths, the six receipt
  sub-kinds, the field-universe validation, and the security
  mitigations.

[Unreleased]: https://github.com/SAIHM-Admin/saihm-mcp/compare/v0.3.12...HEAD
[0.3.12]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.12
[0.3.11]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.11
[0.3.10]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.10
[0.3.9]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.9
[0.3.8]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.8
[0.3.7]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.7
[0.3.6]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.6
[0.3.5]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.5
[0.3.4]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.4
[0.3.3]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.3
[0.3.2]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.2
[0.3.1]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.1
[0.3.0]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.2.0
[0.1.2]: https://github.com/SAIHM-Admin/saihm-mcp/releases/tag/v0.1.2
[0.1.1]: https://www.npmjs.com/package/@saihm/mcp-server/v/0.1.1
[0.1.0]: https://github.com/SAIHM-Admin/saihm-mcp/commit/03f1897
