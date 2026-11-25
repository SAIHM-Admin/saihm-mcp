# Installing @saihm/mcp-server

This file is for the AI agent doing the install. Read the branch in "Before you
start" first — for this package it changes what you should install.

## What this server is

The **standards client** for a *custodial* SAIHM operator, intended for
organizations that run their own SAIHM operator endpoint: a server that performs
the cryptography and returns plaintext. This package is deliberately crypto-free,
holds no keys, and persists nothing itself. It exposes the eight canonical
protocol tools — `saihm_remember`, `saihm_recall`, `saihm_forget`,
`saihm_status`, `saihm_share`, `saihm_revoke_share`, `saihm_governance_propose`,
`saihm_governance_vote`.

## Before you start — pick the right package

This one connects with an endpoint URL **and** an operator-issued token, both
from the operator the user runs; it does not self-onboard.

- **The user runs an operator endpoint and has a token** → continue here.
- **They use the hosted service at <https://saihm.net>, have no endpoint yet,
  or want to start with the free trial** → install
  [`@saihm/mcp-server-pro`](https://www.npmjs.com/package/@saihm/mcp-server-pro)
  instead and follow its own `llms-install.md`. It self-onboards, seals cells on
  the user's machine, and needs no token from anyone. This package needs an
  operator endpoint: without one it starts normally and reports a setup error on
  the first tool call.

The hosted service at <https://saihm.net> is non-custodial by design and stores
only ciphertext, so it pairs with the pro client, which encrypts on the user's
machine.

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

**Keep `timeout`.** The first `npx` run downloads the package, which can take
longer than a host allows by default, and a host may then skip the server
without an error in the chat. If this server seems absent after install, check
that setting first.

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
| `401`/`403` and the endpoint is `saihm.net` or `saihm.coti.global` | that service is non-custodial and pairs with `@saihm/mcp-server-pro` | install `@saihm/mcp-server-pro` for it — see "Before you start" |
| `401`/`403` from the user's own operator | token missing, wrong, or expired | ask the user to re-issue it with their operator |
| `could not reach <url>` | endpoint wrong or unreachable from this machine | the message names the cause (DNS, refused, TLS); fix the URL |
| tools present but never used | the agent has no standing instruction | tell the user to add a line to their persistent instructions asking the agent to recall at session start and remember what matters |

Host note (2026-09-23): The hosted endpoint is `https://saihm.net/mcp`. The previous host, `saihm.coti.global`, serves the identical service until 2026-12-31 and is then discontinued; a `@saihm/mcp-server-pro` configuration that still names it should switch `SAIHM_ENDPOINT_URL` to `https://saihm.net/mcp`.

Do not retry a failing call in a loop. Each of the causes above needs a human
decision, and repeated calls will not change any of them.
