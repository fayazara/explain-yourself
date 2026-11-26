#!/usr/bin/env node
// explain-yourself: play a narrated tour of code changes in a Chrome window.
//
//   node show.mjs <tour.json>     play a tour
//   node show.mjs --setup         save an ElevenLabs key / voice / model (optional)
//
// tour.json:
//   { "title": "...", "url": "http://localhost:5173",
//     "steps": [
//       { "title": "New badge", "say": "One or two sentences.", "page": "/", "point": "text=New" },
//       { "title": "Live validation", "say": "...", "page": "/signup",
//         "do": [{ "fill": "role=textbox[name=Email]", "value": "nope" }], "point": "text=valid email" },
//       { "title": "The rule", "say": "...", "file": "src/validate.ts", "lines": "1-22" } ] }
//
// "point" and "do" targets are Playwright locators (role=, text=, data-testid=, css).
// Voice: ElevenLabs when a key is configured, otherwise the browser's built-in speech.
// Config: ~/.explain-yourself/config.json; env ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID,
// ELEVENLABS_MODEL override it.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(os.homedir(), ".explain-yourself");
const CONFIG = path.join(HOME, "config.json");
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_MODEL = "eleven_flash_v2_5";

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return {};
  }
};
function saveConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(CONFIG, 0o600);
}

// ---------------------------------------------------------------- --setup
async function ask(question, { hidden = false } = {}) {
  const stdin = process.stdin;
  process.stdout.write(question);
  if (!stdin.isTTY) {
    let data = "";
    for await (const chunk of stdin) data += chunk;
    return data.split("\n")[0].trim();
  }
  return await new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (s) => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          return resolve(value.trim());
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f") {
          if (value) {
            value = value.slice(0, -1);
            if (!hidden) process.stdout.write("\b \b");
          }
        } else {
          value += ch;
          if (!hidden) process.stdout.write(ch);
        }
      }
    };
    stdin.on("data", onData);
  });
}

if (process.argv[2] === "--setup") {
  const cfg = readJson(CONFIG);
  console.log("explain-yourself setup. Press Enter to keep the current value.\n");
  const key = await ask(
    `ElevenLabs API key${cfg.elevenlabsApiKey ? " (saved)" : " (optional, Enter for browser voice)"}: `,
    { hidden: true },
  );
  if (key) cfg.elevenlabsApiKey = key;
  const voice = await ask(`Voice id [${cfg.voiceId ?? DEFAULT_VOICE}]: `);
  if (voice) cfg.voiceId = voice;
  const model = await ask(`Model [${cfg.model ?? DEFAULT_MODEL}]: `);
  if (model) cfg.model = model;
  saveConfig(cfg);
  console.log(`\nSaved to ${CONFIG} (only you can read it).`);
  process.exit(0);
}

// ---------------------------------------------------------------- dependencies
// The skill ships without node_modules; install the one dependency on first run.
async function loadPlaywright() {
  try {
    return await import("playwright-core");
  } catch {
    console.log("first run: installing playwright-core (one time, ~10 s)…");
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd: HERE,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (r.status !== 0) {
      console.error(`could not install playwright-core. Run \`npm install\` in ${HERE} and retry.`);
      process.exit(1);
    }
    return await import(path.join(HERE, "node_modules/playwright-core/index.mjs"));
  }
}

// ---------------------------------------------------------------- tour
const tourPath = process.argv[2];
if (!tourPath || tourPath.startsWith("-")) {
  console.error("usage: node show.mjs <tour.json>   |   node show.mjs --setup");
  process.exit(2);
}
const tour = JSON.parse(fs.readFileSync(tourPath, "utf8"));
const tourDir = path.dirname(path.resolve(tourPath));
const projectDir = tour.project ? path.resolve(tourDir, tour.project) : findRepoRoot(tourDir);
if (!tour.url || !Array.isArray(tour.steps) || tour.steps.length === 0) {
  console.error('tour.json needs "url" and a non-empty "steps" array');
  process.exit(2);
}

function findRepoRoot(dir) {
  for (let d = dir; d !== path.dirname(d); d = path.dirname(d))
    if (fs.existsSync(path.join(d, ".git"))) return d;
  return dir;
}

function codeFor(step) {
  if (!step.file) return null;
  try {
    const all = fs.readFileSync(path.resolve(projectDir, step.file), "utf8").split("\n");
    const [a, b] = String(step.lines ?? `1-${Math.min(all.length, 30)}`)
      .split("-")
      .map(Number);
    const start = Math.max(1, a || 1);
    const end = Math.min(all.length, b || start + 29);
    return {
      file: step.file,
      text: all
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(4)}  ${l}`)
        .join("\n"),
    };
  } catch {
    return { file: step.file, text: "(file not found)" };
  }
}

// ---------------------------------------------------------------- voice
const cfg = readJson(CONFIG);
const key = process.env.ELEVENLABS_API_KEY || cfg.elevenlabsApiKey;
const voiceId = process.env.ELEVENLABS_VOICE_ID || cfg.voiceId || DEFAULT_VOICE;
const model = process.env.ELEVENLABS_MODEL || cfg.model || DEFAULT_MODEL;

async function synth(text) {
  const cacheDir = path.join(HOME, "cache");
  const file = path.join(
    cacheDir,
    `${crypto.createHash("sha256").update(`${voiceId}|${model}|${text}`).digest("hex")}.mp3`,
  );
  if (fs.existsSync(file)) return fs.readFileSync(file);
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify({ text, model_id: model }),
          signal: AbortSignal.timeout(60000),
        },
      );
    } catch (e) {
      // Timeout or network hiccup: retry.
      if (attempt < 4) continue;
      throw new Error(e.name === "TimeoutError" ? "ElevenLabs timed out" : e.message);
    }
    // Rate limit or a server error: wait and retry.
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, buf);
    return buf;
  }
}

const audio = new Array(tour.steps.length).fill(null);
if (key) {
  process.stdout.write(`voice: ElevenLabs (${model}), preparing ${tour.steps.length} clips… `);
  // At most 2 requests at a time: lower ElevenLabs plans cap concurrency at 2-3.
  const results = new Array(tour.steps.length);
  let next = 0;
  const worker = async () => {
    while (next < tour.steps.length) {
      const k = next++;
      results[k] = await synth(tour.steps[k].say).then(
        (value) => ({ ok: true, value }),
        (reason) => ({ ok: false, reason }),
      );
    }
  };
  await Promise.all([worker(), worker()]);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    // Never switch voices mid-tour: if any clip is missing, use one voice for all of it.
    // Clips that did succeed are cached, so the next run only fetches the missing ones.
    console.log(`${tour.steps.length - failed.length}/${tour.steps.length} ok`);
    console.log(`  ${failed[0].reason.message}. Using the browser voice for the whole tour.`);
    console.log("  Run the tour again to retry ElevenLabs.");
  } else {
    results.forEach((r, i) => (audio[i] = `data:audio/mpeg;base64,${r.value.toString("base64")}`));
    console.log(`${tour.steps.length}/${tour.steps.length} ok`);
  }
} else {
  console.log("voice: browser speech (run `node show.mjs --setup` to use ElevenLabs)");
}

// ---------------------------------------------------------------- browser
const { chromium } = await loadPlaywright();
let ctx;
for (const channel of [process.env.EXPLAIN_YOURSELF_BROWSER, "chrome", "msedge"].filter(Boolean)) {
  try {
    ctx = await chromium.launchPersistentContext(path.join(HOME, "browser"), {
      channel,
      headless: !!process.env.EXPLAIN_YOURSELF_HEADLESS,
      viewport: null,
      args: ["--autoplay-policy=no-user-gesture-required", "--window-size=1400,900"],
      ignoreDefaultArgs: ["--enable-automation"],
    });
    break;
  } catch (e) {
    if (/ProcessSingleton|SingletonLock|already in use/i.test(String(e))) {
      console.error("a tour window is already open. Close it and retry.");
      process.exit(1);
    }
  }
}
if (!ctx) {
  console.error("could not start Google Chrome (or Edge). Install Chrome and retry.");
  process.exit(1);
}
const page = ctx.pages()[0] ?? (await ctx.newPage());

let wake = () => {};
const events = [];
const nextEvent = () =>
  events.length
    ? Promise.resolve(events.shift())
    : new Promise((r) => {
        wake = () => {
          wake = () => {};
          r(events.shift());
        };
      });
await ctx.exposeFunction("__vrEvent", (e) => {
  events.push(e);
  wake();
});
await ctx.addInitScript({ path: path.join(HERE, "overlay.js") });
ctx.on("close", () => process.exit(0));
page.on("close", () => process.exit(0));

const base = tour.url.replace(/\/$/, "");
const sameUrl = (a, b) => a.replace(/\/$/, "") === b.replace(/\/$/, "");

async function runStep(i) {
  const s = tour.steps[i];
  const ui = { index: i, total: tour.steps.length, title: s.title, say: s.say };
  let found = null;
  if (s.page !== undefined || s.point) {
    const target = base + (s.page ?? "/");
    if (!sameUrl(page.url(), target) || s.do) await page.goto(target, { waitUntil: "load" });
    for (const a of s.do ?? []) {
      try {
        if (a.fill) await page.locator(a.fill).first().fill(String(a.value ?? ""), { timeout: 4000 });
        else if (a.click) await page.locator(a.click).first().click({ timeout: 4000 });
        else if (a.press) await page.keyboard.press(a.press);
        await page.waitForTimeout(300);
      } catch {}
    }
    if (s.point) {
      const loc = page.locator(s.point).first();
      try {
        await loc.waitFor({ state: "visible", timeout: 5000 });
        await loc.scrollIntoViewIfNeeded();
        found = loc;
      } catch {
        ui.missing = s.point;
        console.log(`step ${i + 1}: couldn't find ${s.point} on ${s.page ?? "/"}`);
      }
    }
  } else {
    ui.code = codeFor(s);
  }
  await page.waitForFunction(() => window.__vr?.ready).catch(() => {});
  await page.evaluate((u) => window.__vr.show(u), ui);
  if (found) await found.evaluate((el) => window.__vr.spotlight(el)).catch(() => {});
  await page.evaluate(({ src, text }) => window.__vr.speak(src, text), { src: audio[i], text: s.say });
  if (process.env.EXPLAIN_YOURSELF_SHOTS) {
    await page.waitForTimeout(1500);
    fs.mkdirSync(process.env.EXPLAIN_YOURSELF_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.EXPLAIN_YOURSELF_SHOTS, `step-${i + 1}.png`) });
  }
}

console.log(`playing "${tour.title ?? "tour"}" on ${tour.url}. Close the window to quit.`);
const last = tour.steps.length - 1;
const jump = (e, i) =>
  e === "prev" ? Math.max(0, i - 1)
  : e === "restart" ? 0
  : typeof e === "string" && e.startsWith("goto:") ? Math.min(last, Math.max(0, Number(e.slice(5)) || 0))
  : null;
let i = 0;
while (true) {
  try {
    await runStep(i);
  } catch (e) {
    console.error(`step ${i + 1}: ${e.message.split("\n")[0]}`);
  }
  let e = await nextEvent();
  if (e === "next" || e === "ended") {
    if (i < last) {
      i++;
      continue;
    }
    // Finished: stay open until the user replays, steps back, or closes the window.
    await page.evaluate(() => window.__vr.done()).catch(() => {});
    console.log("tour finished");
    do e = await nextEvent();
    while (jump(e, last + 1) === null);
    i = jump(e, last + 1);
  } else {
    const t = jump(e, i);
    if (t !== null) i = t;
  }
}
