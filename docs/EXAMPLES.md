# Examples

## Record A Shell Command

```bash
tt run -- node -e "console.log('hello from tokentrace')"
```

Output:

```text
Recorded run: /path/to/repo/.tokentrace/runs/<run-id>
```

Inspect it:

```bash
tt summarize
tt report .tokentrace/runs/<run-id>
```

## Record A Claude Code Run

```bash
tt run -- claude --output-format json -p "summarize this repository"
```

Token usage and cost are captured from the result event and stored in `run.json`.

## Record A Codex Run

```bash
tt run --agent codex -- codex exec --json "summarize this repository"
```

When Codex emits a `turn.completed` JSON event with usage data, TokenTrace
adds a `usage.tokens` event and stores aggregate token usage in `run.json`.

## Capture A Failed Run

```bash
tt run -- node -e "console.error('boom'); process.exit(2)"
```

The command exits with code `2`, and the recorder still writes all artifacts.
Useful for debugging failed agent runs or CI reproductions.

## Share A Run Without Sharing The Whole Repo

The run directory is self-contained:

```text
.tokentrace/runs/<run-id>/
  run.json
  events.jsonl
  transcript.txt
  diff.patch
  summary.md
  report.html
```

Before sharing, inspect `transcript.txt`, `diff.patch`, and `events.jsonl` for
private data. The recorder does not redact secrets yet.

## Auto-Record Every Claude Code Session

```bash
tt install
```

Adds a Stop hook to `~/.claude/settings.json`. Every session is recorded
automatically to `~/.tokentrace/runs/` when it ends.

## Browse Sessions In The Dashboard

```bash
tt serve
```

The dashboard opens at `http://localhost:7842` and shows cost over time,
session labels, model names, token totals, transcripts, diffs, and per-session
pricing breakdowns.

## Refresh Model Pricing

```bash
tt pricing update
tt pricing show
```

TokenTrace caches model pricing in `~/.tokentrace/pricing.json`. The bundled
fallback covers common Claude and OpenAI models, while `tt pricing update`
refreshes from LiteLLM's public pricing database.

## Label A Session

Open the dashboard with `tt serve`, select a session, then click `+ add label`.
Labels are saved back into that session's `run.json`.
