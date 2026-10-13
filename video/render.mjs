// Renders scene.html to an MP4, frame by frame, with a synthesized soundtrack.
//
//   node render.mjs                     out/carecircle-demo.mp4 (1080p, 30 fps)
//   node render.mjs --fps 60            smoother motion, twice the render time
//   node render.mjs --stills 3,20,85    PNG stills at those seconds (out/still-<t>.png)
//   node render.mjs --gif               also a small looping GIF preview of the architecture scene
//   node render.mjs --preview           serve the scene at http://127.0.0.1:4173 to watch it live
//
// Needs ffmpeg and python3 with numpy (for the soundtrack). Run `npm run capture` first so
// the scene uses real screens and replies from the app; without captures it falls back to
// built-in text.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i < 0 ? def : args[i + 1]; };
const fps = Number(opt("fps", "30"));
const outFile = opt("out", join(outDir, "carecircle-demo.mp4"));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  const file = join(here, path || "scene.html");
  if (!file.startsWith(here) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(4173, "127.0.0.1", r));
const base = "http://127.0.0.1:4173/scene.html";

if (args.includes("--preview")) {
  console.log(`Open ${base} (space pauses, arrows scrub, ?t=40 starts at 40 s). Ctrl+C to stop.`);
} else {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${base}?render`);
  await page.waitForFunction(() => window.ready === true);
  const total = await page.evaluate(() => window.TOTAL);

  const run = (cmd, a, input) => new Promise((resolve, reject) => {
    const p = spawn(cmd, a, { stdio: [input ? "pipe" : "ignore", "inherit", "inherit"] });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
    if (input) input(p.stdin);
  });

  if (opt("stills")) {
    for (const t of opt("stills").split(",").map(Number)) {
      await page.evaluate((x) => window.seek(x), t);
      await page.screenshot({ path: join(outDir, `still-${t}.png`) });
    }
    console.log(`Stills written to ${outDir}`);
  } else {
    // Soundtrack, timed to the scene's cue points.
    const cues = await page.evaluate(() => window.cues());
    const cuesFile = join(outDir, "cues.json");
    const wav = join(outDir, "soundtrack.wav");
    writeFileSync(cuesFile, JSON.stringify(cues));
    await run("python3", [join(here, "music.py"), String(total), cuesFile, wav]);

    const frames = Math.round(total * fps);
    const started = Date.now();
    await run("ffmpeg", [
      "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
      "-i", wav, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "192k", "-shortest", outFile,
    ], async (stdin) => {
      for (let i = 0; i < frames; i++) {
        await page.evaluate((x) => window.seek(x), i / fps);
        const jpg = await page.screenshot({ type: "jpeg", quality: 95 });
        if (!stdin.write(jpg)) await new Promise((r) => stdin.once("drain", r));
        if (i % (fps * 5) === 0) process.stdout.write(`\r${Math.round((i / frames) * 100)}%  frame ${i}/${frames}  ${Math.round((Date.now() - started) / 1000)}s`);
      }
      stdin.end();
    });
    console.log(`\nWrote ${outFile}`);

    if (args.includes("--gif")) {
      const gif = join(outDir, "carecircle-architecture.gif");
      await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", "80", "-t", "9", "-i", outFile, "-vf",
        "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", gif]);
      console.log(`Wrote ${gif}`);
    }
  }
  await browser.close();
  server.close();
}
