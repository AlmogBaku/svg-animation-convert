# 🖼️  svg-animation-convert

**Convert animated SVGs to high-quality transparent GIF, APNG, MOV, or WEBM — frame-accurate, browser-rendered.**
Powered by Puppeteer + FFmpeg. MIT Licensed.

---

## ✨ Features

- ✅ Converts **animated SVGs** (SMIL, `<animate>`, etc.)
- ✅ Supports **JS/GSAP-animated SVGs** (requires `--duration`)
- ✅ Uses a real browser for **accurate rendering**
- ✅ Supports **transparent backgrounds**
- ✅ Outputs: `.gif`, `.apng`, `.mov`, `.webm`
- ✅ Infers **viewport size** and **animation duration** from SVG (SMIL)
- ✅ Fully configurable via CLI

---

## ⚙️ Requirements

- [**FFmpeg**](https://ffmpeg.org/) installed and available in `$PATH`
- Node.js ≥ 18
- Bun or npm

---

## 📦 Installation

No install needed — use with `bunx` or `npx`:

```bash
bunx svg-animation-convert --input animate.svg --output out.apng
# or
npx svg-animation-convert --input animate.svg --output out.apng
```

---

## 🚀 Usage

```bash
bunx svg-animation-convert --input animate.svg --output out.gif [options]
```

### Required:
- `--input`    — Path to animated SVG
- `--output`   — Output file path (must end in `.gif`, `.apng`, `.mov`, or `.webm`)

### Optional:
| Flag            | Description                                                                 | Default  |
|-----------------|-----------------------------------------------------------------------------|----------|
| `--duration`    | Duration: `4000`, `4000ms`, `4s`, `4.5` (inferred from SMIL or GSAP if omitted) | —        |
| `--fps`         | Frames per second                                                           | `24`     |
| `--loop`        | `0` = infinite, `-1` = once, `N` = N times                                 | `0`      |
| `--frames`      | Temp frame directory                                                        | `frames` |
| `--keep-frames` | Keep PNG frames after encoding                                              | —        |

---

## 🔁 Loop Behavior

| `--loop` | Meaning      | `.gif`     | `.apng`       |
|----------|--------------|------------|---------------|
| `-1`     | Play once    | `-loop -1` | `-plays 1`    |
| `0`      | Loop forever | `-loop 0`  | `-plays 0`    |
| `N > 0`  | Loop N times | `-loop N`  | `-plays N+1`  |

---

## 📂 Example

```bash
bunx svg-animation-convert \
  --input animate.svg \
  --output out.apng \
  --fps 30 \
  --loop 0
```

This:
- Loads `animate.svg` in a headless browser
- Renders each frame at 30 FPS
- Outputs a **transparent APNG**
- Loops the animation forever

### GSAP / JS-animated SVG:

```bash
bunx svg-animation-convert \
  --input gsap-animation.svg \
  --output out.webm \
  --duration 3s \
  --fps 60
```

> **Note:** Duration is inferred from the GSAP timeline automatically. Pass `--duration` to override.

---

## 🧪 Notes

- SMIL animations (`<animate>`, `<set>`, etc.) have duration inferred automatically
- JS/GSAP animations are supported; duration is inferred from the GSAP timeline (pass `--duration` to override)
- Resolution is auto-detected from `viewBox`, `width`, or `height`

---

## 📝 License

[MIT](./LICENSE) — © Almog Baku
