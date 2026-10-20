// The category list exists twice in the API: in the categories table (seeded by
// migration 004) and in src/constants.js, which validation uses. These fail if they drift.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../src/constants.js';
import { CATEGORIES as VALIDATION_CATEGORIES } from '../src/transactions/validation.js';

const MIGRATION = new URL('../db/migrations/004_create_categories.sql', import.meta.url);

async function seededCategories() {
  const sql = await readFile(MIGRATION, 'utf8');
  const insert = /INSERT INTO public\.categories \(name, sort_order\) VALUES([\s\S]+?);/.exec(sql);
  if (!insert) throw new Error('No INSERT INTO public.categories found in migration 004.');
  return [...insert[1].matchAll(/\('([^']+)', (\d+)\)/g)]
    .map(([, name, order]) => ({ name, order: Number(order) }))
    .sort((a, b) => a.order - b.order)
    .map(({ name }) => name);
}

describe('CATEGORIES', () => {
  it('matches the categories migration 004 seeds, in sort_order', async () => {
    expect(await seededCategories()).toEqual([...CATEGORIES]);
  });

  it('is the same list validation checks against', () => {
    expect(VALIDATION_CATEGORIES).toBe(CATEGORIES);
  });
});
