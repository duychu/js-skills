# Teams channel for Claude Code

Bridges your local Claude Code session(s) to a Microsoft Teams bot hosted on
the AI platform. Once installed and configured, a Teams message — a 1:1 DM or a
group chat — sent to the platform's bot and routed to the `proxy_agent` binding
for your user shows up as a `<channel>` notification in your Claude Code
transcript. You answer with the `reply` tool; the platform forwards the text
back to the same Teams conversation.

**Outbound tools.** Simple requests are answered with a single `reply`. For
multi-stage work you can send interim updates with `say` (an out-of-turn
message — a plan, then a mid-report) and close the turn with one `reply`. When
you ask the user something that needs an answer, `schedule_reminder` books a
durable nudge (delivered by the platform even if the session ends;
auto-cancelled when the user next replies), and `cancel_reminder` clears one.
The `/teams:answering` skill guides when to use one vs. many messages and when
to remind. All of this plugin's tools are auto-approved, so they never prompt
the Teams user for permission.

**Multiple sessions, one bot.** Each Claude Code session is identified by a
per-process instance key (`TEAMS_INSTANCE`). The same bot can sit in several
Teams groups and route each group to a *different* session: launch each session
with its own `TEAMS_INSTANCE` and run `/agent proxy[<key>]` in the group that
should reach it. A session with no `TEAMS_INSTANCE` (and a group with no
`proxy[<key>]` suffix) uses the `default` instance, so single-session setups need
no extra configuration. See **Run** below and use `/teams:status` to debug.

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

### Multiple sessions

To run more than one session for the same user (e.g. one bot serving several
Teams groups), give each session a distinct instance key via the
`TEAMS_INSTANCE` environment variable, then bind the matching Teams group to it:

```bash
# laptop session
TEAMS_INSTANCE=laptop claude --channels plugin:teams@js-skills
#   in the Teams group that should reach it:  /agent proxy[laptop]

# server session — same repo, different terminal/host
TEAMS_INSTANCE=server claude --channels plugin:teams@js-skills
#   /agent proxy[server]
```

`TEAMS_INSTANCE` is read per process (it's inherited from the `claude` launch),
so sessions never collide over the shared env file. Each instance keeps its own
PID file (`bot.<instance>.pid`), so concurrent same-repo sessions coexist instead
of terminating one another. If two sessions share an instance, **newest wins** —
the most recent subscriber takes over. Run `/teams:status` in a session to see
its resolved instance and whether it's the active subscriber.

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
# optional: fallback instance when TEAMS_INSTANCE isn't exported
# INSTANCE=default
```

Do not commit this file. The plugin refuses to start without both
`SERVER_URL` and `API_KEY`. These creds are shared across all of the user's
sessions; the per-session identity comes from the `TEAMS_INSTANCE` env var
(env var → `.env` `INSTANCE` → `default`), not from this file.

## Debug

Run `/teams:status` inside a session to see which instance it resolved to (and
where that came from), whether the platform sees it as the active subscriber, and
hints when a group isn't reaching the session or a same-instance session bumped it.

## What's not in V1

- No `edit_message`, `react`, or `download_attachment` tools — those need
  matching platform-side endpoints. Deferred.
- No in-plugin allowlist / pairing. The platform's binding-level scoping
  (which conversations reach a session, refined by the
  `TEAMS_INSTANCE` ↔ `/agent proxy[<key>]` pairing) is the source of truth.
- No per-session credentials. `SERVER_URL` / `API_KEY` are shared per user;
  sessions are distinguished only by instance, not by separate keys.
