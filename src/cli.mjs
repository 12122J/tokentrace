import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../package.json' with { type: 'json' };
import { recordFromHook } from './hook-recorder.mjs';
import { recordRun } from './run-recorder.mjs';
import { regenerateReport } from './report.mjs';
import { readJson } from './util.mjs';

const USAGE = `Agent Flight Recorder

Usage:
  afr run [--agent <name>] [--label <label>] -- <command...>
  afr report <run-dir>
  afr summarize [runs-dir]
  afr hook stop
  afr install
  afr --version
  afr --help

Examples:
  afr run -- node -e "console.log('hello')"
  afr run -- claude --output-format json -p "explain this repo"
  afr install                                  # records every Claude Code session automatically
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

  if (command === 'hook') {
    return hookCommand(rest, cwd);
  }

  if (command === 'install') {
    return installCommand(cwd);
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

async function hookCommand(args, cwd) {
  const subcommand = args[0];
  if (subcommand !== 'stop') {
    throw new Error(`Unknown hook subcommand: ${subcommand}. Available: stop`);
  }

  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    // Claude Code didn't send valid JSON — nothing to record
    return 0;
  }

  const { session_id: sessionId, transcript_path: transcriptPath } = input;
  if (!sessionId || !transcriptPath) return 0;

  try {
    const result = await recordFromHook({ sessionId, transcriptPath, fallbackCwd: cwd });
    process.stderr.write(`[afr] Recorded session: ${result.runDir}\n`);
  } catch (error) {
    process.stderr.write(`[afr] Hook error: ${error.message}\n`);
  }

  return 0;
}

async function installCommand(cwd) {
  const afrPath = fileURLToPath(new URL('../bin/afr.mjs', import.meta.url));
  const hookCommand = `node ${afrPath} hook stop`;
  const settingsPath = join(process.env.HOME || '~', '.claude', 'settings.json');

  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  const stopHooks = settings.hooks?.Stop ?? [];
  const alreadyInstalled = stopHooks.some(
    matcher => matcher.hooks?.some(h => h.command?.includes('afr'))
  );

  if (alreadyInstalled) {
    console.log('afr Stop hook is already installed in ~/.claude/settings.json');
    return 0;
  }

  settings.hooks = settings.hooks ?? {};
  settings.hooks.Stop = [
    ...stopHooks,
    { hooks: [{ type: 'command', command: hookCommand }] }
  ];

  await writeFile(settingsPath, JSON.stringify(settings, null, 4) + '\n');
  console.log(`Installed afr Stop hook → ${settingsPath}`);
  console.log('Every Claude Code session in any directory will now be recorded to .afr/runs/');
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
