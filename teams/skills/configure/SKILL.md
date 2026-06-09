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
   (`~/.claude/channels/teams/` may not exist yet).

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

## What you don't do

- **Don't write the API key into chat output.** Always treat it as a
  secret; only the `.env` file should hold it.
- **Don't try to start anything yourself.** The MCP server is launched by
  Claude Code via `.mcp.json` when the channel is enabled.
- **Don't ask about access control.** V1 trusts the AI platform's
  binding-level scoping — there's no per-plugin allowlist to set up yet.
