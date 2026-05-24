# Run Format

Agent Flight Recorder writes one directory per run under `.afr/runs`.

## Directory Layout

```text
.afr/runs/<run-id>/
  run.json
  events.jsonl
  transcript.txt
  diff.patch
  summary.md
  report.html
```

## `run.json`

`run.json` is the stable aggregate record.

```json
{
  "id": "2026-05-24T120000000Z-abc123",
  "schema_version": 1,
  "command": ["codex", "exec", "--json", "summarize this repository"],
  "cwd": "/path/to/repo",
  "agent": "codex",
  "label": null,
  "started_at": "2026-05-24T12:00:00.000Z",
  "completed_at": "2026-05-24T12:00:10.000Z",
  "duration_ms": 10000,
  "exit_code": 0,
  "success": true,
  "git": {
    "before": {
      "available": true,
      "branch": "main",
      "commit": "abc1234",
      "dirty": false,
      "status": []
    },
    "after": {
      "available": true,
      "branch": "main",
      "commit": "abc1234",
      "dirty": true,
      "status": [{"code": " M", "path": "README.md"}]
    }
  },
  "usage": {
    "input_tokens": 1000,
    "cached_input_tokens": 400,
    "output_tokens": 200,
    "reasoning_output_tokens": 50,
    "total_tokens": 1200
  },
  "tools": {
    "command_count": 1,
    "commands": [{"command": "npm test", "exit_code": 0}]
  },
  "files": {
    "read_count": 0,
    "reads": []
  },
  "diff": {
    "files_changed": 1
  },
  "artifacts": {
    "events": "events.jsonl",
    "transcript": "transcript.txt",
    "diff": "diff.patch",
    "summary": "summary.md",
    "report": "report.html"
  }
}
```

Fields may be `null` when an agent or environment does not expose the relevant
data. For example, generic shell commands usually have `usage: null`.

## `events.jsonl`

`events.jsonl` is chronological. Each line is one JSON object with `type` and
`timestamp`.

Common event types:

| Type | Meaning |
| --- | --- |
| `run.started` | Recorder started a wrapped command. |
| `process.stdout` | The child process wrote to stdout. |
| `process.stderr` | The child process wrote to stderr. |
| `usage.tokens` | An adapter observed token usage. |
| `tool.command` | An adapter observed a command/tool execution. |
| `file.read` | An adapter observed a file read. |
| `git.diff` | Recorder captured the final diff summary. |
| `run.completed` | The wrapped command exited and artifacts were finalized. |

## Versioning

The current schema version is `1`. Additive fields are allowed within a schema
version. Breaking changes should increment `schema_version`.
