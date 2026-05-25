import { readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import packageJson from '../package.json' with { type: 'json' };
import { recordFromHook } from './hook-recorder.mjs';
import { recordRun } from './run-recorder.mjs';
import { regenerateReport } from './report.mjs';
import { loadPricingDb, updatePricingDb } from './pricing-db.mjs';
import { readJson } from './util.mjs';

const USAGE = `TokenTrace

Usage:
  tt run [--agent <name>] [--label <label>] -- <command...>
  tt report <run-dir>
  tt summarize                                 # shows ~/.tokentrace/runs/ (all hook-recorded sessions)
  tt summarize <runs-dir>                      # shows a specific directory
  tt serve                                     # open the web dashboard at http://localhost:7842
  tt hook stop
  tt install
  tt pricing update                            # fetch latest pricing from litellm and save to cache
  tt pricing show                              # print the current cached pricing table
  tt --version
  tt --help

Examples:
  tt install                                   # one-time setup: records every Claude Code session
  tt summarize                                 # see all your recorded sessions
  tt serve                                     # browse sessions in the local web dashboard
  tt run -- claude --output-format json -p "explain this repo"
  tt pricing update                            # refresh pricing from litellm
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

  if (command === 'serve') {
    return serveCommand(rest);
  }

  if (command === 'pricing') {
    return pricingCommand(rest);
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
    throw new Error('Usage: tt report <run-dir>');
  }

  const result = await regenerateReport(resolve(cwd, runDir));
  console.log(`Report written: ${result.reportPath}`);
  return 0;
}

async function summarizeCommand(args, cwd) {
  let runsDir;
  if (args[0]) {
    runsDir = resolve(cwd, args[0]);
  } else {
    const localRuns = join(cwd, '.tokentrace', 'runs');
    const globalRuns = join(homedir(), '.tokentrace', 'runs');
    try {
      await readdir(localRuns);
      runsDir = localRuns;
    } catch {
      runsDir = globalRuns;
    }
  }
  const entries = await readRunEntries(runsDir);
  if (entries.length === 0) {
    console.log('No runs found.');
    return 0;
  }

  for (const run of entries) {
    const tokens = run.usage?.total_tokens != null ? run.usage.total_tokens.toLocaleString() : '-';
    const cost = run.usage?.cost_usd != null ? `$${run.usage.cost_usd.toFixed(4)}` : '-';
    const changed = run.diff?.files_changed ?? '-';
    const status = run.exit_code === 0 ? 'ok' : `exit ${run.exit_code}`;
    console.log(`${run.id}\t${status}\ttokens=${tokens}\tcost=${cost}\tchanged=${changed}\t${run.command.join(' ')}`);
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
    process.stderr.write(`[tt] Recorded session: ${result.runDir}\n`);
  } catch (error) {
    process.stderr.write(`[tt] Hook error: ${error.message}\n`);
  }

  return 0;
}

async function installCommand(cwd) {
  const afrPath = fileURLToPath(new URL('../bin/tt.mjs', import.meta.url));
  const hookCommand = `node "${afrPath}" hook stop`;
  const settingsPath = join(process.env.HOME || '~', '.claude', 'settings.json');

  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  const stopHooks = settings.hooks?.Stop ?? [];
  const alreadyInstalled = stopHooks.some(
    matcher => matcher.hooks?.some(h => h.command?.includes('tokentrace') || h.command?.includes('tt.mjs'))
  );

  if (alreadyInstalled) {
    console.log('tokentrace Stop hook is already installed in ~/.claude/settings.json');
    return 0;
  }

  settings.hooks = settings.hooks ?? {};
  settings.hooks.Stop = [
    ...stopHooks,
    { hooks: [{ type: 'command', command: hookCommand }] }
  ];

  await writeFile(settingsPath, JSON.stringify(settings, null, 4) + '\n');
  console.log(`Installed tokentrace Stop hook → ${settingsPath}`);
  console.log('Every Claude Code session in any directory will now be recorded to .tokentrace/runs/');
  return 0;
}

async function serveCommand(_args) {
  const serverPath = fileURLToPath(new URL('../dashboard/server.mjs', import.meta.url));
  const PORT = 7842;
  const URL_TO_OPEN = `http://localhost:${PORT}`;

  const child = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    detached: false,
  });

  child.on('error', (err) => {
    process.stderr.write(`[tt] Failed to start dashboard server: ${err.message}\n`);
    process.exit(1);
  });

  // Give the server a moment to bind before opening the browser
  await new Promise(resolve => setTimeout(resolve, 800));

  const platform = process.platform;
  let openCmd;
  if (platform === 'darwin') {
    openCmd = 'open';
  } else if (platform === 'win32') {
    openCmd = 'start';
  } else {
    openCmd = 'xdg-open';
  }

  const opener = spawn(openCmd, [URL_TO_OPEN], { stdio: 'ignore', shell: platform === 'win32' });
  opener.on('error', () => {
    // Opening the browser is best-effort — not fatal
  });

  console.log(`tokentrace dashboard running at ${URL_TO_OPEN}`);
  console.log('Press Ctrl+C to stop.');

  await new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Dashboard server exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });

  return 0;
}

async function pricingCommand(args) {
  const sub = args[0];

  if (sub === 'update') {
    console.log('Fetching latest pricing from litellm...');
    const db = await updatePricingDb();
    const modelCount = Object.keys(db).length;
    console.log(`Updated pricing for ${modelCount} models → ~/.tokentrace/pricing.json`);
    return 0;
  }

  if (!sub || sub === 'show') {
    const db = await loadPricingDb();
    const entries = Object.entries(db);
    if (entries.length === 0) {
      console.log('No pricing data available.');
      return 0;
    }

    const colWidths = { model: 40, input: 10, output: 10, cacheWrite: 12, cacheRead: 10 };
    const pad = (str, w) => String(str ?? '—').padEnd(w);
    const header = [
      pad('Model', colWidths.model),
      pad('Input/M', colWidths.input),
      pad('Output/M', colWidths.output),
      pad('CacheWrite/M', colWidths.cacheWrite),
      pad('CacheRead/M', colWidths.cacheRead),
    ].join('  ');
    const divider = '-'.repeat(header.length);

    console.log(header);
    console.log(divider);

    const fmtPrice = (v) => v == null ? '—' : `$${v.toFixed(3)}`;

    for (const [modelId, p] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      const row = [
        pad(modelId, colWidths.model),
        pad(fmtPrice(p.input), colWidths.input),
        pad(fmtPrice(p.output), colWidths.output),
        pad(fmtPrice(p.cacheWrite), colWidths.cacheWrite),
        pad(fmtPrice(p.cacheRead), colWidths.cacheRead),
      ].join('  ');
      console.log(row);
    }

    return 0;
  }

  throw new Error(`Unknown pricing subcommand: ${sub}. Available: update, show`);
}

function parseRunArgs(args) {
  const commandStart = args.indexOf('--');
  if (commandStart === -1) {
    throw new Error('Usage: tt run [--agent <name>] [--label <label>] -- <command...>');
  }

  const flags = args.slice(0, commandStart);
  const command = args.slice(commandStart + 1);
  if (command.length === 0) {
    throw new Error('tt run requires a command after --');
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
      throw new Error(`Unknown tt run flag: ${flag}`);
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
