import { generateWorld } from "../../packages/systems/src/generator.js";
import { createTemplate } from "../../packages/systems/src/seed.js";

// Rebuild the seed template once per test run so tests never depend on leftover state.
export default async function setup(): Promise<void> {
  await createTemplate(generateWorld(42));
}
