# Channel plugins marketplace

This repository is a Claude Code **plugin marketplace**. The manifest lives at
[`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) and lists
one plugin today: [`teams`](teams/) — a Microsoft Teams channel that bridges
Claude Code to the AI platform's gateway.

## Local install (development)

From any directory:

```bash
claude
/plugin marketplace add js-skills /absolute/path/to/this/repo
/plugin install teams@js-skills
exit
```

`js-skills` is the marketplace's declared `name`; pick anything you
like as the local alias if you prefer.

Then configure the plugin with `/teams:configure` (run from a fresh
Claude Code session) and start a session with the channel attached:

```bash
claude --dangerously-skip-permissions \
       --channels plugin:teams@js-skills
```

## Git-based install (production)

The same `.claude-plugin/marketplace.json` works when this repo is fetched
over git. In a Claude Code session, add the marketplace from the git URL,
then install `teams` from it:

```bash
claude
# 1. Add this repo as a plugin marketplace (git URL)
/plugin marketplace add js-skills duychu/js-skills
# 2. Install the teams plugin from that marketplace
/plugin install teams@js-skills
exit
```

Claude Code resolves `teams/` from the checkout. No HTTP endpoint on the AI
platform is required — Claude Code's marketplace schema only supports path /
git sources, not HTTP tarballs.

Then configure and run it (same as local install):

```bash
claude
/teams:configure
exit

claude --dangerously-skip-permissions \
       --channels plugin:teams@js-skills
```

To update later, run `/plugin marketplace update js-skills` followed by
`/plugin install teams@js-skills`.

## Adding more channel plugins

1. Create `<name>/` at the repo root mirroring [`teams/`](teams/) (`.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, `server.ts`, …).
2. Add a `{name, source, description, …}` entry to
   [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).
3. Make sure the corresponding `proxy_agent` binding on the AI platform
   covers your user.
