---
name: answering
description: How to answer Teams channel messages — choose a single reply for simple requests vs. a staged plan/mid-report/result across multiple messages for multi-stage work, and schedule a durable reminder when you ask the user something that needs an answer. Use whenever you are composing a reply to a <channel source="teams"> turn.
---

# Answering Teams channel turns

Teams messages reach you as `<channel source="teams" turn_id="...">` tags. You
answer through this plugin's MCP tools. This skill covers **how many messages to
send** and **when to set a reminder**.

## Tools you use

- **`reply`** — closes the turn. Pass the `turn_id` from the tag and your text.
  Call it **exactly once per turn, last**.
- **`say`** — sends an interim, out-of-turn message. Use it for staged updates
  *before* the final `reply`. Does not need a `turn_id` and does not close the
  turn.
- **`schedule_reminder`** — schedules a durable nudge (delivered even if this
  session ends). Use when you asked the user something and want to remind them
  if they go quiet.
- **`cancel_reminder`** — cancels a scheduled reminder (usually unnecessary; a
  reminder is auto-cancelled when the user next replies).

## One message or many?

**Default to a single `reply`.** Most requests — a question, a small fix, a
lookup — should be one message.

**Split into multiple messages only when the request is genuinely multi-stage**
and the user benefits from seeing progress, for example:

- they explicitly ask you to plan first, then execute;
- the work has clear phases and will take a while (so silence would be
  confusing);
- an early result (a plan, a finding) is useful on its own before the rest.

When you split, a good shape is:

1. `say("Plan: …")` — what you're about to do.
2. `say("… mid-report / progress …")` — one or a few updates as you go.
3. `reply(turn_id, "Result: …")` — the outcome, which closes the turn.

Keep interim messages **few and meaningful**. Do not narrate every step or send
a message per tool call — that spams the user. If in doubt, prefer fewer
messages. Never call `reply` more than once; use `say` for everything before the
final `reply`.

## When to schedule a reminder

If your message **asks the user for something they need to act on** (a decision,
an approval, an answer) and it would matter if they forget, call
`schedule_reminder` after sending it:

- Pick a sensible delay with `delay_seconds` (e.g. 1800 for 30 minutes) or an
  absolute `remind_at` (ISO-8601 UTC).
- Write the reminder text so it stands alone (the user may see it much later):
  e.g. `"Reminder: I still need your pick on the schema change (option A or B)."`
- **Don't stack duplicates** — schedule at most one reminder per open question.
- You don't need to cancel it when the user answers; the platform cancels
  pending reminders automatically on their next reply.

Do **not** schedule a reminder for messages that don't need a user response
(status updates, completed results, FYIs).
