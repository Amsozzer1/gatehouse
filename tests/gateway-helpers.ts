import { generateWorld } from "../packages/systems/src/generator.js";
import { loadPolicy } from "../packages/gateway/src/policy.js";
import type { Mode } from "../packages/gateway/src/gateway.js";
import { startStack, type Stack } from "../packages/runner/src/stack.js";
import { gatewayTarget, type GatewayTarget } from "../packages/runner/src/gateway-target.js";

export const world = generateWorld(42);
export const policy = loadPolicy();
export const P = world.personas;

export async function withGateway<T>(db: string, mode: Mode, fn: (g: GatewayTarget, stack: Stack) => Promise<T>): Promise<T> {
  const stack = await startStack(db);
  const g = await gatewayTarget({ world, policy, stack, mode });
  try {
    return await fn(g, stack);
  } finally {
    await g.close();
    await stack.close();
  }
}

export async function lastAudit(stack: Stack) {
  const r = await stack.db.query("select * from gateway.audit_log order by id desc limit 1");
  return r.rows[0];
}
