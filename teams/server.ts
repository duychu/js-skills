#!/usr/bin/env bun
/**
 * Microsoft Teams channel for Claude Code via an AI platform server.
 *
 * Mirrors the layout and lifecycle of telegram@claude-plugins-official:
 *  - MCP server over stdio. Claude Code is the parent process.
 *  - Inbound: long-lived SSE to ${SERVER_URL}/v1/proxy/stream → relays each
 *    `turn` event as `notifications/claude/channel` so Claude renders it as
 *    a `<channel>` tag in its transcript.
 *  - Outbound: `reply` MCP tool POSTs to ${SERVER_URL}/v1/proxy/reply with
 *    the matching turn_id; the platform forwards it to Teams.
 *  - State dir: ~/.claude/channels/teams/ — same convention as Telegram's.
 *  - No grammy / Bot Framework client — the platform owns the bot.
 *
 * Auth comes from ~/.claude/channels/teams/.env which the /teams:configure
 * skill writes (mode 0o600). V1 has no in-plugin ACL: the platform's
 * binding-level scoping is the source of truth for which messages reach
 * this SSE feed.
 *
 * The SSE consumer is hand-rolled on top of `fetch()` so the
 * `Authorization` header reliably reaches the server (the npm
 * `eventsource` package only supports custom headers via a
 * non-spec init field that Bun does not honor).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function logErr(msg: string): void {
  process.stderr.write(`teams channel: ${msg}\n`)
}

// ── State dir + env loading ────────────────────────────────────────────────

const CHANNEL_DIR = join(homedir(), '.claude', 'channels', 'teams')
const ENV_FILE = join(CHANNEL_DIR, '.env')
// Legacy single-PID file, from before per-instance isolation. Reaped once on
// upgrade so an old single-session process doesn't linger (see writePidFile).
const LEGACY_PID_FILE = join(CHANNEL_DIR, 'bot.pid')

function ensureDir(): void {
  if (!existsSync(CHANNEL_DIR)) mkdirSync(CHANNEL_DIR, { recursive: true })
}

// The session instance key. Sourced per-process from TEAMS_INSTANCE (so several
// `claude` sessions launched from the same repo each get their own identity),
// falling back to an optional INSTANCE line in the shared .env, then "default".
// It becomes a routing key and a PID filename, so restrict to safe characters.
function resolveInstance(envFile: Record<string, string>): string {
  const raw =
    (globalThis as { process?: { env: Record<string, string | undefined> } })
      .process?.env?.TEAMS_INSTANCE ||
    envFile.INSTANCE ||
    'default'
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_-]/g, '')
  return cleaned || 'default'
}

function readEnv(): { SERVER_URL: string; API_KEY: string; INSTANCE: string } {
  ensureDir()
  if (!existsSync(ENV_FILE)) {
    logErr(`missing ${ENV_FILE}. Run /teams:configure to create it.`)
    process.exit(1)
  }
  const text = readFileSync(ENV_FILE, 'utf8')
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  const SERVER_URL = (env.SERVER_URL ?? '').replace(/\/+$/, '')
  const API_KEY = env.API_KEY ?? ''
  if (!SERVER_URL || !API_KEY) {
    logErr(`${ENV_FILE} must define both SERVER_URL and API_KEY.`)
    process.exit(1)
  }
  return { SERVER_URL, API_KEY, INSTANCE: resolveInstance(env) }
}

// SIGTERM the live process recorded in `pidFile`, if any, then return whether
// one was reaped. Best-effort: a dead/foreign PID is left alone.
function reapPidFile(pidFile: string): void {
  if (!existsSync(pidFile)) return
  try {
    const prior = parseInt(readFileSync(pidFile, 'utf8'), 10)
    if (prior && prior !== process.pid) {
      try {
        process.kill(prior, 0)
        try {
          process.kill(prior, 'SIGTERM')
        } catch {
          /* not ours to kill */
        }
      } catch {
        /* not running */
      }
    }
  } catch {
    /* ignore */
  }
}

function writePidFile(pidFile: string): void {
  ensureDir()
  // Reap a prior session of THIS instance (matches the platform's newest-wins
  // policy), and one-time reap the legacy single-PID file so an old
  // pre-isolation process doesn't linger after upgrade. Different-instance
  // sessions use a different file and are left untouched, so several `claude`
  // sessions from the same repo can run side by side.
  reapPidFile(pidFile)
  reapPidFile(LEGACY_PID_FILE)
  writeFileSync(pidFile, String(process.pid), { mode: 0o600 })
}

// ── MCP server ─────────────────────────────────────────────────────────────

const { SERVER_URL, API_KEY, INSTANCE } = readEnv()
const PID_FILE = join(CHANNEL_DIR, `bot.${INSTANCE}.pid`)
writePidFile(PID_FILE)
logErr(`booting; SERVER_URL=${SERVER_URL} key=${API_KEY.slice(0, 6)}… instance=${INSTANCE}`)

const mcp = new Server(
  { name: 'teams', version: '0.0.1' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        // Opt-in to permission relay. When Claude Code wants to use a tool
        // that needs approval, it sends `notifications/claude/channel/permission_request`
        // and our handler forwards the prompt back through the platform to
        // the same Teams DM. The user replies "yes <id>" / "no <id>"; the
        // platform routes that as a verdict event over SSE which we relay
        // back to Claude Code as `notifications/claude/channel/permission`.
        'claude/channel/permission': {},
      },
    },
    instructions: [
      'Messages arrive as <channel source="teams" turn_id="..."> tags carrying',
      'a Microsoft Teams message the user just sent — it may be a 1:1 DM or a',
      'group chat that the platform routes to this session. To answer, call the',
      '`reply` tool with the `turn_id` attribute from the tag and your reply',
      'text; the AI platform forwards your reply back to the same Teams',
      'conversation. Each turn_id can be replied to at most once.',
    ].join(' '),
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description:
        'Send your reply for a single Teams turn back through the AI platform. Pass the `turn_id` exactly as received in the channel notification.',
      inputSchema: {
        type: 'object',
        required: ['turn_id', 'text'],
        properties: {
          turn_id: {
            type: 'string',
            description: 'The turn_id from the channel notification meta block.',
          },
          text: {
            type: 'string',
            description: 'The reply body to send to the Teams user (markdown).',
          },
        },
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  switch (req.params.name) {
    case 'reply': {
      const turn_id = String(args.turn_id ?? '')
      const text = String(args.text ?? '')
      if (!turn_id || !text) {
        return {
          content: [{ type: 'text', text: 'reply requires both turn_id and text' }],
          isError: true,
        }
      }
      try {
        const res = await fetch(`${SERVER_URL}/v1/proxy/reply`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${API_KEY}`,
            'content-type': 'application/json',
            'x-proxy-instance': INSTANCE,
          },
          body: JSON.stringify({ turn_id, text }),
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          logErr(`reply ${turn_id} failed HTTP ${res.status}: ${detail.slice(0, 300)}`)
          return {
            content: [
              {
                type: 'text',
                text: `reply failed: HTTP ${res.status} ${detail.slice(0, 300)}`,
              },
            ],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: `sent (turn ${turn_id})` }] }
      } catch (err) {
        logErr(`reply ${turn_id} network error: ${String(err)}`)
        return {
          content: [{ type: 'text', text: `reply network error: ${String(err)}` }],
          isError: true,
        }
      }
    }
    default:
      return {
        content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
        isError: true,
      }
  }
})

// ── Permission relay: Claude Code → us → AI platform → Teams ──────────────
//
// When Claude Code wants to run a tool that needs approval, it dispatches
// `notifications/claude/channel/permission_request` to every channel that
// declared the `claude/channel/permission` capability. We forward the
// request to the platform via POST /v1/proxy/permission/prompt; the
// platform formats the prompt and proactively messages the user in Teams.
//
// The user's eventual "yes <id>" / "no <id>" reply round-trips back as an
// `event: verdict` on our SSE stream (see streamLoop below), which we
// relay as `notifications/claude/channel/permission` so Claude Code can
// resolve the dialog. The local terminal dialog stays open too; whichever
// answer arrives first wins.

const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string().optional().default(''),
    input_preview: z.string().optional().default(''),
  }),
})

// This channel plugin's own MCP tools are ALWAYS auto-approved. The user
// installed the Teams channel specifically so Claude could operate it, so
// prompting for permission on every reply/say/etc. would just spam their
// Teams DM. Claude Code namespaces plugin tools as
// `mcp__plugin_<plugin>_<server>__<tool>` — for this plugin both <plugin>
// and <server> are `teams`, so every tool we expose shares this prefix.
// Matching the whole prefix means any tool we add later is auto-allowed
// automatically, with no list to keep in sync.
const OWN_TOOL_PREFIX = 'mcp__plugin_teams_teams__'

// The tool names this plugin's ListTools handler registers — used only as a
// fallback in case a permission request ever carries the bare (unqualified)
// tool name instead of the fully-namespaced one. Keep in sync with ListTools.
const OWN_TOOL_NAMES = ['reply']

function isOwnTool(toolName: string): boolean {
  if (toolName.startsWith(OWN_TOOL_PREFIX)) return true
  return OWN_TOOL_NAMES.some(n => toolName === n || toolName.endsWith(`__${n}`))
}

// Additional, NON-plugin tools an operator explicitly wants auto-approved for
// this channel. Comma-separated in the env file (~/.claude/channels/teams/.env);
// each entry matches as an exact tool name or a suffix. Patterns ending in `__`
// match Claude Code's `mcp__plugin_<plugin>_<server>__<tool>` shape. This does
// NOT auto-allow arbitrary tools by default — only the channel's own tools are
// unconditionally allowed (see isOwnTool); anything else is opt-in here.
//
//   TEAMS_AUTO_ALLOW=mcp__plugin_other_server__some_tool
const AUTO_ALLOW_PATTERNS = ((): string[] => {
  const raw = (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env?.TEAMS_AUTO_ALLOW
  return raw
    ? raw.split(',').map(s => s.trim()).filter(Boolean)
    : []
})()

function shouldAutoAllow(toolName: string): boolean {
  // The channel's own tools are always auto-approved.
  if (isOwnTool(toolName)) return true
  // Plus any extra tools the operator opted into via TEAMS_AUTO_ALLOW.
  return AUTO_ALLOW_PATTERNS.some(p => toolName === p || toolName.endsWith(p))
}

async function sendVerdict(request_id: string, behavior: 'allow' | 'deny'): Promise<void> {
  await mcp.notification({
    method: 'notifications/claude/channel/permission',
    params: { request_id, behavior },
  })
}

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  logErr(
    `permission_request request_id=${params.request_id} tool=${params.tool_name}`,
  )

  if (shouldAutoAllow(params.tool_name)) {
    logErr(`auto-allowing ${params.tool_name} (matches local TEAMS_AUTO_ALLOW)`)
    try {
      await sendVerdict(params.request_id, 'allow')
      logErr(`auto-allow ${params.request_id} verdict written to MCP transport`)
    } catch (err) {
      logErr(`auto-allow verdict failed: ${err}`)
    }
    return
  }

  try {
    const res = await fetch(`${SERVER_URL}/v1/proxy/permission/prompt`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
        'x-proxy-instance': INSTANCE,
      },
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      logErr(
        `permission relay HTTP ${res.status} for ${params.request_id}: ${detail.slice(0, 300)}`,
      )
      return
    }
    logErr(`permission ${params.request_id} relayed to platform`)
  } catch (err) {
    logErr(`permission relay network error: ${String(err)}`)
  }
})

function handleVerdict(data: string): void {
  try {
    const parsed = JSON.parse(data)
    const request_id = String(parsed.request_id ?? '')
    const behavior = String(parsed.behavior ?? '')
    if (!request_id || (behavior !== 'allow' && behavior !== 'deny')) {
      logErr(`bad verdict payload: ${data.slice(0, 200)}`)
      return
    }
    logErr(`verdict received request_id=${request_id} behavior=${behavior}`)
    mcp
      .notification({
        method: 'notifications/claude/channel/permission',
        params: { request_id, behavior },
      })
      .then(() => {
        logErr(`verdict ${request_id} written to MCP transport`)
      })
      .catch(err => {
        logErr(`verdict notify failed for ${request_id}: ${err}`)
      })
  } catch (err) {
    logErr(`bad verdict payload: ${err}; raw=${data.slice(0, 300)}`)
  }
}

// ── Inbound SSE → MCP channel notification ────────────────────────────────
//
// We parse SSE by hand on top of fetch() so the Authorization header
// reliably reaches the server. The protocol is dead simple: events are
// separated by a blank line; lines starting with `event:` set the type,
// `data:` lines accumulate into the payload, lines starting with `:` are
// comments (heartbeats), all else is ignored.

let reconnectAttempts = 0
let abortCtrl: AbortController | null = null
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
// If no bytes arrive (including heartbeats) within this many ms, treat
// the connection as dead. The server sends `: heartbeat\n\n` every 15 s,
// so 45 s means three consecutive heartbeats missed.
const STALL_TIMEOUT_MS = 45000
// TCP handshake + TLS + first byte timeout for the fetch call.
const CONNECT_TIMEOUT_MS = 10000
// Only log the first N reconnect attempts; after that, log every 5th.
const LOG_EVERY_N = 5

interface SseEvent {
  event: string
  data: string
}

function parseSseChunk(chunk: string): SseEvent | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const raw of chunk.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line) continue
    if (line.startsWith(':')) continue // comment / heartbeat
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }
  if (!dataLines.length) return null
  return { event, data: dataLines.join('\n') }
}

function handleTurn(data: string): void {
  try {
    const parsed = JSON.parse(data)
    const turn_id = String(parsed.turn_id ?? '')
    const content = String(parsed.content ?? '')
    const rawMeta = (parsed.meta && typeof parsed.meta === 'object') ? parsed.meta : {}
    if (!turn_id) {
      logErr(`turn event missing turn_id: ${data.slice(0, 200)}`)
      return
    }
    // Per the channels-reference contract, meta is Record<string, string> and
    // keys must match /^[A-Za-z0-9_]+$/. Coerce values to strings and drop
    // any key with hyphens or other non-identifier characters so Claude Code
    // doesn't silently discard the whole meta block.
    const meta: Record<string, string> = { turn_id }
    for (const [k, v] of Object.entries(rawMeta)) {
      if (!/^[A-Za-z0-9_]+$/.test(k)) continue
      if (v === undefined || v === null) continue
      meta[k] = typeof v === 'string' ? v : String(v)
    }
    logErr(`turn received turn_id=${turn_id} content_len=${content.length} meta_keys=${Object.keys(meta).join(',')}`)
    mcp
      .notification({
        method: 'notifications/claude/channel',
        params: { content, meta },
      })
      .then(() => {
        logErr(`turn ${turn_id} notification written to MCP transport`)
      })
      .catch(err => {
        logErr(`notification failed for ${turn_id}: ${err}`)
      })
  } catch (err) {
    logErr(`bad turn payload: ${err}; raw=${data.slice(0, 300)}`)
  }
}

function jitter(ms: number): number {
  // ±25% random jitter to avoid thundering herd after a deploy restart.
  return Math.round(ms * (0.75 + Math.random() * 0.5))
}

async function streamLoop(): Promise<void> {
  while (!shuttingDown) {
    abortCtrl = new AbortController()
    const url = `${SERVER_URL}/v1/proxy/stream?instance=${encodeURIComponent(INSTANCE)}`

    // Abort the fetch if the TCP handshake or TLS takes too long.
    const connectTimer = setTimeout(() => abortCtrl?.abort(), CONNECT_TIMEOUT_MS)

    try {
      const shouldLog = reconnectAttempts <= 3 || reconnectAttempts % LOG_EVERY_N === 0
      if (shouldLog) logErr(`connecting to ${url} (attempt ${reconnectAttempts || 'initial'})`)

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${API_KEY}`,
          accept: 'text/event-stream',
          'x-proxy-instance': INSTANCE,
        },
        signal: abortCtrl.signal,
      })
      clearTimeout(connectTimer)

      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        logErr(`stream HTTP ${res.status}: ${detail.slice(0, 200)}`)
        throw new Error(`HTTP ${res.status}`)
      }
      if (!res.body) {
        throw new Error('no response body')
      }

      reconnectAttempts = 0
      logErr('SSE connected; awaiting turn events')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let lastDataAt = Date.now()

      while (true) {
        // Race the read against a stall timer. If the server stops sending
        // (including its 15-s heartbeats), we abort and reconnect rather
        // than hang forever behind a dead socket.
        const stallTimer = setTimeout(() => {
          logErr('stall detected — no data in 45 s; aborting connection')
          abortCtrl?.abort()
        }, STALL_TIMEOUT_MS)

        let readResult: ReadableStreamReadResult<Uint8Array>
        try {
          readResult = await reader.read()
        } finally {
          clearTimeout(stallTimer)
        }

        const { value, done } = readResult
        if (done) {
          logErr('SSE upstream closed by server')
          break
        }

        lastDataAt = Date.now()
        buffer += decoder.decode(value, { stream: true })
        let sep = buffer.indexOf('\n\n')
        while (sep >= 0) {
          const chunk = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const ev = parseSseChunk(chunk)
          if (ev) {
            if (ev.event === 'turn') handleTurn(ev.data)
            else if (ev.event === 'verdict') handleVerdict(ev.data)
            else if (ev.event === 'ready') logErr('stream ready')
          }
          sep = buffer.indexOf('\n\n')
        }
      }
    } catch (err) {
      clearTimeout(connectTimer)
      if (shuttingDown) return
      const msg = String(err)
      // Only log non-abort errors at normal verbosity; aborts from the stall
      // guard or connect timeout were already logged.
      if (!msg.includes('abort')) logErr(`SSE error: ${msg}`)
    }

    if (shuttingDown) return
    reconnectAttempts += 1
    const rawDelay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttempts, 5),
    )
    const delay = jitter(rawDelay)
    const shouldLog = reconnectAttempts <= 3 || reconnectAttempts % LOG_EVERY_N === 0
    if (shouldLog) {
      logErr(`reconnecting in ${delay}ms (attempt ${reconnectAttempts})`)
    }
    await new Promise(r => setTimeout(r, delay).unref())
  }
}

// ── Shutdown ───────────────────────────────────────────────────────────────

let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  logErr('shutting down')
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, 'utf8'), 10)
      if (pid === process.pid) rmSync(PID_FILE)
    }
  } catch {
    /* ignore */
  }
  try {
    abortCtrl?.abort()
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(0), 1000).unref()
}

process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('SIGHUP', shutdown)

const bootPpid = process.ppid
setInterval(() => {
  const orphaned =
    (process.platform !== 'win32' && process.ppid !== bootPpid) ||
    process.stdin.destroyed ||
    process.stdin.readableEnded
  if (orphaned) shutdown()
}, 5000).unref()

// ── Boot ──────────────────────────────────────────────────────────────────

await mcp.connect(new StdioServerTransport())
logErr('MCP stdio connected')
void streamLoop()
