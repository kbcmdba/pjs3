import mysql from 'mysql2/promise';

export interface PingResult {
  ok: boolean;
  message: string;
}

const CONNECT_TIMEOUT_MS = 2000;

export async function pingDatabase(databaseUrl: string): Promise<PingResult> {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return { ok: false, message: 'Invalid DATABASE_URL: not a valid URL' };
  }

  const port = url.port ? Number(url.port) : 3306;
  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection({
      host: url.hostname,
      port,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1) || undefined,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });
    await connection.query('SELECT 1');
    return { ok: true, message: `connected to ${url.hostname}:${port}` };
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
