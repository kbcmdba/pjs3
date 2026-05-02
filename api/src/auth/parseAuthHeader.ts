/**
 * Parse an HTTP `Authorization: Bearer <token>` header.
 *
 * Returns the bare token string when the header is well-formed; returns
 * `null` for any malformed shape (missing entirely, no `Bearer` prefix,
 * empty token after `Bearer`, extra whitespace shapes, etc.).
 *
 * Pure function — no I/O, no DB, no cryptography. The HTTP route is
 * responsible for translating `null` into a 401 response.
 */
export function parseAuthHeader(_header: string | undefined): string | null {
  throw new Error('parseAuthHeader: not implemented (TDD red step)');
}
