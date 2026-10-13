// Captures real CareCircle screens for the demo video and the README.
//
// Starts the app in emulated-AWS mode (npm run aws:local -- --seed) twice:
//   A. a good morning: Mom checks in and takes her pill, her daughter asks how she is
//   B. a quiet morning: no check-in by the deadline, so EventBridge + SNS alert the family
// and drives the real UI with Playwright. Screenshots land in video/captures/, and the
// real Alexa replies and MCP tool calls go to captures/data.json for the animated scenes.
//
// The parent's time zone is picked so it's morning there when you run this, which keeps
// the clock on screen believable whatever time you record.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(here, "captures");
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An Etc/GMT zone where the local time right now is close to `hour` (e.g. 8.6 = 8:36 AM). */
function zoneAt(hour) {
  const now = new Date();
  const utc = now.getUTCHours() + now.getUTCMinutes() / 60;
  let off = Math.round(hour - utc);
  while (off > 14) off -= 24;
  while (off < -12) off += 24;
  return off === 0 ? "Etc/GMT" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
}

async function startApp(env) {
  const child = spawn(join(root, "node_modules/.bin/tsx"), ["src/local-aws.ts", "--seed"], {
    cwd: root,
    detached: true,
    env: { ...process.env, SCHEDULE_MINUTES: "60", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch("http://127.0.0.1:3000/healthz")).ok) return { child, log: () => log };
    } catch {}
    await sleep(250);
  }
  child.kill();
  throw new Error(`App didn't start:\n${log}`);
}

async function stopApp(app) {
  const exited = new Promise((r) => app.child.once("exit", r));
  process.kill(-app.child.pid, "SIGTERM"); // the whole group: tsx runs the app in a child process
  await exited;
  for (let i = 0; i < 40; i++) {
    try {
      await fetch("http://127.0.0.1:3000/healthz");
      await sleep(250);
    } catch {
      return;
    }
  }
}

const browser = await chromium.launch();
const data = { runs: {} };

async function openPage(width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  // No speech in headless captures, so the Echo ring settles back to idle right away.
  await ctx.addInitScript(() => { delete window.speechSynthesis; delete Window.prototype.speechSynthesis; });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:3000/");
  await page.waitForFunction(() => !document.querySelector("#summary .sk") && document.querySelector("#week")?.children.length);
  await page.evaluate(() => document.fonts.ready);
  await sleep(800);
  return page;
}

async function shoot(page, name, selectors = {}) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(out, `${name}.png`) });
  for (const [suffix, sel] of Object.entries(selectors)) {
    const el = page.locator(sel).first();
    if (await el.count()) await el.screenshot({ path: join(out, `${name}-${suffix}.png`) });
  }
}

async function chooseSpeaker(page, who) {
  await page.locator("#speakers button", { hasText: who }).click();
}

/** Says something to the simulated Alexa and waits for the reply and the dashboard refresh. */
async function say(page, text) {
  const before = await page.locator(".msg.alexa").count();
  await page.fill("#say", text);
  await page.press("#say", "Enter");
  await page.waitForFunction(
    (n) => {
      const m = document.querySelectorAll(".msg.alexa");
      return m.length > n && !m[m.length - 1].querySelector(".typing");
    },
    before,
  );
  await sleep(1200);
  return page.evaluate(() => {
    const m = [...document.querySelectorAll(".msg.alexa")].pop();
    return {
      reply: m.querySelector(".text").textContent,
      trace: [...m.querySelectorAll("details.call")].map((d) => ({ tool: d.querySelector("summary").textContent.trim(), detail: d.querySelector("pre").textContent })),
    };
  });
}

/** Expands the tool calls under the latest Alexa reply. */
async function openCalls(page) {
  await page.evaluate(() => {
    const m = [...document.querySelectorAll(".msg.alexa")].pop();
    m.querySelectorAll("details.call").forEach((d) => (d.open = true));
    document.getElementById("chat").scrollTop = 1e6;
  });
  await sleep(300);
}

const panels = {
  alexa: "#device",
  status: ".w.say",
  checkin: "#w-checkin",
  meds: ".w.med",
  mood: ".w.sky",
  meals: ".w.leaf",
  week: ".w:has(#week)",
  alerts: ".w:has(#alerts)",
  backstage: "#backstage",
  feed: ".w:has(#feed)",
};

// A. A good morning.
{
  const tz = zoneAt(8.6);
  // A long dose grace period, so the 8 AM pill isn't flagged before Mom gets to it.
  const app = await startApp({ CARE_TIMEZONE: tz, CHECKIN_DEADLINE: "10:00", DOSE_GRACE_MINUTES: "180" });
  const page = await openPage();
  const turns = [];
  await shoot(page, "a1-start", panels);

  turns.push({ speaker: "Mom", said: "Good morning!", ...(await say(page, "Good morning!")) });
  await shoot(page, "a2-checkin", panels);

  turns.push({ speaker: "Mom", said: "Had my oatmeal and the little white pill", ...(await say(page, "Had my oatmeal and the little white pill")) });
  await openCalls(page);
  await shoot(page, "a3-pill", panels);

  turns.push({ speaker: "Mom", said: "I'm feeling pretty good today", ...(await say(page, "I'm feeling pretty good today")) });
  turns.push({ speaker: "Mom", said: "Remind me about the pharmacy Friday at 11am", ...(await say(page, "Remind me about the pharmacy Friday at 11am")) });

  await chooseSpeaker(page, "Sarah");
  turns.push({ speaker: "Sarah", said: "How's Mom today?", ...(await say(page, "How's Mom today?")) });
  await openCalls(page);
  await shoot(page, "a4-family-asks", panels);

  // Full-page shot for the README.
  await page.screenshot({ path: join(out, "full.png"), fullPage: true });

  await page.click("#weekly");
  await page.waitForFunction(() => !document.querySelector("#doc-body .sk") && document.getElementById("doc-body").textContent.length > 20);
  await sleep(500);
  await shoot(page, "a5-weekly", { doc: "#doc-dialog" });
  data.runs.good = { tz, turns, report: await page.textContent("#doc-body") };
  await page.context().close();

  // A tall viewport, so the whole dashboard fits in one frame for the video.
  const tall = await openPage(1440, 1500);
  await tall.screenshot({ path: join(out, "a6-tall.png") });
  await tall.context().close();
  await stopApp(app);
}

// B. A quiet morning: no check-in by 10:00.
{
  const tz = zoneAt(10.6);
  const app = await startApp({ CARE_TIMEZONE: tz, CHECKIN_DEADLINE: "10:00" });
  await sleep(1500);
  const page = await openPage();
  await shoot(page, "b1-alert", panels);
  await chooseSpeaker(page, "Sarah");
  const turn = await say(page, "Has Mom missed anything today?");
  await openCalls(page);
  await shoot(page, "b2-missed", panels);
  const alerts = await page.$$eval("#alerts li", (li) => li.map((l) => l.firstElementChild.nextElementSibling.firstChild.textContent));
  const activity = await page.$$eval("#activity li", (li) => li.map((l) => l.textContent));
  data.runs.quiet = { tz, turns: [{ speaker: "Sarah", said: "Has Mom missed anything today?", ...turn }], alerts, activity };
  await page.context().close();
  await stopApp(app);
}

await browser.close();
writeFileSync(join(out, "data.json"), JSON.stringify(data, null, 2));
console.log(`Captured to ${out}`);
