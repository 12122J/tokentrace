import { loadPricingDb, lookupPrice } from './pricing-db.mjs';

/**
 * Synchronous cost estimation using a pre-loaded pricing DB.
 * Pass the result of loadPricingDb() as pricingDb.
 * Falls back to null if model or usage is missing.
 */
export function estimateCostUsdSync(model, usage, pricingDb) {
  if (!usage) return null;
  const p = lookupPrice(pricingDb, model);
  if (!p) return null;

  const M = 1_000_000;
  const cacheWrite = usage.cache_creation_tokens ?? 0;
  // Old format stores creation+read combined in cached_input_tokens; treat as reads (cheaper)
  const cacheRead = usage.cache_read_tokens ?? usage.cached_input_tokens ?? 0;

  return (
    (usage.input_tokens  ?? 0) / M * (p.input ?? 0)      +
    cacheWrite           / M * (p.cacheWrite ?? 0)        +
    cacheRead            / M * (p.cacheRead ?? 0)         +
    (usage.output_tokens ?? 0) / M * (p.output ?? 0)
  );
}

/**
 * Async cost estimation — loads the pricing DB on each call.
 * Suitable for one-off use where the DB is not pre-loaded.
 */
export async function estimateCostUsd(model, usage) {
  if (!usage) return null;
  const db = await loadPricingDb();
  return estimateCostUsdSync(model, usage, db);
}
