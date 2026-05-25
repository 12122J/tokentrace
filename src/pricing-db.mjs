import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureDir } from './util.mjs';

const CACHE_PATH = join(homedir(), '.tokentrace', 'pricing.json');
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Bundled fallback pricing (USD per million tokens).
// Used when offline and no cache file exists.
const FALLBACK_PRICING = {
  'claude-opus-4':   { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4': { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-haiku-4':  { input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  'claude-opus-3':   { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-3': { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-haiku-3':  { input:  0.25, output:  1.25, cacheWrite:  0.30, cacheRead: 0.03 },
  'gpt-4o':          { input:  2.50, output: 10.00, cacheWrite: null,  cacheRead: 1.25 },
  'gpt-4o-mini':     { input:  0.15, output:  0.60, cacheWrite: null,  cacheRead: 0.075 },
  'o1':              { input: 15.00, output: 60.00, cacheWrite: null,  cacheRead: 7.50 },
  'o3':              { input: 10.00, output: 40.00, cacheWrite: null,  cacheRead: 2.50 },
  'o4-mini':         { input:  1.10, output:  4.40, cacheWrite: null,  cacheRead: 0.275 },
};

const ALLOWED_PROVIDERS = new Set(['anthropic', 'openai']);

/**
 * Transform a raw litellm model entry into our pricing format.
 * All values are USD per million tokens (litellm stores per-token values).
 */
function transformEntry(raw) {
  const M = 1_000_000;
  return {
    input:      raw.input_cost_per_token                != null ? raw.input_cost_per_token * M                : null,
    output:     raw.output_cost_per_token               != null ? raw.output_cost_per_token * M               : null,
    cacheWrite: raw.cache_creation_input_token_cost     != null ? raw.cache_creation_input_token_cost * M     : null,
    cacheRead:  raw.cache_read_input_token_cost         != null ? raw.cache_read_input_token_cost * M         : null,
  };
}

/**
 * Fetch fresh pricing from litellm and transform it to our format.
 * Returns { db, fetched_at } or throws on failure.
 */
async function fetchFromLitellm() {
  const resp = await fetch(LITELLM_URL);
  if (!resp.ok) throw new Error(`litellm fetch failed: ${resp.status} ${resp.statusText}`);
  const raw = await resp.json();

  const db = {};
  for (const [modelId, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    const provider = entry.litellm_provider;
    if (!ALLOWED_PROVIDERS.has(provider)) continue;
    const pricing = transformEntry(entry);
    // Only include entries that have at least input and output pricing
    if (pricing.input == null || pricing.output == null) continue;
    db[modelId] = pricing;
  }

  return { db, fetched_at: new Date().toISOString() };
}

/**
 * Read cached pricing from disk. Returns null if file doesn't exist or is unreadable.
 */
async function readCache() {
  try {
    const raw = await readFile(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write pricing DB to cache file.
 */
async function writeCache(db, fetchedAt) {
  await ensureDir(join(homedir(), '.tokentrace'));
  await writeFile(CACHE_PATH, JSON.stringify({ db, fetched_at: fetchedAt }, null, 2) + '\n');
}

/**
 * Load the pricing database. Uses cache if fresh (< 7 days old),
 * otherwise fetches from litellm. Falls back to cache or FALLBACK_PRICING on failure.
 */
export async function loadPricingDb() {
  const cached = await readCache();

  // Use cache if still fresh
  if (cached?.db && cached?.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    if (age < TTL_MS) {
      return cached.db;
    }
  }

  // Try to fetch fresh data
  try {
    const { db, fetched_at } = await fetchFromLitellm();
    await writeCache(db, fetched_at);
    return db;
  } catch {
    // Fall back to stale cache if available
    if (cached?.db) {
      return cached.db;
    }
    // Last resort: bundled fallback
    return FALLBACK_PRICING;
  }
}

/**
 * Force a fresh fetch from litellm and save to cache, regardless of TTL.
 * Returns the updated pricing DB.
 */
export async function updatePricingDb() {
  const { db, fetched_at } = await fetchFromLitellm();
  await writeCache(db, fetched_at);
  return db;
}

/**
 * Look up pricing for a model by exact match first, then prefix match.
 * e.g. "claude-sonnet-4" matches "claude-sonnet-4-6" in the DB.
 * Falls back to FALLBACK_PRICING if not found in the provided db.
 */
export function lookupPrice(db, modelId) {
  if (!modelId) return null;

  const source = db ?? {};

  // Exact match
  if (source[modelId]) return source[modelId];

  // Prefix match: find a DB key that the modelId starts with
  for (const key of Object.keys(source)) {
    if (modelId.startsWith(key)) return source[key];
  }

  // Try reverse: a FALLBACK key prefix matches the modelId
  // (e.g. querying "claude-sonnet-4" when DB only has "claude-sonnet-4-6")
  for (const key of Object.keys(source)) {
    if (key.startsWith(modelId)) return source[key];
  }

  // Fallback to bundled pricing
  for (const [prefix, pricing] of Object.entries(FALLBACK_PRICING)) {
    if (modelId.startsWith(prefix) || prefix.startsWith(modelId)) return pricing;
  }

  return null;
}
