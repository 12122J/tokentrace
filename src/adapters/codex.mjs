export function parseCodexJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function observeCodexLine(line) {
  const payload = parseCodexJsonLine(line);
  if (!payload) {
    return [];
  }

  const observations = [];
  const model = extractModel(payload);
  if (model) {
    observations.push({
      type: 'model.detected',
      model
    });
  }

  if (payload.type === 'thread.started' && payload.thread_id) {
    observations.push({
      type: 'session.thread',
      session_id: payload.thread_id
    });
  }

  if (payload.type === 'item.completed' && payload.item?.type === 'agent_message' && typeof payload.item.text === 'string') {
    observations.push({
      type: 'message.agent',
      text: payload.item.text
    });
  }

  const usage = payload.usage || payload.token_usage;
  if (payload.type === 'turn.completed' && usage) {
    observations.push({
      type: 'usage.tokens',
      input_tokens: numberOrZero(usage.input_tokens),
      cached_input_tokens: numberOrZero(usage.cached_input_tokens),
      output_tokens: numberOrZero(usage.output_tokens),
      reasoning_output_tokens: numberOrZero(usage.reasoning_output_tokens),
      total_tokens: numberOrZero(usage.input_tokens) + numberOrZero(usage.output_tokens)
    });
  }

  if (payload.type === 'exec_command.completed' || payload.type === 'tool.command.completed') {
    observations.push({
      type: 'tool.command',
      command: payload.command || payload.cmd || '',
      exit_code: typeof payload.exit_code === 'number' ? payload.exit_code : null
    });
  }

  if (payload.type === 'file.read' || payload.type === 'tool.file_read') {
    observations.push({
      type: 'file.read',
      path: payload.path || payload.file || '',
      bytes: typeof payload.bytes === 'number' ? payload.bytes : null
    });
  }

  return observations;
}

function extractModel(payload) {
  if (typeof payload.model === 'string') return payload.model;
  if (typeof payload.item?.model === 'string') return payload.item.model;
  if (typeof payload.message?.model === 'string') return payload.message.model;
  return null;
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
