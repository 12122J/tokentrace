export function parseTranscriptLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

export function extractFromTranscript(lines) {
  let cwd = null;
  const rawUsage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  let hasUsage = false;
  const tools = { command_count: 0, commands: [] };
  const files = { read_count: 0, reads: [] };
  const humanParts = [];

  for (const raw of lines) {
    const entry = parseTranscriptLine(raw);
    if (!entry) continue;

    if (entry.cwd && !cwd) cwd = entry.cwd;

    if (entry.type === 'user') {
      const content = entry.message?.content;
      const text = typeof content === 'string' ? content
        : Array.isArray(content) ? content.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '';
      if (text.trim()) humanParts.push(`[user]\n${text.trim()}`);
    }

    if (entry.type === 'assistant') {
      const msg = entry.message ?? {};
      const u = msg.usage ?? {};

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
            files.read_count++;
            files.reads.push({ path, bytes: null });
            humanParts.push(`[${name.toLowerCase()}] ${path}`);
          }
        }
      }
    }
  }

  const cached = rawUsage.cache_creation_input_tokens + rawUsage.cache_read_input_tokens;
  const total = rawUsage.input_tokens + cached + rawUsage.output_tokens;

  return {
    cwd,
    usage: hasUsage ? {
      input_tokens: rawUsage.input_tokens,
      cached_input_tokens: cached,
      output_tokens: rawUsage.output_tokens,
      reasoning_output_tokens: 0,
      total_tokens: total
    } : null,
    tools,
    files,
    humanTranscript: humanParts.join('\n\n')
  };
}
