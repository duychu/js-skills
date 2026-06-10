---
name: configure
description: One-shot setup for the Teams channel. Writes ~/.claude/channels/teams/.env with the AI server URL + API key, then verifies the key can reach the platform.
---

# /teams:configure

Use this skill the first time the user installs `teams@your-marketplace`, or
whenever they want to change which AI server / API key the plugin should
talk to.

## What you do

1. **Confirm the user has an API key.** They need an `ak_…` API key created
   in the AI platform UI (**Account → API keys**), scoped to the
   `proxy_agent` agent. If they don't have one yet, give them this
   instruction:
   > Open `<AI server>/account?tab=apis`, click **Create API key**, pick
   > **Proxy (Claude Code)** in the agents list, and copy the `ak_…` key
   > that's shown once.

2. **Collect inputs.** Ask the user (one at a time) for:
   - `SERVER_URL` — the base URL of the AI AI platform (no trailing slash).
     Example: `https://ai.your-company.com` or `http://localhost:8000`.
   - `API_KEY` — the `ak_…` value they just copied.

3. **Write the env file.** Create or overwrite `~/.claude/channels/teams/.env`
   with mode `0o600`:
   ```
   SERVER_URL=<server>
   API_KEY=<key>
   ```
   Use the Write tool. Make sure parent directories exist
   (`~/.claude/channels/teams/` may not exist yet). `SERVER_URL` and `API_KEY`
   are shared by all of this user's sessions — the file is read-only at startup,
   so running several sessions against it is fine. Do **not** put the session
   instance here as a hard setting (see step 5); an optional `INSTANCE=<key>`
   line only acts as a fallback default when `TEAMS_INSTANCE` isn't exported.

4. **Verify.** Issue a `GET` to `${SERVER_URL}/v1/proxy/health` with the
   header `Authorization: Bearer ${API_KEY}`. If the response is
   `{"status":"ok"}`, report success. If it's a 401 / 404, tell the user
   the key is wrong or the server doesn't have the proxy module enabled
   and recommend they re-check both values.

5. **Tell the user what's next.** They must:
   - Restart Claude Code so the teams MCP server reloads the new env.
   - Make sure there's a gateway binding on the platform that maps their
     Teams DM/channel to `proxy_agent` (admins create these from
     **Management → Gateway → Bindings**, or it auto-creates on first DM
     after they've linked their identity with `/link <code>`).
   - Run Claude Code with `--channels plugin:teams@<marketplace-name>` —
     `<marketplace-name>` matches whatever local alias the user used when
     they ran `/plugin marketplace add` (default `js-skills`). Or
     install the plugin into the default config so this happens
     automatically.

   **Running multiple sessions (one bot across several Teams groups).** Each
   Claude Code session is identified by a per-process instance key. Launch each
   session with its own `TEAMS_INSTANCE`, then point the matching Teams group at
   it with `/agent proxy[<key>]` in that group:

   ```bash
   # laptop session
   TEAMS_INSTANCE=laptop claude --channels plugin:teams@js-skills
   # then in the Teams group that should reach this session:
   #   /agent proxy[laptop]

   # server session (same repo, different terminal/host)
   TEAMS_INSTANCE=server claude --channels plugin:teams@js-skills
   #   /agent proxy[server]
   ```

   A session launched without `TEAMS_INSTANCE` uses the `default` instance, and a
   Teams group with no `proxy[<key>]` suffix routes to `default` — so the common
   single-session setup needs no extra flags. Use **/teams:status** to confirm
   which instance a session resolved to and whether it's the active subscriber.

## What you don't do

- **Don't write the API key into chat output.** Always treat it as a
  secret; only the `.env` file should hold it.
- **Don't try to start anything yourself.** The MCP server is launched by
  Claude Code via `.mcp.json` when the channel is enabled.
- **Don't ask about access control.** The AI platform's binding-level scoping
  is the source of truth for which conversations reach a session (refined by the
  `TEAMS_INSTANCE` / `/agent proxy[<key>]` pairing); there's no per-plugin
  allowlist to set up here.
