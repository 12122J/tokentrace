# Agent Flight Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first shippable local CLI for recording coding-agent runs into portable artifacts.

**Architecture:** A zero-dependency Node.js ESM CLI wraps any command, records process output and git metadata, parses Codex JSON usage when present, and renders Markdown/HTML reports. Core recording is agent-agnostic; adapters add optional structured observations.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in `child_process`, built-in `fs/promises`, git CLI.

---

## File Structure

- Create `package.json`: package metadata, bin mapping, test scripts.
- Create `bin/afr.mjs`: executable entrypoint.
- Create `src/cli.mjs`: argument parsing and command routing.
- Create `src/run-recorder.mjs`: run execution and artifact orchestration.
- Create `src/event-writer.mjs`: JSONL event writer.
- Create `src/git.mjs`: git snapshot and diff helpers.
- Create `src/adapters/codex.mjs`: Codex JSON line parser.
- Create `src/report.mjs`: summary and HTML report renderer.
- Create `src/util.mjs`: shared helpers.
- Create `tests/*.test.mjs`: focused unit and integration tests.
- Create `README.md`: usage and artifact documentation.
- Create `LICENSE`: MIT license.

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `bin/afr.mjs`
- Create: `src/cli.mjs`
- Create: `src/util.mjs`
- Create: `README.md`
- Create: `LICENSE`

- [ ] **Step 1: Add package metadata**

Create `package.json` with:

```json
{
  "name": "agent-flight-recorder",
  "version": "0.1.0",
  "description": "Open telemetry for coding-agent runs.",
  "type": "module",
  "bin": {
    "afr": "./bin/afr.mjs"
  },
  "scripts": {
    "test": "node --test",
    "check": "npm test"
  },
  "engines": {
    "node": ">=20"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Add executable entrypoint**

Create `bin/afr.mjs`:

```js
#!/usr/bin/env node
import { main } from '../src/cli.mjs';

main(process.argv.slice(2)).catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 3: Add utility helpers**

Create `src/util.mjs` with `nowIso`, `makeRunId`, `ensureDir`, `readJson`, `writeJson`, and `escapeHtml`.

- [ ] **Step 4: Add initial CLI router**

Create `src/cli.mjs` with `run`, `report`, `summarize`, and `help` command routing.

- [ ] **Step 5: Run scaffold check**

Run: `node bin/afr.mjs --help`

Expected: usage text and exit code 0.

### Task 2: Event Writer and Codex Adapter

**Files:**
- Create: `src/event-writer.mjs`
- Create: `src/adapters/codex.mjs`
- Create: `tests/event-writer.test.mjs`
- Create: `tests/codex-adapter.test.mjs`

- [ ] **Step 1: Write event writer tests**

Test that `EventWriter.write()` appends JSON objects with timestamps to `events.jsonl`.

- [ ] **Step 2: Implement event writer**

Implement an append-only writer with `write(type, data)` and `close()`.

- [ ] **Step 3: Write Codex adapter tests**

Test extraction from a JSON line shaped like:

```json
{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":3}}
```

Expected normalized event:

```json
{"type":"usage.tokens","input_tokens":10,"cached_input_tokens":4,"output_tokens":3,"total_tokens":13}
```

- [ ] **Step 4: Implement Codex adapter**

Implement `parseCodexJsonLine(line)` and `observeCodexLine(line)`.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/event-writer.test.mjs tests/codex-adapter.test.mjs`

Expected: all tests pass.

### Task 3: Git Helpers

**Files:**
- Create: `src/git.mjs`
- Create: `tests/git.test.mjs`

- [ ] **Step 1: Write git helper tests**

Test that `getGitSnapshot()` returns `{available:false}` outside a git repo and
that `countPatchFiles()` counts changed files from a small patch string.

- [ ] **Step 2: Implement git helpers**

Implement `getGitSnapshot(cwd)`, `getGitDiff(cwd)`, and `countPatchFiles(patch)`.

- [ ] **Step 3: Run focused tests**

Run: `node --test tests/git.test.mjs`

Expected: all tests pass.

### Task 4: Run Recorder

**Files:**
- Create: `src/run-recorder.mjs`
- Create: `tests/run-recorder.test.mjs`
- Modify: `src/cli.mjs`

- [ ] **Step 1: Write run recorder integration test**

Run a child process:

```bash
node -e "console.log('hello from afr')"
```

Assert that `run.json`, `events.jsonl`, `transcript.txt`, `summary.md`, and
`report.html` exist.

- [ ] **Step 2: Implement run recorder**

Implement `recordRun({ command, cwd, runsRoot })` using `spawn`, transcript
capture, Codex observation, git snapshots, patch capture, summary rendering, and
HTML rendering.

- [ ] **Step 3: Wire `afr run`**

Update `src/cli.mjs` so `afr run -- <command...>` calls `recordRun()` and prints
the run directory.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/run-recorder.test.mjs`

Expected: all tests pass.

### Task 5: Reports and Summary Command

**Files:**
- Create: `src/report.mjs`
- Create: `tests/report.test.mjs`
- Modify: `src/cli.mjs`

- [ ] **Step 1: Write report tests**

Test that generated HTML escapes script tags and includes command, exit code,
usage, and diff summary.

- [ ] **Step 2: Implement report renderer**

Implement `renderSummaryMarkdown(run)` and `renderHtmlReport(run, transcript, patch, events)`.

- [ ] **Step 3: Wire `afr report` and `afr summarize`**

`afr report <run-dir>` regenerates `summary.md` and `report.html`.

`afr summarize [runs-dir]` lists recent runs with id, command, exit code, token
total, and changed-file count.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/report.test.mjs`

Expected: all tests pass.

### Task 6: Documentation and Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document usage**

Add commands for local development:

```bash
npm test
node bin/afr.mjs run -- node -e "console.log('hello')"
node bin/afr.mjs summarize
node bin/afr.mjs report .afr/runs/<run-id>
```

- [ ] **Step 2: Run full verification**

Run: `npm run check`

Expected: all tests pass.

- [ ] **Step 3: Run a sample recording**

Run: `node bin/afr.mjs run -- node -e "console.log('hello from afr')"`

Expected: output includes `.afr/runs/<run-id>`.

- [ ] **Step 4: Regenerate the report for the sample**

Run: `node bin/afr.mjs report .afr/runs/<run-id>`

Expected: output includes `report.html`.

## Self-Review

- Spec coverage: The plan covers CLI wrapper, run format, event schema, Codex
  usage parsing, git metadata, reports, tests, and README.
- Placeholder scan: No `TBD`, `TODO`, or undefined future tasks remain.
- Type consistency: The plan consistently uses ESM modules and the same function
  names across tasks.
