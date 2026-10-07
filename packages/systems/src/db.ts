import pg from "pg";

// Local default matches docker-compose.yml. CI and scripts override it with DATABASE_URL.
export const DEFAULT_DATABASE_URL = "postgres://gatehouse:gatehouse@localhost:54329/gatehouse";

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/** Same server, different database name. Used to create one fresh database per run. */
export function urlForDatabase(name: string, base = databaseUrl()): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}
