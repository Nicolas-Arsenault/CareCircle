// Renders docs/video/motion.html to docs/video/carecircle-motion.mp4, frame by frame,
// so the result is smooth no matter how fast the machine is.
//
//   npm install --no-save playwright && npx playwright install chromium
//   node docs/video/render.mjs [--fps 30] [--from 0] [--to 66] [--stills]
//
// Needs ffmpeg on the PATH. --stills writes one PNG per second instead of a video.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
const fps = arg("fps", 30);
const stills = process.argv.includes("--stills");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${pathToFileURL(join(here, "motion.html"))}?render`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const duration = await page.evaluate(() => window.DURATION);
const from = arg("from", 0), to = arg("to", duration);

if (stills) {
  mkdirSync(join(here, "stills"), { recursive: true });
  for (let t = from; t <= to; t += 1) {
    await page.evaluate((s) => window.seek(s), t);
    await page.screenshot({ path: join(here, "stills", `t${String(t).padStart(2, "0")}.png`) });
  }
} else {
  const out = join(here, "carecircle-motion.mp4");
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.round((to - from) * fps);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((s) => window.seek(s), from + i / fps);
    const buf = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % fps === 0) process.stdout.write(`\r${Math.round((i / frames) * 100)}%`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`\nWrote ${out}`);
}
await browser.close();
