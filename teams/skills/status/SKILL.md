---
name: status
description: Diagnose the Teams channel for this Claude Code session — which instance it resolved to, whether it is the active subscriber on the platform, and any routing collisions. Use when Teams messages aren't reaching this session or replies seem to land in the wrong session.
---

# /teams:status

Use this skill to debug Teams channel routing for the **current** Claude Code
session: confirm which instance key this session uses, where that key came from,
and whether the platform sees this session as the live subscriber for it.

Background: each session is identified by an **instance key**. The plugin sends
it to the platform on the SSE stream (`?instance=` + `X-Proxy-Instance`). The
platform routes a Teams conversation to a session when the conversation's
binding points at `proxy[<key>]` (set with `/agent proxy[<key>]` in that Teams
chat). When two sessions share an instance, **newest wins** — the most recent
subscriber takes over and the older one stops receiving turns.

## What you do

1. **Resolve the instance exactly like the server does**, and record its source
   so the user can confirm `TEAMS_INSTANCE` actually propagated:
   - If the env var `TEAMS_INSTANCE` is set (read it from the environment) →
     instance = that value, source = `TEAMS_INSTANCE env`.
   - Else read `~/.claude/channels/teams/.env`; if it has an `INSTANCE=` line →
     instance = that value, source = `.env INSTANCE`.
   - Else → instance = `default`, source = `default (no TEAMS_INSTANCE set)`.
   - Sanitize to `[A-Za-z0-9_-]+`; empty after sanitizing → `default`.

2. **Read creds** from `~/.claude/channels/teams/.env` (`SERVER_URL`, `API_KEY`).
   If the file is missing, tell the user to run `/teams:configure` first and stop.
   **Never print the API key.**

3. **Query the platform.** `GET ${SERVER_URL}/v1/proxy/debug/state` with headers
   `Authorization: Bearer ${API_KEY}` and `X-Proxy-Instance: <instance>`. Use the
   Bash tool with `curl -s` (do not echo the key into chat — reference the file or
   an env var instead).

4. **Report** a short summary:
   - This session's **instance** and its **source**.
   - From the debug response: how many subscribers exist for this user, the list
     of instances currently connected, and — if the endpoint reports it — whether
     **this** instance is the active (newest) subscriber, plus any pending turns.
     (The platform may be pre-Phase-2 and only report user-level subscriber
     counts without per-instance detail; say so rather than inventing fields.)

5. **Diagnose** based on what you found:
   - *Messages aren't reaching this session* → the Teams group's binding probably
     points at a different `proxy[<key>]` than this session's instance, **or**
     `TEAMS_INSTANCE` wasn't exported so this session silently fell back to
     `default`. Tell them to run `/agent proxy[<instance>]` in the group (using
     the instance reported in step 4), or relaunch with the right `TEAMS_INSTANCE`.
   - *Replies land in the wrong session / this one went quiet* → another session
     connected with the **same** instance and took over (newest wins). Give each
     session a distinct `TEAMS_INSTANCE`.
   - *No subscriber at all for this user* → the SSE stream isn't connected; check
     that Claude Code was started with `--channels plugin:teams@<marketplace>` and
     that the env file is valid.

## What you don't do

- **Don't print or echo the API key** anywhere in chat output.
- **Don't try to start, restart, or kill** the MCP server — it's managed by
  Claude Code. This skill is read-only diagnostics.
