import mysql from 'mysql2/promise';

export interface PingResult {
  ok: boolean;
  message: string;
}

const PING_CONNECT_TIMEOUT_MS = 2000;

/**
 * Parse a `mysql://user:pass@host:port/dbname` URL into the option shape
 * `mysql.createConnection()` accepts. Throws if the URL is malformed.
 *
 * `connectTimeoutMs` is optional; pass nothing to leave the driver default
 * in place. Pass an explicit value to bound the connection-establishment
 * window.
 */
export function parseDatabaseUrl(
  databaseUrl: string,
  connectTimeoutMs?: number,
): mysql.ConnectionOptions {
  const url = new URL(databaseUrl);
  const opts: mysql.ConnectionOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) || undefined,
  };
  if (connectTimeoutMs !== undefined) {
    opts.connectTimeout = connectTimeoutMs;
  }
  return opts;
}

export async function pingDatabase(databaseUrl: string): Promise<PingResult> {
  let opts: mysql.ConnectionOptions;
  try {
    opts = parseDatabaseUrl(databaseUrl, PING_CONNECT_TIMEOUT_MS);
  } catch {
    return { ok: false, message: 'Invalid DATABASE_URL: not a valid URL' };
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(opts);
    await connection.query('SELECT 1');
    return { ok: true, message: `connected to ${opts.host}:${opts.port}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        /* ignore close errors after a failed connect */
      }
    }
  }
}
