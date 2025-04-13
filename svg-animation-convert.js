#!/usr/bin/env node
import { launch } from "puppeteer";
import { execSync } from "child_process";
import { mkdirSync, rmSync, readFileSync } from "fs";
import path from "path";
import { parse } from "node-html-parser";

// CLI args
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, val] = arg.replace(/^--/, "").split("=");
    return [key, val];
  })
);

const INPUT = args.input;
const OUTPUT = args.output;
const FPS = parseInt(args.fps || "24", 10);
const FRAME_DIR = args.frames || "frames";
const LOOP = parseInt(args.loop ?? "0", 10); // 0 = infinite, -1 = disabled

if (!INPUT || !OUTPUT) {
  console.log(`
Usage:
  svg-animation-convert --input=animation.svg --output=out.gif [--duration=4000] [--fps=24] [--loop=0] [--frames=frames]

Options:
  --input      Path to input SVG file (required)
  --output     Output file path (required; must end in .gif, .apng, .mov, or .webm)
  --duration   Animation duration in milliseconds (inferred from SVG if omitted)
  --fps        Frames per second (default: 24)
  --loop       Loop count (0 = infinite, -1 = no loop) [default: 0]
  --frames     Temporary directory to store frames (default: frames)
`);
  process.exit(1);
}

const FORMAT = path.extname(OUTPUT).slice(1).toLowerCase();
const SUPPORTED_FORMATS = ["gif", "apng", "mov", "webm"];
if (!SUPPORTED_FORMATS.includes(FORMAT)) {
  console.error(`❌ Unsupported format ".${FORMAT}". Supported: ${SUPPORTED_FORMATS.join(", ")}`);
  process.exit(1);
}

// === Infer viewport and duration from SVG ===
const parseSVGMeta = (filePath) => {
  const content = readFileSync(filePath, "utf8");
  const root = parse(content);
  const svg = root.querySelector("svg");

  let width, height;
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const [, , w, h] = viewBox.trim().split(/\s+/).map(Number);
    width = Math.round(w);
    height = Math.round(h);
  } else {
    width = parseInt(svg.getAttribute("width")) || 1920;
    height = parseInt(svg.getAttribute("height")) || 1080;
  }

  let maxTime = 0;
  const animEls = root.querySelectorAll("animate, set, animateTransform");
  for (const el of animEls) {
    const begin = parseFloat((el.getAttribute("begin") || "0").replace("s", ""));
    const durAttr = el.getAttribute("dur");
    const dur = durAttr?.endsWith("s") ? parseFloat(durAttr) : parseFloat(durAttr || "0");
    const end = begin + dur;
    if (!isNaN(end)) maxTime = Math.max(maxTime, end);
  }

  return {
    width,
    height,
    durationMs: maxTime > 0 ? Math.round(maxTime * 1000) : null
  };
};

const { width, height, durationMs: inferredDuration } = parseSVGMeta(INPUT);
const DURATION_MS = parseInt(args.duration, 10) || inferredDuration;

if (!DURATION_MS) {
  console.error("❌ Could not infer duration. Use --duration explicitly.");
  process.exit(1);
}

const FRAME_COUNT = Math.round((DURATION_MS / 1000) * FPS);

// Normalize loop values
const gifLoop = LOOP;
let apngLoop;
if (LOOP === -1) apngLoop = 1;
else if (LOOP === 0) apngLoop = -1;
else apngLoop = LOOP + 1;

// === Main ===
const main = async () => {
  mkdirSync(FRAME_DIR, { recursive: true });

  const browser = await launch();
  const page = await browser.newPage();

  await page.setViewport({
    width,
    height,
    deviceScaleFactor: 1,
    omitBackground: true
  });

  await page.goto("file://" + path.resolve(INPUT));

  for (let i = 0; i < FRAME_COUNT; i++) {
    await page.evaluate((progress) => {
      if (document.documentElement.setCurrentTime) {
        document.documentElement.setCurrentTime(progress);
      }
    }, (i / FPS));

    await page.screenshot({
      path: `${FRAME_DIR}/frame-${i.toString().padStart(3, "0")}.png`,
      omitBackground: true
    });
  }

  await browser.close();

  // Encode
  switch (FORMAT) {
    case "gif":
      execSync(`ffmpeg -y -framerate ${FPS} -i ${FRAME_DIR}/frame-%03d.png -vf "palettegen=stats_mode=full:reserve_transparent=1" palette.png`);
      execSync(`ffmpeg -y -framerate ${FPS} -i ${FRAME_DIR}/frame-%03d.png -i palette.png -lavfi "fps=${FPS},scale=iw:ih:flags=lanczos[x];[x][1:v]paletteuse=dither=none" -loop ${gifLoop} ${OUTPUT}`);
      rmSync("palette.png", { force: true });
      break;

    case "apng":
      execSync(`ffmpeg -y -framerate ${FPS} -i ${FRAME_DIR}/frame-%03d.png -plays ${apngLoop} ${OUTPUT}`);
      break;

    case "mov":
      execSync(`ffmpeg -y -framerate ${FPS} -i ${FRAME_DIR}/frame-%03d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le ${OUTPUT}`);
      break;

    case "webm":
      execSync(`ffmpeg -y -framerate ${FPS} -i ${FRAME_DIR}/frame-%03d.png -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 ${OUTPUT}`);
      break;
  }

  rmSync(FRAME_DIR, { recursive: true, force: true });
  console.log(`${FORMAT.toUpperCase()} saved as ${OUTPUT}`);
};

main().catch(console.error);
