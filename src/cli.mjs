import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import packageJson from '../package.json' with { type: 'json' };
import { recordFromHook } from './hook-recorder.mjs';
import { recordRun } from './run-recorder.mjs';
import { regenerateReport } from './report.mjs';
import { loadPricingDb, updatePricingDb } from './pricing-db.mjs';
import { ensureDir, readJson } from './util.mjs';
import { watchOnce } from './codex-watcher.mjs';

const execFileAsync = promisify(execFile);

const USAGE = `TokenTrace

Usage:
  tt run [--agent <name>] [--label <label>] -- <command...>
  tt report <run-dir>
  tt summarize                                 # shows ~/.tokentrace/runs/ (all hook-recorded sessions)
  tt summarize <runs-dir>                      # shows a specific directory
  tt serve                                     # start the dashboard server and open it in the browser
  tt stop                                      # stop a running dashboard server
  tt hook stop
  tt install                                   # one-time setup for all automatic recording
  tt watch-codex [--once]                      # process completed Codex Desktop sessions
  tt pricing update                            # fetch latest pricing from litellm and save to cache
  tt pricing show                              # print the current cached pricing table
  tt --version
  tt --help

Examples:
  tt install                                   # sets up Claude Code hook + Codex shim + Desktop watcher
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

  if (command === 'stop') {
    return stopCommand();
  }

  if (command === 'pricing') {
    return pricingCommand(rest);
  }

  if (command === 'watch-codex') {
    return watchCodexCommand(rest);
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

async function installCommand(_cwd) {
  const ttPath = fileURLToPath(new URL('../bin/tt.mjs', import.meta.url));
  const nodePath = process.execPath;
  let anyNew = false;

  // 1. Claude Code Stop hook (Claude Code CLI + Desktop — both read ~/.claude/settings.json)
  const hookInstalled = await installClaudeCodeHook(ttPath);
  if (hookInstalled) {
    console.log('✓ Claude Code hook installed → ~/.claude/settings.json');
    console.log('  Claude Code CLI and Desktop sessions will now be recorded automatically.');
    anyNew = true;
  } else {
    console.log('✓ Claude Code hook already installed.');
  }

  // 2. Codex CLI shell shim
  const shimResult = await installCodexCliShim(ttPath, nodePath);
  if (shimResult.installed) {
    console.log(`✓ Codex CLI shim installed → ${shimResult.file}`);
    console.log('  Restart your shell (or run: source ' + shimResult.file + ')');
    console.log('  After that, plain `codex exec "..."` will be recorded automatically.');
    anyNew = true;
  } else if (shimResult.alreadyInstalled) {
    console.log('✓ Codex CLI shim already installed.');
  } else {
    console.log(`  Codex CLI shim skipped: ${shimResult.reason}`);
  }

  // 3. Codex Desktop watcher (macOS LaunchAgent)
  if (platform() === 'darwin') {
    const watcherResult = await installCodexDesktopWatcher(ttPath, nodePath);
    if (watcherResult.installed) {
      console.log(`✓ Codex Desktop watcher installed → ${watcherResult.plistPath}`);
      console.log('  Codex Desktop sessions will be recorded every 30 seconds in the background.');
      anyNew = true;
    } else if (watcherResult.alreadyInstalled) {
      console.log('✓ Codex Desktop watcher already installed.');
    } else {
      console.log(`  Codex Desktop watcher skipped: ${watcherResult.reason}`);
    }
  }

  if (!anyNew) {
    console.log('\nAll integrations already installed. Nothing to do.');
  } else {
    console.log('\nRun `tt summarize` to see your recorded sessions.');
  }

  return 0;
}

async function installClaudeCodeHook(ttPath) {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  } catch {
    // start fresh
  }

  const stopHooks = settings.hooks?.Stop ?? [];
  const alreadyInstalled = stopHooks.some(
    m => m.hooks?.some(h => h.command?.includes('tokentrace') || h.command?.includes('tt.mjs'))
  );
  if (alreadyInstalled) return false;

  settings.hooks = settings.hooks ?? {};
  settings.hooks.Stop = [
    ...stopHooks,
    { hooks: [{ type: 'command', command: `${nodePath} "${ttPath}" hook stop` }] },
  ];
  await ensureDir(dirname(settingsPath));
  await writeFile(settingsPath, JSON.stringify(settings, null, 4) + '\n');
  return true;
}

async function installCodexCliShim(ttPath, nodePath) {
  // Find the real codex binary before writing the shim
  let realCodexPath;
  try {
    const { stdout } = await execFileAsync('which', ['codex']);
    realCodexPath = stdout.trim();
  } catch {
    return { installed: false, alreadyInstalled: false, reason: 'codex not found in PATH' };
  }
  if (!realCodexPath) {
    return { installed: false, alreadyInstalled: false, reason: 'codex not found in PATH' };
  }

  const shimBlock = `
# TokenTrace Codex CLI shim — added by tt install
__TOKENTRACE_REAL_CODEX="${realCodexPath}"
codex() { "${nodePath}" "${ttPath}" run --agent codex -- "$__TOKENTRACE_REAL_CODEX" "$@"; }
# end TokenTrace Codex CLI shim`;

  // Try ~/.zshrc first, fall back to ~/.bashrc
  const candidates = [join(homedir(), '.zshrc'), join(homedir(), '.bashrc')];
  let targetFile = null;

  for (const candidate of candidates) {
    try {
      const content = await readFile(candidate, 'utf8');
      if (content.includes('TokenTrace Codex CLI shim')) {
        return { installed: false, alreadyInstalled: true, file: candidate };
      }
      if (targetFile === null) targetFile = candidate;
    } catch {
      if (targetFile === null) targetFile = candidate;
    }
  }

  if (!targetFile) {
    return { installed: false, alreadyInstalled: false, reason: 'no .zshrc or .bashrc found' };
  }

  let existing = '';
  try { existing = await readFile(targetFile, 'utf8'); } catch { /* new file */ }
  await writeFile(targetFile, existing + shimBlock + '\n');
  return { installed: true, file: targetFile };
}

async function installCodexDesktopWatcher(ttPath, nodePath) {
  const label = 'io.tokentrace.codex-watcher';
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const logPath = join(homedir(), '.tokentrace', 'codex-watcher.log');

  // Check if already installed
  let existing = '';
  try { existing = await readFile(plistPath, 'utf8'); } catch { /* not installed */ }
  if (existing.includes('io.tokentrace.codex-watcher')) {
    return { installed: false, alreadyInstalled: true, plistPath };
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${ttPath}</string>
    <string>watch-codex</string>
    <string>--once</string>
  </array>
  <key>StartInterval</key>
  <integer>30</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;

  await ensureDir(dirname(plistPath));
  await ensureDir(dirname(logPath));
  await writeFile(plistPath, plist);

  try {
    await execFileAsync('launchctl', ['load', plistPath]);
  } catch {
    // Might already be loaded — try reload
    try {
      await execFileAsync('launchctl', ['unload', plistPath]);
      await execFileAsync('launchctl', ['load', plistPath]);
    } catch {
      // Non-fatal — plist is written, user can load manually
    }
  }

  return { installed: true, plistPath };
}

async function watchCodexCommand(args) {
  const once = args.includes('--once') || args.includes('--daemon');
  const count = await watchOnce({ verbose: true });
  if (once || args.length === 0) {
    if (count === 0) {
      process.stderr.write('[tt] No new Codex Desktop sessions to record.\n');
    } else {
      process.stderr.write(`[tt] Recorded ${count} new Codex Desktop session${count === 1 ? '' : 's'}.\n`);
    }
    return 0;
  }
  return 0;
}

const PID_FILE = join(homedir(), '.tokentrace', 'dashboard.pid');

async function isPortInUse(port) {
  const { createServer } = await import('node:net');
  return new Promise(resolve => {
    const s = createServer().listen(port, '127.0.0.1');
    s.on('listening', () => { s.close(); resolve(false); });
    s.on('error', () => resolve(true));
  });
}

async function serveCommand(_args) {
  const PORT = 7842;
  const URL_TO_OPEN = `http://localhost:${PORT}`;

  // If something is already on the port (regardless of PID file), just open the browser
  if (await isPortInUse(PORT)) {
    console.log(`tokentrace dashboard already running at ${URL_TO_OPEN}`);
    console.log('Run `tt stop` to stop it.');
    const plt = process.platform;
    const openCmd = plt === 'darwin' ? 'open' : plt === 'win32' ? 'start' : 'xdg-open';
    spawn(openCmd, [URL_TO_OPEN], { stdio: 'ignore', shell: plt === 'win32' }).on('error', () => {});
    return 0;
  }

  const serverPath = fileURLToPath(new URL('../dashboard/server.mjs', import.meta.url));

  const child = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    detached: false,
  });

  child.on('error', (err) => {
    process.stderr.write(`[tt] Failed to start dashboard server: ${err.message}\n`);
    process.exit(1);
  });

  await ensureDir(join(homedir(), '.tokentrace'));
  await writeFile(PID_FILE, String(child.pid));

  child.on('exit', () => {
    writeFile(PID_FILE, '').catch(() => {});
  });

  // Give the server a moment to bind before opening the browser
  await new Promise(resolve => setTimeout(resolve, 800));

  const plt = process.platform;
  const openCmd = plt === 'darwin' ? 'open' : plt === 'win32' ? 'start' : 'xdg-open';
  const opener = spawn(openCmd, [URL_TO_OPEN], { stdio: 'ignore', shell: plt === 'win32' });
  opener.on('error', () => {});

  console.log(`tokentrace dashboard running at ${URL_TO_OPEN}`);
  console.log('Run `tt stop` to stop it.');

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

async function stopCommand() {
  const PORT = 7842;

  // Try PID file first
  let stoppedViaPid = false;
  try {
    const pid = parseInt(await readFile(PID_FILE, 'utf8'), 10);
    if (pid) {
      process.kill(pid, 'SIGTERM');
      await writeFile(PID_FILE, '');
      console.log(`tokentrace dashboard stopped (pid ${pid}).`);
      stoppedViaPid = true;
    }
  } catch { /* pid file missing or process already gone */ }

  if (stoppedViaPid) return 0;

  // Fallback: find whatever is on the port via lsof (macOS/Linux)
  try {
    const { execSync } = await import('node:child_process');
    const raw = execSync(`lsof -ti :${PORT}`, { encoding: 'utf8' }).trim();
    if (raw) {
      for (const pid of raw.split('\n').map(Number).filter(Boolean)) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      }
      await writeFile(PID_FILE, '').catch(() => {});
      console.log(`tokentrace dashboard stopped (port ${PORT}).`);
      return 0;
    }
  } catch { /* lsof not available or nothing on port */ }

  console.log('No running tokentrace dashboard found.');
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
