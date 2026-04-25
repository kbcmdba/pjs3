import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { seedReferenceData } from '../../src/seed/referenceData';

const MIGRATIONS_FOLDER = './drizzle';
const CONNECT_TIMEOUT_MS = 5000;

function randomDbName(): string {
  return `pjs3_test_${randomBytes(6).toString('hex')}`;
}

function appendDb(baseUrl: string, dbName: string): string {
  const trimmed = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${trimmed}${dbName}`;
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

export async function withTestDb<T>(
  fn: (databaseUrl: string) => Promise<T>,
): Promise<T> {
  const bootstrapUrl = process.env.TEST_BOOTSTRAP_DATABASE_URL;
  const userUrlBase = process.env.TEST_DATABASE_URL_BASE;
  if (!bootstrapUrl || !userUrlBase) {
    throw new Error(
      'TEST_BOOTSTRAP_DATABASE_URL and TEST_DATABASE_URL_BASE must be set for DB-touching tests. See api/env.example.',
    );
  }

  const dbName = randomDbName();
  const userUrl = appendDb(userUrlBase, dbName);

  const bootstrapConn = await mysql.createConnection(parseUrl(bootstrapUrl));
  try {
    await bootstrapConn.query(`CREATE DATABASE \`${dbName}\``);
  } finally {
    await bootstrapConn.end();
  }

  try {
    const userConn = await mysql.createConnection(parseUrl(userUrl));
    try {
      const db = drizzle(userConn);
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      await seedReferenceData(db);
    } finally {
      await userConn.end();
    }

    return await fn(userUrl);
  } finally {
    const dropConn = await mysql.createConnection(parseUrl(bootstrapUrl));
    try {
      await dropConn.query(`DROP DATABASE \`${dbName}\``);
    } finally {
      await dropConn.end();
    }
  }
}
