#!/usr/bin/env node
import { launch } from "puppeteer";
import { execSync } from "child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { parse } from "node-html-parser";
import minimist from "minimist";

const args = minimist(process.argv.slice(2), {
  boolean: ["keep-frames"],
  string:  ["input", "output", "frames", "duration"],
  default: { fps: 24, loop: 0, frames: "frames" },
});

const die = (msg, hint) => {
  console.error(`❌ ${msg}${hint ? `\n   → ${hint}` : ""}`);
  process.exit(1);
};

const INPUT  = args.input;
const OUTPUT = args.output;
const FPS    = parseInt(args.fps, 10);
const FRAME_DIR = args.frames;
const LOOP   = parseInt(args.loop, 10);
const KEEP_FRAMES = args["keep-frames"];

if (!INPUT || !OUTPUT) {
  console.log(`Usage:
  svg-animation-convert --input <file> --output <file> [options]

Required:
  --input     Path to animated SVG
  --output    Output path (.gif .apng .mov .webm)

Options:
  --duration  Duration: 4000 · 4000ms · 4s · 4.5  (inferred from SMIL or GSAP if omitted)
  --fps       Frames per second  (default: 24)
  --loop      0 = infinite (default) · -1 = once · N = N times
  --frames    Temp frame directory  (default: frames)
  --keep-frames  Keep PNG frames after encoding

Examples:
  svg-animation-convert --input logo.svg --output logo.apng
  svg-animation-convert --input anim.svg --output anim.gif --fps 30 --loop -1
  svg-animation-convert --input gsap.svg --output out.webm --duration 3s --fps 60`);
  process.exit(1);
}

const FORMAT = path.extname(OUTPUT).slice(1).toLowerCase();
const SUPPORTED_FORMATS = ["gif", "apng", "mov", "webm"];
if (!SUPPORTED_FORMATS.includes(FORMAT))
  die(`Unsupported format ".${FORMAT}". Supported: ${SUPPORTED_FORMATS.join(", ")}`);

const parseDurationArg = (rawValue) => {
  if (rawValue == null) return null;
  const trimmed = String(rawValue).trim().toLowerCase();
  if (!trimmed) return null;

  const match = trimmed.match(/^([0-9]*\.?[0-9]+)(ms|s)?$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit  = match[2];
  if (Number.isNaN(value)) return null;

  if (unit === "ms") return Math.round(value);
  if (unit === "s")  return Math.round(value * 1000);

  if (trimmed.includes(".")) return Math.round(value * 1000);
  if (value >= 1000) return Math.round(value);
  if (value <= 50)   return Math.round(value * 1000);

  // Ambiguous range (51–999): warn and treat as ms
  console.warn(`⚠  --duration=${rawValue} is ambiguous (${value}ms or ${value / 1000}s?). Treating as ms. Use explicit unit: ${value}ms or ${value / 1000}s`);
  return Math.round(value);
};

const parseSVGMeta = (filePath) => {
  const content = readFileSync(filePath, "utf8");
  const root = parse(content);
  const svg  = root.querySelector("svg");

  let width, height;
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const [, , w, h] = viewBox.trim().split(/\s+/).map(Number);
    width  = Math.round(w);
    height = Math.round(h);
  } else {
    width  = parseInt(svg.getAttribute("width"))  || 1920;
    height = parseInt(svg.getAttribute("height")) || 1080;
  }

  let maxTime = 0;
  const animEls = root.querySelectorAll("animate, set, animateTransform");
  for (const el of animEls) {
    const begin    = parseFloat((el.getAttribute("begin") || "0").replace("s", ""));
    const durAttr  = el.getAttribute("dur");
    const dur      = durAttr?.endsWith("s") ? parseFloat(durAttr) : parseFloat(durAttr || "0");

    const repeatDur   = el.getAttribute("repeatDur");
    const repeatCount = el.getAttribute("repeatCount");
    let active = dur;
    if (repeatDur   && repeatDur   !== "indefinite") active = parseFloat(repeatDur);
    else if (repeatCount && repeatCount !== "indefinite") active = dur * parseFloat(repeatCount);

    const end = begin + active;
    if (!isNaN(end)) maxTime = Math.max(maxTime, end);
  }

  return {
    width,
    height,
    durationMs: maxTime > 0 ? Math.round(maxTime * 1000) : null,
    hasSMIL: animEls.length > 0,
  };
};

const { width, height, durationMs: inferredDuration, hasSMIL } = parseSVGMeta(INPUT);

const argDurationMs = args.duration != null ? parseDurationArg(args.duration) : null;
if (args.duration != null && argDurationMs === null)
  die(`Invalid --duration="${args.duration}"`, "Use: 4000  4000ms  4s  4.5");

const PALETTE = path.join(FRAME_DIR, "palette.png");

// Normalize loop values
const gifLoop = LOOP;
let apngLoop;
if (LOOP === -1)     apngLoop = 1;
else if (LOOP === 0) apngLoop = 0;
else                 apngLoop = LOOP + 1;

// === Main ===
const main = async () => {
  mkdirSync(FRAME_DIR, { recursive: true });

  // Wrap SVG in a minimal HTML shell — ensures transparent background and
  // proper document context (bare file:// SVGs use Chrome's own viewer styling).
  const inputAbs = path.resolve(INPUT);
  const tmpHtml  = inputAbs.replace(/\.svg$/i, "") + "__svg_convert_tmp.html";
  writeFileSync(tmpHtml, [
    `<!DOCTYPE html><html><head>`,
    `<style>*,html,body{margin:0;padding:0;background:transparent!important;overflow:hidden}</style>`,
    `</head><body>`,
    readFileSync(inputAbs, "utf8"),
    `</body></html>`,
  ].join(""));

  const browser = await launch({ protocolTimeout: 60000 });
  const page    = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  await page.goto("file://" + tmpHtml, { waitUntil: "networkidle0", timeout: 30000 });

  const hasGsap = await page.evaluate(() => typeof gsap !== "undefined");

  const gsapDuration = hasGsap
    ? await page.evaluate(() => {
        // globalTimeline.duration() is Infinity when repeat:-1; walk children instead
        const d = gsap.globalTimeline.duration();
        if (isFinite(d) && d > 0 && d < 3600) return Math.round(d * 1000);
        let maxEnd = 0;
        for (const t of gsap.globalTimeline.getChildren(true, true, true, 0)) {
          const end = t.startTime() + t.duration();
          if (isFinite(end) && end < 3600) maxEnd = Math.max(maxEnd, end);
        }
        return maxEnd > 0 ? Math.round(maxEnd * 1000) : null;
      })
    : null;

  const DURATION_MS = argDurationMs ?? inferredDuration ?? gsapDuration;

  if (!DURATION_MS) {
    await browser.close();
    die("Could not infer duration.", "Use --duration explicitly.");
  }

  const FRAME_COUNT   = Math.max(1, Math.round((DURATION_MS / 1000) * FPS));
  const engine        = hasGsap ? "gsap" : hasSMIL ? "smil" : "static";
  const durationLabel = argDurationMs != null ? "explicit" : gsapDuration != null ? "gsap" : "smil";

  console.log(`svg-animation-convert

  input:    ${INPUT}
  output:   ${OUTPUT} (${FORMAT})
  duration: ${DURATION_MS}ms (${durationLabel})
  fps:      ${FPS}  →  ${FRAME_COUNT} frames
  loop:     ${LOOP === 0 ? "infinite" : LOOP === -1 ? "once" : `${LOOP}×`}
  engine:   ${engine}
`);

  if (hasGsap) await page.evaluate(() => {
    gsap.ticker.sleep();             // stop the RAF loop
    gsap.globalTimeline.seek(0, false); // go to t=0, fire all setup callbacks
    gsap.globalTimeline.pause();
  });

  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = i / FPS;
    if (hasGsap) {
      await page.evaluate((t) => { gsap.globalTimeline.seek(t, false); }, t);
    } else {
      await page.evaluate((t) => {
        if (document.documentElement.setCurrentTime)
          document.documentElement.setCurrentTime(t);
      }, t);
    }

    await page.screenshot({
      path: `${FRAME_DIR}/frame-${String(i).padStart(3, "0")}.png`,
      omitBackground: true,
    });
    process.stdout.write(`\r🎞  ${i + 1}/${FRAME_COUNT}`);
  }
  process.stdout.write("\n");

  await browser.close();
  rmSync(tmpHtml, { force: true });

  // Encode
  switch (FORMAT) {
    case "gif":
      execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAME_DIR}/frame-%03d.png" -vf "palettegen=stats_mode=full:reserve_transparent=1" "${PALETTE}"`);
      execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAME_DIR}/frame-%03d.png" -i "${PALETTE}" -lavfi "fps=${FPS},scale=iw:ih:flags=lanczos[x];[x][1:v]paletteuse=dither=none" -loop ${gifLoop} "${OUTPUT}"`);
      break;

    case "apng":
      execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAME_DIR}/frame-%03d.png" -plays ${apngLoop} "${OUTPUT}"`);
      break;

    case "mov":
      execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAME_DIR}/frame-%03d.png" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le "${OUTPUT}"`);
      break;

    case "webm":
      execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAME_DIR}/frame-%03d.png" -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 "${OUTPUT}"`);
      break;
  }

  if (!KEEP_FRAMES) {
    rmSync(FRAME_DIR, { recursive: true, force: true });
  }

  console.log(`✅ ${FORMAT.toUpperCase()} saved as ${OUTPUT}`);
};

main().catch(console.error);
