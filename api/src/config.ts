const DEFAULT_PORT = 8443;
const DEFAULT_HOST = '0.0.0.0';

export interface Config {
  port: number;
  host: string;
  errors: string[];
}

export function loadConfig(): Config {
  const errors: string[] = [];

  const rawPort = process.env.PORT ?? String(DEFAULT_PORT);
  const parsedPort = Number(rawPort);
  let port = parsedPort;
  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    errors.push(`Invalid PORT: "${rawPort}" — must be an integer between 1 and 65535.`);
    port = DEFAULT_PORT;
  }

  const rawHost = process.env.HOST ?? DEFAULT_HOST;
  let host = rawHost;
  if (rawHost.length === 0) {
    errors.push('HOST is empty.');
    host = DEFAULT_HOST;
  }

  return { port, host, errors };
}
