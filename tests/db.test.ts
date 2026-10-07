import { describe, expect, it } from "vitest";
import pg from "pg";
import { databaseUrl } from "../packages/systems/src/db.js";

describe("database", () => {
  it("answers a query", async () => {
    const client = new pg.Client({ connectionString: databaseUrl() });
    await client.connect();
    const { rows } = await client.query<{ one: number }>("select 1 as one");
    await client.end();
    expect(rows[0]?.one).toBe(1);
  });
});
