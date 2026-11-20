import { describe, expect, test } from 'vitest';
import { createSeenIds } from '../../src/server/security.js';

const DAY = 24 * 60 * 60 * 1000;
const ID = '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60';

describe('createSeenIds', () => {
  test('remembers an added id and nothing else', () => {
    const seen = createSeenIds(DAY, () => 0);
    expect(seen.has(ID)).toBe(false);
    seen.add(ID);
    expect(seen.has(ID)).toBe(true);
    expect(seen.has('ander-id')).toBe(false);
  });

  test('forgets an id once the TTL has passed', () => {
    let t = 1_000;
    const seen = createSeenIds(DAY, () => t);
    seen.add(ID);
    t += DAY - 1;
    expect(seen.has(ID)).toBe(true);
    t += 1;
    expect(seen.has(ID)).toBe(false);
  });

  test('adding an id again restarts its TTL', () => {
    let t = 0;
    const seen = createSeenIds(DAY, () => t);
    seen.add(ID);
    t = DAY - 1;
    seen.add(ID);
    t = DAY + 10;
    expect(seen.has(ID)).toBe(true);
  });
});
