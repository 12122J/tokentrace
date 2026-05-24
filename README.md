# Agent Flight Recorder

Open telemetry for coding-agent runs.

Agent Flight Recorder (`afr`) wraps coding agents and shell commands, then writes
a local trace you can inspect, share, diff, or attach to an issue. It is built
for developers who want to know what an agent did before they trust the result.

```bash
node bin/afr.mjs run -- codex exec --json "explain this repo"
node bin/afr.mjs summarize
node bin/afr.mjs report .afr/runs/<run-id>
```

## Why

Coding agents are becoming normal development tools, but most runs still vanish
into terminal scrollback. Agent Flight Recorder turns a run into an auditable
artifact:

- what command ran
- what it printed
- what changed in git
- what token usage was reported
- what trust warnings should be reviewed

The trace is local by default. No hosted service is required.

## Status

This project is early. The current release is a working MVP with:

- generic shell-command recording
- Codex JSON token-usage parsing
- git state and patch capture, including untracked text files
- static Markdown and HTML reports
- zero runtime dependencies

## Install

Until the package is published, run it from a checkout:

```bash
git clone https://github.com/12122J/agent-flight-recorder.git
cd agent-flight-recorder
npm test
node bin/afr.mjs --help
```

When installed globally from npm in the future, the same commands will use
`afr` directly:

```bash
afr run -- node -e "console.log('hello from afr')"
```

## Quick Start

Record a simple command:

```bash
node bin/afr.mjs run -- node -e "console.log('hello from afr')"
```

List recent runs:

```bash
node bin/afr.mjs summarize
```

Regenerate a report:

```bash
node bin/afr.mjs report .afr/runs/<run-id>
```

Record a Codex run with token usage:

```bash
node bin/afr.mjs run --agent codex -- codex exec --json "summarize this repository"
```

## Artifacts

Each run writes:

```text
.afr/runs/<run-id>/
  run.json        # stable metadata and aggregate observations
  events.jsonl    # chronological event stream
  transcript.txt  # stdout and stderr transcript
  diff.patch      # git patch captured after the run
  summary.md      # compact human-readable summary
  report.html     # standalone local report
```

See [docs/RUN_FORMAT.md](docs/RUN_FORMAT.md) for schema details and
[docs/EXAMPLES.md](docs/EXAMPLES.md) for example workflows.

## Trust Warnings

Reports call out conditions that deserve review:

- no token usage captured
- git metadata unavailable
- changed files with no recorded verification command
- non-zero command exit

Warnings are intentionally conservative. They are prompts to inspect, not proof
that a run is bad.

## Supported Adapters

| Adapter | Status | Notes |
| --- | --- | --- |
| Shell | Working | Records any command's transcript, exit code, git state, and diff. |
| Codex | Working MVP | Parses `turn.completed` usage from JSON output. |
| Claude Code | Planned | Targeting structured output/log parsing after the core trace format settles. |

## Development

```bash
npm run check
node bin/afr.mjs run -- node -e "console.log('sample')"
node bin/afr.mjs summarize
```

`npm run check` runs the test suite and `npm pack --dry-run` to verify the
package contents.

## Principles

- Local first: traces stay on your machine unless you share them.
- Agent neutral: the core format should work across tools.
- Portable: artifacts are plain JSON, JSONL, Markdown, HTML, and patch files.
- Honest: failed runs still produce artifacts.
- Small core: adapters add intelligence without making the recorder agent-specific.

## Contributing

Contributions are welcome once the project is public. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), and please keep new features grounded in
portable traces rather than hosted assumptions.

## License

MIT
