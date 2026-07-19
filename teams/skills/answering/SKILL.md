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

Whenever your message **asks the user for something they must act on** (a
decision, an approval, an answer), you **must** call `schedule_reminder` right
after sending it. This is not optional for a message that needs a response — if
the user goes quiet, the reminder is what nudges them.

- **Delay** — set `delay_seconds` based on how long the user likely needs to
  think it over, **between 3 and 10 minutes** (180–600 s):
  - a quick yes/no or an easy pick → ~180 s (3 min);
  - a choice that needs a little consideration → ~300 s (5 min);
  - a weightier decision they'll want to mull over → up to ~600 s (10 min).

  Never go below 3 minutes or above 10 minutes.
- Write the reminder text so it **stands alone** (they may read it later, out of
  context): e.g. `"Reminder: I still need your pick on the schema change — option A or B?"`
- **Don't stack duplicates** — at most one pending reminder per open question.
- Don't cancel it when they answer; the platform cancels pending reminders
  automatically on the user's next reply.

Do **not** schedule a reminder for messages that don't need a user response
(status updates, completed results, FYIs).
