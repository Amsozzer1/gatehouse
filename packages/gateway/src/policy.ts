import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { REGIONS } from "../../systems/src/generator.js";
import { ENTITIES } from "../../systems/src/entities.js";
import { toolByName } from "../../systems/src/tools.js";

const entityKeys = ENTITIES.map((e) => `${e.system}.${e.plural}`);
const columnsOf = (key: string) => ENTITIES.find((e) => `${e.system}.${e.plural}` === key)?.columns ?? [];

const ScopeEntry = z.object({
  regions: z.array(z.enum(REGIONS)).optional(),
  fields: z.array(z.string()),
}).strict();

const Bundle = z.object({
  description: z.string(),
  members: z.array(z.string()).min(1),
  approvers: z.array(z.string()),
  tools: z.array(z.string()).min(1),
  scope: z.record(z.string(), ScopeEntry),
  enforce: z.object({
    region: z.enum(REGIONS).optional(),
    max_limit: z.number().int().positive().optional(),
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }).strict(),
  approvals: z.array(z.string()),
}).strict();

const PolicyFile = z.object({ bundles: z.record(z.string(), Bundle) }).strict();

export type BundlePolicy = z.infer<typeof Bundle> & { name: string };
export type Policy = { bundles: Record<string, BundlePolicy> };

export class PolicyError extends Error {}

/** Parses and checks a policy. Any reference to something that doesn't exist fails loudly. */
export function parsePolicy(text: string): Policy {
  const raw = PolicyFile.safeParse(parse(text));
  if (!raw.success) throw new PolicyError(`invalid policy: ${raw.error.message}`);
  const problems: string[] = [];
  const bundles: Record<string, BundlePolicy> = {};
  for (const [name, b] of Object.entries(raw.data.bundles)) {
    for (const t of b.tools) if (!toolByName(t)) problems.push(`${name}: unknown tool ${t}`);
    for (const t of b.approvals) {
      if (!toolByName(t)) problems.push(`${name}: approval rule for unknown tool ${t}`);
      else if (!b.tools.includes(t)) problems.push(`${name}: approval rule for ${t}, which is not in the bundle's tools`);
      else if (toolByName(t)!.kind !== "write") problems.push(`${name}: approval rule for ${t}, which is not a write`);
    }
    if (b.approvals.length > 0 && b.approvers.length === 0) problems.push(`${name}: has approval rules but no approvers`);
    for (const [key, entry] of Object.entries(b.scope)) {
      if (!entityKeys.includes(key)) { problems.push(`${name}: scope for unknown entity ${key}`); continue; }
      for (const f of entry.fields) if (!columnsOf(key).includes(f)) problems.push(`${name}: scope field ${key}.${f} does not exist`);
    }
    for (const [key, fields] of Object.entries(b.enforce.fields ?? {})) {
      if (!entityKeys.includes(key)) { problems.push(`${name}: enforced fields for unknown entity ${key}`); continue; }
      for (const f of fields) if (!columnsOf(key).includes(f)) problems.push(`${name}: enforced field ${key}.${f} does not exist`);
    }
    bundles[name] = { ...b, name };
  }
  if (problems.length > 0) throw new PolicyError(`invalid policy:\n  ${problems.join("\n  ")}`);
  return { bundles };
}

export function loadPolicy(path = new URL("../../../policy.yaml", import.meta.url)): Policy {
  return parsePolicy(readFileSync(path, "utf8"));
}
