export function parseTranscriptLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

export function extractFromTranscript(lines) {
  let cwd = null;
  let model = null;
  let ccVersion = null;
  let gitBranch = null;
  let entrypoint = null;
  let aiTitle = null;
  let firstUserMessage = null;
  const rawUsage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  let hasUsage = false;
  const tools = { command_count: 0, commands: [] };
  const humanParts = [];

  for (const raw of lines) {
    const entry = parseTranscriptLine(raw);
    if (!entry) continue;

    if (entry.cwd && !cwd) cwd = entry.cwd;
    if (entry.version && !ccVersion) ccVersion = entry.version;
    if (entry.gitBranch && !gitBranch && entry.gitBranch !== 'HEAD') gitBranch = entry.gitBranch;
    if (entry.entrypoint && !entrypoint) entrypoint = entry.entrypoint;

    if (entry.type === 'ai-title' && entry.aiTitle && !aiTitle) {
      aiTitle = entry.aiTitle;
    }

    if (entry.type === 'user') {
      const content = entry.message?.content;
      const text = typeof content === 'string' ? content
        : Array.isArray(content) ? content.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '';
      const trimmed = text.trim();
      if (trimmed) {
        humanParts.push(`[user]\n${trimmed}`);
        // First substantive user message is a fallback description
        if (!firstUserMessage && trimmed.length > 3) {
          firstUserMessage = trimmed.slice(0, 160).replace(/\s+/g, ' ');
        }
      }
    }

    if (entry.type === 'assistant') {
      const msg = entry.message ?? {};
      const u = msg.usage ?? {};

      if (msg.model && !model) model = msg.model;

      if (u.input_tokens != null || u.output_tokens != null) {
        hasUsage = true;
        rawUsage.input_tokens += u.input_tokens ?? 0;
        rawUsage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
        rawUsage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
        rawUsage.output_tokens += u.output_tokens ?? 0;
      }

      for (const block of msg.content ?? []) {
        if (!block || typeof block !== 'object') continue;

        if (block.type === 'text' && block.text?.trim()) {
          humanParts.push(`[assistant]\n${block.text.trim()}`);
        }

        if (block.type === 'tool_use') {
          const name = block.name ?? '';
          if (name === 'Bash') {
            const command = block.input?.command ?? '';
            tools.command_count++;
            tools.commands.push({ command, exit_code: null });
            humanParts.push(`[bash] ${command}`);
          } else if (name === 'Read' || name === 'Write' || name === 'Edit') {
            const path = block.input?.file_path ?? block.input?.path ?? '';
            humanParts.push(`[${name.toLowerCase()}] ${path}`);
          }
        }
      }
    }
  }

  // total_tokens excludes cache_read_tokens: those are repeated context reads,
  // not new work. Summing them across turns inflates the count by 10-100x.
  const total = rawUsage.input_tokens + rawUsage.cache_creation_input_tokens + rawUsage.output_tokens;

  const description = aiTitle ?? firstUserMessage;

  return {
    cwd,
    model,
    ccVersion,
    gitBranch,
    entrypoint,
    description,
    usage: hasUsage ? {
      input_tokens: rawUsage.input_tokens,
      cache_creation_tokens: rawUsage.cache_creation_input_tokens,
      cache_read_tokens: rawUsage.cache_read_input_tokens,
      output_tokens: rawUsage.output_tokens,
      reasoning_output_tokens: 0,
      total_tokens: total
    } : null,
    tools,
    humanTranscript: humanParts.join('\n\n')
  };
}
