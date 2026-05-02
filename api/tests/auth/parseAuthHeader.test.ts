import { describe, expect, it } from 'vitest';
import { parseAuthHeader } from '../../src/auth/parseAuthHeader';

/**
 * Pure-function unit tests. No DB, no app, no HTTP. Each test pinpoints
 * one specific shape of the header.
 *
 * Coverage invariant: the route's integration test does NOT exercise
 * malformed-header cases — those bugs need to be caught here.
 */
describe('parseAuthHeader', () => {
  it('returns null when the header is undefined', () => {
    expect(parseAuthHeader(undefined)).toBeNull();
  });

  it('returns null when the header is the empty string', () => {
    expect(parseAuthHeader('')).toBeNull();
  });

  it('returns null when the header has no Bearer prefix', () => {
    expect(parseAuthHeader('just-a-token')).toBeNull();
  });

  it('returns null when the header has the Bearer prefix but no token', () => {
    expect(parseAuthHeader('Bearer ')).toBeNull();
  });

  it('returns null when the header has the Bearer prefix without a separating space', () => {
    expect(parseAuthHeader('Bearersomething')).toBeNull();
  });

  it('returns the token when the header is "Bearer <token>"', () => {
    expect(parseAuthHeader('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null when the prefix is wrong-cased ("bearer" instead of "Bearer")', () => {
    // RFC 6750 says the scheme is case-insensitive; we deliberately enforce
    // canonical "Bearer" casing for predictability. Document and lock it.
    expect(parseAuthHeader('bearer abc.def.ghi')).toBeNull();
  });
});
