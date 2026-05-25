# Agent Flight Recorder

Know what your coding agent actually did.

`afr` wraps any agent run and writes a local trace — transcript, git diff, token
usage, trust warnings — as plain files you can inspect, share, or attach to a PR.
No hosted service. No signup. Zero runtime dependencies.

```bash
npm install -g agent-flight-recorder
afr install
# every Claude Code session is now automatically recorded

afr summarize
# 2026-05-24   ok   tokens=10,215,677   cost=$4.1020   changed=3   claude
```

## Why

Agent runs disappear into terminal scrollback. You either trust the result or
you don't, with nothing in between. `afr` gives you the evidence:

- what command ran and whether it succeeded
- the full stdout/stderr transcript
- what changed in git, as a patch
- how many tokens were used and what it cost
- trust warnings for runs that look incomplete

The trace stays on your machine. You decide what to share.

## Use Cases

**Track what you're actually spending.** Claude Code sessions can quietly run up large token counts. `afr summarize` gives you a line per session — tokens, files changed, date — so you can see where your usage goes.

```
2026-05-24   ok   tokens=10,215,677   cost=$4.1020   changed=3   claude
2026-05-23   ok   tokens=4,302,819    cost=$1.7231   changed=7   claude
2026-05-22   ok   tokens=892,041      changed=0   claude
```

**Attach evidence to a PR.** When an agent writes or refactors code, reviewers are often asked to trust the result blindly. Drop `summary.md` or `diff.patch` into the PR description so reviewers can see the transcript and what actually changed.

**Debug a session that went wrong.** If an agent made unexpected changes or exited badly, the transcript and diff tell you exactly what happened — without relying on terminal scrollback that's already gone.

**Spot sessions that need a second look.** Trust warnings flag sessions where files changed but no tests ran, or where token usage is missing. A quick `afr summarize` shows you which sessions are worth reviewing before you ship.

## Getting Started

```bash
npm install -g agent-flight-recorder
afr install
```

`afr install` adds a Stop hook to `~/.claude/settings.json`. From that point on, every Claude Code session is automatically recorded when you close it — no changes to how you work.

After your next Claude Code session:

```bash
afr summarize
```

```
2026-05-24T08:04Z   ok   tokens=10215677   changed=3   claude
```

Open the full report:

```bash
open ~/.afr/runs/<session-id>/report.html
```

Sessions are stored in `~/.afr/runs/` — one folder per session, named by session ID.

## Automatic Recording via Hooks

`afr install` registers a Stop hook with Claude Code. Every interactive session is recorded automatically when it ends — token usage, git diff, full transcript, tool calls.

```bash
npm install -g agent-flight-recorder
afr install
# Installed afr Stop hook → ~/.claude/settings.json
# Every Claude Code session will now be recorded to ~/.afr/runs/
```

To see all recorded sessions:

```bash
node bin/afr.mjs summarize
# 2026-05-24T08:22Z   ok   tokens=10215677   changed=3   claude
# 2026-05-23T14:11Z   ok   tokens=4302819    changed=7   claude
```

To open the HTML report for a session:

```bash
open ~/.afr/runs/<session-id>/report.html
```

To uninstall, remove the afr entry from the `hooks.Stop` array in `~/.claude/settings.json`.

## What You Get

Each run writes six files:

```
.afr/runs/<run-id>/
  run.json        # structured metadata: command, exit code, usage, git state
  events.jsonl    # chronological event stream
  transcript.txt  # full stdout and stderr
  diff.patch      # git patch captured after the run
  summary.md      # human-readable summary
  report.html     # standalone HTML report, openable offline
```

Example `summary.md`:

```markdown
**Command**: `claude --output-format json -p "list the files in this repo"`
**Duration**: 13.33s
**Exit Code**: 0
**Total Tokens**: 66289
**Files Changed**: 0
```

See [docs/RUN_FORMAT.md](docs/RUN_FORMAT.md) for full schema details.

## Supported Adapters

| Adapter | Status | Notes |
| --- | --- | --- |
| Shell | Working | Any command — transcript, exit code, git state, diff. |
| Claude Code | Working | Parses token usage and tool calls from `--output-format json` / `stream-json`. |
| Codex | Working | Parses `turn.completed` usage from JSON output. |

**Claude Code** (auto-detected when running `claude`):

```bash
# Tokens + cost captured from the result event
node bin/afr.mjs run -- claude --output-format json -p "your prompt"

# Also captures individual Bash and file tool calls
node bin/afr.mjs run -- claude --output-format stream-json -p "your prompt"
```

**Codex:**

```bash
node bin/afr.mjs run -- codex exec --json "your prompt"
```

**Any shell command** (no token usage, but transcript + git diff still recorded):

```bash
node bin/afr.mjs run -- npm test
node bin/afr.mjs run -- ./scripts/deploy.sh
```

## Trust Warnings

Reports flag runs that deserve a second look:

- no token usage captured
- git metadata unavailable
- files changed with no recorded verification command
- non-zero exit code

Warnings are conservative — they prompt inspection, not rejection.

## Status

Working MVP. All three adapters are tested and verified against real runs.
Available on npm: `npm install -g agent-flight-recorder`

## Principles

- **Local first** — traces stay on your machine unless you share them.
- **Agent neutral** — the format works across tools.
- **Portable** — plain JSON, JSONL, Markdown, HTML, and patch files.
- **Honest** — failed runs still produce artifacts.
- **Small core** — adapters add intelligence without coupling the recorder to any one agent.

## Development

```bash
npm run check   # runs tests + npm pack --dry-run
node bin/afr.mjs run -- node -e "console.log('sample')"
node bin/afr.mjs summarize
```

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and
keep new features grounded in portable traces rather than hosted assumptions.

## License

MIT
