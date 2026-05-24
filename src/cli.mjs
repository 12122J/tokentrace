import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import packageJson from '../package.json' with { type: 'json' };
import { recordRun } from './run-recorder.mjs';
import { regenerateReport } from './report.mjs';
import { readJson } from './util.mjs';

const USAGE = `Agent Flight Recorder

Usage:
  afr run [--agent <name>] [--label <label>] -- <command...>
  afr report <run-dir>
  afr summarize [runs-dir]
  afr --version
  afr --help

Examples:
  afr run -- node -e "console.log('hello')"
  afr run --agent codex -- codex exec --json "explain this repo"
  afr summarize
`;

export async function main(argv, options = {}) {
  const cwd = options.cwd || process.cwd();
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE.trimEnd());
    return 0;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(packageJson.version);
    return 0;
  }

  if (command === 'run') {
    return runCommand(rest, cwd);
  }

  if (command === 'report') {
    return reportCommand(rest, cwd);
  }

  if (command === 'summarize') {
    return summarizeCommand(rest, cwd);
  }

  throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
}

async function runCommand(args, cwd) {
  const parsed = parseRunArgs(args);
  const result = await recordRun({
    command: parsed.command,
    cwd,
    agent: parsed.agent,
    label: parsed.label
  });

  console.log(`Recorded run: ${result.runDir}`);
  process.exitCode = result.exitCode;
  return result.exitCode;
}

async function reportCommand(args, cwd) {
  const runDir = args[0];
  if (!runDir) {
    throw new Error('Usage: afr report <run-dir>');
  }

  const result = await regenerateReport(resolve(cwd, runDir));
  console.log(`Report written: ${result.reportPath}`);
  return 0;
}

async function summarizeCommand(args, cwd) {
  const runsDir = resolve(cwd, args[0] || '.afr/runs');
  const entries = await readRunEntries(runsDir);
  if (entries.length === 0) {
    console.log('No runs found.');
    return 0;
  }

  for (const run of entries) {
    const tokens = run.usage?.total_tokens ?? '-';
    const changed = run.diff?.files_changed ?? '-';
    const status = run.exit_code === 0 ? 'ok' : `exit ${run.exit_code}`;
    console.log(`${run.id}\t${status}\ttokens=${tokens}\tchanged=${changed}\t${run.command.join(' ')}`);
  }

  return 0;
}

function parseRunArgs(args) {
  const commandStart = args.indexOf('--');
  if (commandStart === -1) {
    throw new Error('Usage: afr run [--agent <name>] [--label <label>] -- <command...>');
  }

  const flags = args.slice(0, commandStart);
  const command = args.slice(commandStart + 1);
  if (command.length === 0) {
    throw new Error('afr run requires a command after --');
  }

  let agent = 'auto';
  let label = null;
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === '--agent') {
      agent = flags[index + 1];
      index += 1;
    } else if (flag === '--label') {
      label = flags[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown afr run flag: ${flag}`);
    }
  }

  return { agent, command, label };
}

async function readRunEntries(runsDir) {
  let names;
  try {
    names = await readdir(runsDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const runs = [];
  for (const name of names.sort().reverse()) {
    try {
      runs.push(await readJson(join(runsDir, name, 'run.json')));
    } catch {
      // Ignore incomplete run directories in summaries.
    }
  }
  return runs;
}
