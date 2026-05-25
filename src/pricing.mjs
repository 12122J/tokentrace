// Prices per million tokens. Matched by prefix so minor version suffixes are handled.
const TIERS = [
  { prefix: 'claude-opus-4',    input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  { prefix: 'claude-sonnet-4',  input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  { prefix: 'claude-haiku-4',   input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  { prefix: 'claude-opus-3',    input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  { prefix: 'claude-sonnet-3',  input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  { prefix: 'claude-haiku-3',   input:  0.25, output:  1.25, cacheWrite:  0.30, cacheRead: 0.03 },
];

function findPricing(model) {
  if (!model) return null;
  return TIERS.find(t => model.startsWith(t.prefix)) ?? null;
}

export function estimateCostUsd(model, usage) {
  if (!usage) return null;
  const p = findPricing(model);
  if (!p) return null;

  const M = 1_000_000;
  const cacheWrite = usage.cache_creation_tokens ?? 0;
  // Old format stores creation+read combined in cached_input_tokens; treat as reads (cheaper)
  const cacheRead = usage.cache_read_tokens ?? usage.cached_input_tokens ?? 0;

  return (
    (usage.input_tokens  ?? 0) / M * p.input      +
    cacheWrite           / M * p.cacheWrite         +
    cacheRead            / M * p.cacheRead          +
    (usage.output_tokens ?? 0) / M * p.output
  );
}
