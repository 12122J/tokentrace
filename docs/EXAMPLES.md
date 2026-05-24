# Examples

These examples use the local checkout form:

```bash
node bin/afr.mjs <command>
```

After npm publication, replace `node bin/afr.mjs` with `afr`.

## Record A Shell Command

```bash
node bin/afr.mjs run -- node -e "console.log('hello from afr')"
```

Output:

```text
Recorded run: /path/to/repo/.afr/runs/<run-id>
```

Inspect it:

```bash
node bin/afr.mjs summarize
node bin/afr.mjs report .afr/runs/<run-id>
```

## Record A Codex Run

```bash
node bin/afr.mjs run --agent codex -- codex exec --json "summarize this repository"
```

When Codex emits a `turn.completed` JSON event with usage data, Agent Flight
Recorder adds a `usage.tokens` event and stores aggregate token usage in
`run.json`.

## Capture A Failed Run

```bash
node bin/afr.mjs run -- node -e "console.error('boom'); process.exit(2)"
```

The command exits with code `2`, and the recorder still writes all artifacts.
This is useful for debugging failed agent runs or CI reproductions.

## Share A Run Without Sharing The Whole Repo

The run directory is self-contained enough for review:

```text
.afr/runs/<run-id>/
  run.json
  events.jsonl
  transcript.txt
  diff.patch
  summary.md
  report.html
```

Before sharing, inspect `transcript.txt`, `diff.patch`, and `events.jsonl` for
private data. The recorder does not redact secrets yet.
