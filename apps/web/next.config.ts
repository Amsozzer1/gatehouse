import type { NextConfig } from "next";

// Static export: the replay is a single page that reads the committed results.
const config: NextConfig = { output: "export" };
export default config;
