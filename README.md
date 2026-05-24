# Agent Flight Recorder

Open telemetry for coding-agent runs.

Agent Flight Recorder (`afr`) wraps a command, captures what happened, and writes
portable artifacts that make agent work easier to inspect, compare, and trust.

## Local Usage

```bash
npm test
node bin/afr.mjs run -- node -e "console.log('hello from afr')"
node bin/afr.mjs summarize
node bin/afr.mjs report .afr/runs/<run-id>
```

Each run writes:

```text
.afr/runs/<run-id>/
  run.json
  events.jsonl
  transcript.txt
  diff.patch
  summary.md
  report.html
```

## What It Records

- command, cwd, timestamps, exit code, and duration
- stdout and stderr transcript
- git branch, commit, dirty state, and patch when available
- token usage from Codex JSON output when available
- a static HTML report for quick inspection

## Design Principle

The trace is the product. Any coding-agent run should be able to leave behind a
small, local, auditable artifact without needing a hosted service.
