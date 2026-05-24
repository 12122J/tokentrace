# Agent Flight Recorder Design

## Goal

Agent Flight Recorder is a local-first CLI that wraps coding-agent commands and
produces a portable, auditable run artifact. The first release answers five
questions for a single run:

- What command ran?
- What did it print?
- What changed in git?
- What verification ran, if detectable?
- How many tokens were used, when the agent exposes usage data?

## Product Shape

The first product is a zero-dependency Node.js CLI named `afr`.

Example:

```bash
afr run -- codex exec --json "explain this repo"
afr report .afr/runs/2026-05-24T120000Z-abc123
```

Each run writes a directory:

```text
.afr/runs/<run-id>/
  run.json
  events.jsonl
  transcript.txt
  diff.patch
  summary.md
  report.html
```

## Scope

The MVP includes:

- `afr run -- <command...>` command wrapper
- `afr report <run-dir>` static HTML report generator
- `afr summarize [runs-dir]` compact terminal summary
- git before/after metadata and patch capture
- stdout/stderr transcript capture
- JSONL event stream
- Codex JSON usage parsing
- generic shell fallback for every other command
- tests with Node's built-in test runner

The MVP excludes:

- hosted service
- auth
- cloud sync
- package publishing
- deep file-read tracing for agents that do not expose structured events
- system-wide process tracing

## Architecture

The CLI is split into focused modules:

- `bin/afr.mjs` is the executable entrypoint.
- `src/cli.mjs` parses arguments and routes commands.
- `src/run-recorder.mjs` owns child-process execution and artifact writing.
- `src/event-writer.mjs` writes newline-delimited event records.
- `src/git.mjs` reads git metadata and patches.
- `src/adapters/codex.mjs` parses Codex JSON output into normalized usage and
  tool events.
- `src/report.mjs` renders Markdown and HTML reports.
- `src/util.mjs` contains small shared helpers.

The run recorder does not depend on Codex. It accepts adapter output as
incremental observations. This keeps the core useful for Claude, OpenCode,
Cursor wrappers, plain shell commands, and CI.

## Data Model

`run.json` stores stable run metadata:

```json
{
  "id": "2026-05-24T120000Z-abc123",
  "schema_version": 1,
  "command": ["codex", "exec", "--json", "explain this repo"],
  "cwd": "/repo",
  "started_at": "2026-05-24T12:00:00.000Z",
  "completed_at": "2026-05-24T12:01:10.000Z",
  "exit_code": 0,
  "agent": "codex",
  "git": {
    "before": {"branch": "main", "commit": "abc123", "dirty": false},
    "after": {"branch": "main", "commit": "abc123", "dirty": true}
  },
  "usage": {"input_tokens": 1000, "output_tokens": 100, "total_tokens": 1100},
  "artifacts": {
    "events": "events.jsonl",
    "transcript": "transcript.txt",
    "diff": "diff.patch",
    "summary": "summary.md",
    "report": "report.html"
  }
}
```

`events.jsonl` stores chronological observations:

```json
{"type":"run.started","timestamp":"...","command":["codex","exec","--json"]}
{"type":"process.stdout","timestamp":"...","text":"..."}
{"type":"usage.tokens","timestamp":"...","input_tokens":1000,"output_tokens":100,"total_tokens":1100}
{"type":"git.diff","timestamp":"...","files_changed":2}
{"type":"run.completed","timestamp":"...","exit_code":0,"success":true}
```

## Error Handling

The wrapper should still write artifacts when the child command fails. A failed
agent run is useful evidence. `afr run` returns the child exit code after
finishing artifacts.

If git is unavailable or the current directory is not a git repository, the run
continues with `git.available = false` and an empty patch.

If Codex JSON parsing fails for a line, the line remains in `transcript.txt` and
the parser ignores it. No malformed agent output should crash the recorder.

## Testing

Tests cover:

- event writer appends valid JSONL
- Codex adapter extracts token usage from `turn.completed`
- git helpers degrade outside git repositories
- recorder creates expected artifacts for a simple shell command
- report renderer escapes HTML content

## First Release Criteria

The first release is ready when:

- `npm test` passes
- `node bin/afr.mjs run -- node -e "console.log('hello')"` creates artifacts
- `node bin/afr.mjs report <run-dir>` writes `report.html`
- README documents install-free local usage
- no external dependencies are required
