import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';

const JOURNAL_PATH = join(process.cwd(), 'drizzle', 'meta', '_journal.json');
const CONNECT_TIMEOUT_MS = 2000;

interface DrizzleJournal {
  entries?: Array<{ idx: number; tag: string; when: number }>;
}

export interface MigrationStatus {
  expected: number;
  applied: number;
  current: boolean;
  message: string;
}

function parseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) || undefined,
    connectTimeout: CONNECT_TIMEOUT_MS,
  };
}

function readJournalCount(): { count: number; error?: string } {
  try {
    const raw = readFileSync(JOURNAL_PATH, 'utf-8');
    const journal = JSON.parse(raw) as DrizzleJournal;
    return { count: journal.entries?.length ?? 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { count: 0, error: `Cannot read drizzle journal at ${JOURNAL_PATH}: ${message}` };
  }
}

export async function checkMigrationsCurrent(databaseUrl: string): Promise<MigrationStatus> {
  const journal = readJournalCount();
  if (journal.error) {
    return { expected: 0, applied: 0, current: false, message: journal.error };
  }
  const expected = journal.count;

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(parseUrl(databaseUrl));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      expected,
      applied: 0,
      current: false,
      message: `Cannot connect to database: ${msg}`,
    };
  }

  try {
    let applied: number;
    try {
      const [rows] = await connection.query(
        'SELECT COUNT(*) AS cnt FROM `__drizzle_migrations`',
      );
      applied = (rows as Array<{ cnt: number }>)[0]!.cnt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        expected,
        applied: 0,
        current: expected === 0,
        message: `__drizzle_migrations table missing or unreadable: ${msg}`,
      };
    }

    const current = expected === applied;
    let message: string;
    if (current) {
      message = `${applied}/${expected} migrations applied`;
    } else if (applied < expected) {
      message = `${applied}/${expected} migrations applied; ${expected - applied} pending`;
    } else {
      message = `${applied}/${expected} migrations applied; DB is ahead of code by ${applied - expected}`;
    }
    return { expected, applied, current, message };
  } finally {
    try {
      await connection.end();
    } catch {
      /* ignore close errors */
    }
  }
}
