import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateCostUsdSync } from '../src/pricing.mjs';
import { lookupPrice } from '../src/pricing-db.mjs';

test('lookupPrice matches exact and prefix model ids', () => {
  const db = {
    'claude-sonnet-4': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }
  };

  assert.deepEqual(lookupPrice(db, 'claude-sonnet-4'), db['claude-sonnet-4']);
  assert.deepEqual(lookupPrice(db, 'claude-sonnet-4-6'), db['claude-sonnet-4']);
});

test('estimateCostUsdSync includes cache reads in cost but not token total semantics', () => {
  const db = {
    'claude-sonnet-4': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }
  };
  const usage = {
    input_tokens: 1_000,
    cache_creation_tokens: 1_000_000,
    cache_read_tokens: 65_000_000,
    output_tokens: 270_000,
    total_tokens: 1_271_000
  };

  const cost = estimateCostUsdSync('claude-sonnet-4-6', usage, db);
  assert.equal(cost, 27.303);
});
