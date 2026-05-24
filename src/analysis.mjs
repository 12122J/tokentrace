export function buildRunWarnings(run) {
  const warnings = [];

  if (!run.usage) {
    warnings.push({
      code: 'missing-token-usage',
      title: 'No token usage captured',
      detail: 'This agent or command did not expose structured token usage.'
    });
  }

  const gitAvailable = run.source === 'hook'
    ? run.git?.after?.available
    : (run.git?.before?.available && run.git?.after?.available);
  if (!gitAvailable) {
    warnings.push({
      code: 'git-unavailable',
      title: 'Git metadata incomplete',
      detail: 'The run happened outside a usable git repository, or git metadata could not be read.'
    });
  }

  const changedFiles = run.diff?.files_changed || 0;
  const commandEvents = run.tools?.commands || [];
  const hasVerification = commandEvents.some((event) => looksLikeVerificationCommand(event.command));
  if (changedFiles > 0 && !hasVerification) {
    warnings.push({
      code: 'changes-without-verification',
      title: 'Changes recorded without verification command',
      detail: 'The trace includes changed files but no test, build, lint, or check command event.'
    });
  }

  if (run.exit_code !== 0) {
    warnings.push({
      code: 'nonzero-exit',
      title: 'Command exited unsuccessfully',
      detail: `The wrapped command exited with code ${run.exit_code}.`
    });
  }

  return warnings;
}

export function looksLikeVerificationCommand(command = '') {
  const normalized = String(command).toLowerCase();
  return [
    'test',
    'check',
    'lint',
    'build',
    'pytest',
    'cargo test',
    'go test',
    'npm test',
    'npm run test',
    'npm run check',
    'swift test'
  ].some((token) => normalized.includes(token));
}
