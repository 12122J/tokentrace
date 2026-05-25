// Shared pricing utility for all dashboard components.
// pricingDb: { [modelId]: { input, output, cacheWrite, cacheRead } } or null for fallback.
// All prices are USD per million tokens.

const FALLBACK = [
  { prefix: 'claude-opus-4',   input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  { prefix: 'claude-sonnet-4', input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  { prefix: 'claude-haiku-4',  input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  { prefix: 'claude-opus-3',   input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  { prefix: 'claude-sonnet-3', input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  { prefix: 'claude-haiku-3',  input:  0.25, output:  1.25, cacheWrite:  0.30, cacheRead: 0.03 },
  { prefix: 'gpt-4o-mini',     input:  0.15, output:  0.60, cacheWrite: null,  cacheRead: 0.075 },
  { prefix: 'gpt-4o',          input:  2.50, output: 10.00, cacheWrite: null,  cacheRead: 1.25 },
  { prefix: 'o4-mini',         input:  1.10, output:  4.40, cacheWrite: null,  cacheRead: 0.275 },
  { prefix: 'o3',              input: 10.00, output: 40.00, cacheWrite: null,  cacheRead: 2.50 },
  { prefix: 'o1',              input: 15.00, output: 60.00, cacheWrite: null,  cacheRead: 7.50 },
];

/**
 * Look up pricing for a model from the DB (with prefix matching and fallback).
 * @param {object|null} pricingDb - The pricing DB map, or null to use bundled fallback only.
 * @param {string} model - The model ID to look up.
 * @returns {{ input, output, cacheWrite, cacheRead }|null}
 */
export function lookupPrice(pricingDb, model) {
  if (!model) return null;

  if (pricingDb && typeof pricingDb === 'object') {
    // Exact match
    if (pricingDb[model]) return pricingDb[model];

    // Prefix match: DB key is a prefix of the queried model
    // e.g. DB has "claude-sonnet-4" and we query "claude-sonnet-4-6"
    for (const key of Object.keys(pricingDb)) {
      if (model.startsWith(key)) return pricingDb[key];
    }

    // Reverse prefix: queried model is a prefix of a DB key
    // e.g. we query "claude-sonnet-4" and DB has "claude-sonnet-4-6"
    for (const key of Object.keys(pricingDb)) {
      if (key.startsWith(model)) return pricingDb[key];
    }
  }

  // Bundled fallback (prefix list, ordered most-specific first)
  return FALLBACK.find(t => model.startsWith(t.prefix)) ?? null;
}

/**
 * Compute the cost for a session.
 * @param {object} session - A run.json session object.
 * @param {object|null} pricingDb - Pricing DB from /api/pricing, or null for fallback.
 * @returns {{ value: number|null, estimated: boolean }}
 */
export function sessionCost(session, pricingDb) {
  if (session.usage?.cost_usd != null) {
    return { value: session.usage.cost_usd, estimated: false };
  }

  if (!session.model || !session.usage) {
    return { value: null, estimated: false };
  }

  const p = lookupPrice(pricingDb, session.model);
  if (!p) return { value: null, estimated: false };

  const M = 1_000_000;
  const u = session.usage;
  const value = (
    (u.input_tokens            ?? 0) / M * (p.input      ?? 0) +
    (u.cache_creation_tokens   ?? 0) / M * (p.cacheWrite ?? 0) +
    (u.cache_read_tokens ?? u.cached_input_tokens ?? 0) / M * (p.cacheRead ?? 0) +
    (u.output_tokens           ?? 0) / M * (p.output     ?? 0)
  );

  return { value, estimated: true };
}

/**
 * Compute effective (display) token count from a usage object.
 * Handles old format (cached_input_tokens combined) vs new format (separated fields).
 * @param {object|null} usage
 * @returns {number}
 */
export function effectiveTokens(usage) {
  if (!usage) return 0;
  // New format: cache_creation_tokens is separate; total_tokens is correct.
  // Old format: cached_input_tokens combines creation+reads, inflating total_tokens.
  if ('cache_creation_tokens' in usage) {
    return usage.total_tokens ?? (
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_tokens ?? 0) +
      (usage.output_tokens ?? 0)
    );
  }
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
}
