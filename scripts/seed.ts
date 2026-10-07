// Builds the seed template database from the deterministic generator.
import { generateWorld } from "../packages/systems/src/generator.js";
import { SEED } from "../packages/systems/src/config.js";
import { createTemplate, TEMPLATE_DB } from "../packages/systems/src/seed.js";

await createTemplate(generateWorld(SEED));
console.log(`seeded ${TEMPLATE_DB} with seed ${SEED}`);
