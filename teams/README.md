# Teams channel for Claude Code

Bridges your local Claude Code session to a Microsoft Teams bot hosted on
the AI platform. Once installed and configured, any Teams DM sent
to the platform's bot (and routed to the `proxy_agent` binding for your
user) shows up as a `<channel>` notification in your Claude Code
transcript. You answer with the `reply` tool; the platform forwards the
text back to Teams.

This plugin is the Teams sibling of
[`telegram@claude-plugins-official`](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram).
Same MCP-over-stdio contract, same `~/.claude/channels/<plugin>/` state
convention — but inbound comes from the platform's SSE endpoint
(`/v1/proxy/stream`) instead of polling a chat service directly, because
the Teams Bot Framework can't be reached from a laptop behind NAT.

## Install

This plugin is distributed via the marketplace at the root of this
repo. The marketplace manifest lives at
[`../.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json).

From any directory:

```bash
claude
/plugin marketplace add js-skills /absolute/path/to/this/repo
/plugin install teams@js-skills
exit
```

`js-skills` is the marketplace's `name` field. Once the repo is
pushed to a git host you can swap the path for the git URL — Claude Code
will resolve `teams/` from the checkout. HTTP tarball sources
aren't supported by Claude Code's marketplace schema, so the AI platform
does not host the manifest itself.

## Configure

In Claude Code:

```bash
claude
/teams:configure
```

The skill prompts for `SERVER_URL` and `API_KEY` and writes them to
`~/.claude/channels/teams/.env` (mode `0o600`).

You'll need an `ak_…` API key created in the AI platform UI under
**Account → API keys**, scoped to **Proxy (Claude Code)** (`proxy_agent`).
Also make sure an admin has created a gateway binding for your Teams DM,
or that you've linked your Teams identity with `/link <code>` so a
personal binding auto-creates on first DM.

## Run

```bash
claude --dangerously-skip-permissions \
       --channels plugin:teams@js-skills
```

`--channels plugin:teams@js-skills` keeps the channel attached to
this Claude Code session. Without that flag the MCP server is still
spawned but Claude Code won't subscribe to its `<channel>` notifications.

## How it works

```
Teams ──▶ AI platform (gateway) ──▶ proxy_agent ──▶ ProxyHub
                                                       │ SSE
                                                       ▼
                                       this plugin (MCP stdio)
                                                       │ MCP notification
                                                       ▼
                                                  Claude Code
                                                       │ reply tool
                                                       ▼
                                       this plugin ── POST ──▶ AI platform ──▶ Teams
```

## Env file

`~/.claude/channels/teams/.env` (mode `0o600`):

```
SERVER_URL=https://your-platform-host
API_KEY=ak_xxx
```

Do not commit this file. The plugin refuses to start without both
values.

## What's not in V1

- No `edit_message`, `react`, or `download_attachment` tools — those need
  matching platform-side endpoints. Deferred.
- No in-plugin allowlist / pairing. The platform's binding-level scoping
  (only your user's bound channel can reach this plugin's SSE feed) is
  the source of truth in V1.
