# Installing @saihm/mcp-server

This file is for the AI agent doing the install. Read the branch in "Before you
start" first — for this package it changes what you should install.

## What this server is

The **standards client** for a *custodial* SAIHM operator: a server that performs
the cryptography and returns plaintext. This package is deliberately crypto-free,
holds no keys, and persists nothing itself. It exposes the eight canonical
protocol tools — `saihm_remember`, `saihm_recall`, `saihm_forget`,
`saihm_status`, `saihm_share`, `saihm_revoke_share`, `saihm_governance_propose`,
`saihm_governance_vote`.

## Before you start — pick the right package

This one needs an endpoint URL **and** an operator-issued token. It cannot
self-onboard, and there is no free path through it.

- **The user already has an operator endpoint and token** → continue here.
- **They don't, or they want to start free** → install
  [`@saihm/mcp-server-pro`](https://www.npmjs.com/package/@saihm/mcp-server-pro)
  instead and follow its own `llms-install.md`. It self-onboards, seals cells on
  the user's machine, and needs no token from anyone. Do not try to make this
  package work without an operator; it will fail on first call, not at startup.

The hosted service at <https://saihm.net> is **not** a custodial
operator — it is non-custodial by design and stores only ciphertext. Pointing
this package at it will not work. That is what the pro client is for.

## Step 1 — write the MCP config

Merge this into the host's MCP settings file, into the existing `mcpServers`
object rather than replacing it. For Cline that file is
`cline_mcp_settings.json`.

```json
{
  "mcpServers": {
    "saihm": {
      "command": "npx",
      "args": ["-y", "@saihm/mcp-server"],
      "env": {
        "SAIHM_ENDPOINT_URL": "https://operator.example.com/mcp",
        "SAIHM_AUTH_HEADER": "Bearer <token-issued-by-your-operator>"
      },
      "timeout": 60
    }
  }
}
```

Replace both placeholder values with what the operator issued. Keep the block as
strict JSON — no trailing commas.

**`timeout` is required, not decorative.** Cline's default MCP start-up budget is
1.5 seconds. `npx` cannot resolve and launch a package that fast, and a server
that misses the deadline is skipped **silently** — the tools never appear and no
error is surfaced in the chat. If this server seems absent after install, check
that setting before anything else.

## Step 2 — restart the host, then prove the round trip

Installing is not the same as working. The check that matters is a write in one
turn and a read in a **different** one:

1. Call `saihm_remember` with a short, specific fact.
2. In a separate turn, call `saihm_recall` and confirm the fact comes back.

If step 2 returns it, the install is good. Report that to the user in one line
and stop — do not also dump the configuration back to them.

## If it does not work

| what you see | cause | what to do |
|---|---|---|
| no SAIHM tools offered at all | the host never started the server | confirm `timeout` is present, then restart the host |
| `401`/`403` and the endpoint is `saihm.net` or `saihm.coti.global` | that service is non-custodial; this client cannot read it | install `@saihm/mcp-server-pro` instead — see "Before you start" |
| `401`/`403` from the user's own operator | token missing, wrong, or expired | ask the user to re-issue it with their operator |
| `could not reach <url>` | endpoint wrong or unreachable from this machine | the message names the cause (DNS, refused, TLS); fix the URL |
| tools present but never used | the agent has no standing instruction | tell the user to add a line to their persistent instructions asking the agent to recall at session start and remember what matters |

Host note (2026-09-23): The hosted endpoint is `https://saihm.net/mcp`. The previous host, `saihm.coti.global`, serves the identical service until 2026-12-31 and is then discontinued; a configuration that still names it should switch `SAIHM_ENDPOINT_URL` to `https://saihm.net/mcp`.

Do not retry a failing call in a loop. Each of the causes above needs a human
decision, and repeated calls will not change any of them.
