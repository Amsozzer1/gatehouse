// pnpm record: renders every step of the built replay page (apps/web/out) in a headless
// browser and stitches the frames into docs/demo.gif with ffmpeg. Frames are taken with
// ?step=N, so the GIF shows exactly the measured counts at each step.
// Needs ffmpeg on PATH and the Playwright browser (see README).
import http from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "apps/web/out");
const frames = join(root, "data/frames");
if (!existsSync(join(out, "index.html"))) throw new Error("build the page first: pnpm --filter web build");
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const file = join(out, path.endsWith("/") ? `${path}index.html` : path);
  if (!file.startsWith(out) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

const steps = (JSON.parse(readFileSync(join(out, "replay.json"), "utf8")) as { steps: unknown[] }).steps.length;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const list: string[] = [];
for (let k = 0; k <= steps; k++) {
  await page.goto(`${base}?step=${k}`);
  await page.waitForSelector(`main[data-step="${k}"]`);
  const file = join(frames, `frame-${String(k).padStart(3, "0")}.png`);
  await page.screenshot({ path: file });
  const seconds = k === 0 ? 2.5 : k === steps ? 6 : 1.6;
  list.push(`file '${file}'\nduration ${seconds}`);
}
await browser.close();
server.close();
// The concat demuxer needs the last file repeated to honour its duration.
list.push(`file '${join(frames, `frame-${String(steps).padStart(3, "0")}.png`)}'`);
writeFileSync(join(frames, "list.txt"), `${list.join("\n")}\n`);

mkdirSync(join(root, "docs"), { recursive: true });
const gif = join(root, "docs/demo.gif");
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"),
  "-vf", "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none",
  "-loop", "0", gif,
]);
execFileSync("cp", [join(frames, `frame-${String(steps).padStart(3, "0")}.png`), join(root, "docs/demo-final.png")]);
console.log(`wrote docs/demo.gif (${steps + 1} frames) and docs/demo-final.png`);
