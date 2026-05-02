/**
 * Delete the `session` row matching `jti`.
 *
 * Returns `{ ok: true }` when a row was deleted, `{ ok: false }` when no
 * row matched (e.g., session already deleted, or jti is one we never
 * issued). The HTTP route translates `{ ok: false }` into 401 to keep
 * the failure shape indistinguishable from "JWT didn't verify".
 *
 * Single-row, single-jti delete. Other sessions for the same user are
 * untouched — this endpoint is "log out *this* device", not "log out
 * everywhere".
 */
export async function performLogout(
  _databaseUrl: string,
  _jti: string,
): Promise<{ ok: boolean }> {
  throw new Error('performLogout: not implemented (TDD red step)');
}
