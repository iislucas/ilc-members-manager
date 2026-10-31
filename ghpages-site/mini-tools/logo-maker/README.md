# I Liq Chuan Logo Maker

Interactive SVG generator for the [I Liq Chuan](https://www.iliqchuan.com/) emblem.
Tweak parameters with sliders, compare against a reference PNG, run an optimizer,
and export the result as SVG or PNG.

## Architecture

This is a **TypeScript** application. The source `.ts` files in this directory
are compiled to ES-module JavaScript in the `build/` folder, which is loaded by
the HTML entry point (`./iliqchuan-logo-maker.html`) via:

```html
<script type="module" src="build/main.js"></script>
```

### Source files

| File              | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `types.ts`        | Shared `LogoParams` interface and DOM helper utilities |
| `params.ts`       | Read / write parameters from DOM inputs & localStorage |
| `svg-builders.ts` | Pure functions that produce SVG markup strings         |
| `pixel-diff.ts`   | Canvas-based pixel comparison against a reference PNG  |
| `optimizer.ts`    | Hill-climbing optimizer that minimises RMSE vs. ref    |
| `main.ts`         | Entry point — wires DOM events and drives the UI loop  |

### Build output

Compiled `.js` files go into `build/` (configured via `tsconfig.json → outDir`) and are committed so GitHub Pages can serve both `iliqchuan-logo-maker.html` and `chinese-glyph-maker.html` directly. Run `pnpm run build` whenever editing `.ts` files.

## Prerequisites

- **Node.js** ≥ 18
- **pnpm** (the project standard; do not use npm/npx)

## Getting started

```bash
# 1. Install dependencies (run from this directory)
cd mini-tools/logo-maker
pnpm install

# 2. Build once
pnpm run build

# 3. Or: build + watch + serve in one command
pnpm run dev
```

Then open:
- <http://localhost:8000/iliqchuan-logo-maker.html> — full concentric emblem generator
- <http://localhost:8000/chinese-glyph-maker.html> — standalone Chinese calligraphic character (`意`, `力`, `拳`) SVG approximator

## Chinese Character SVG Maker (`chinese-glyph-maker.html`)

A dedicated interactive SVG approximator for the three calligraphic characters (**意**, **力**, **拳**) extracted and de-rotated from `assets/ILC-Logo-from-yen.jpeg` into `200×200` alpha-coverage reference PNGs (`assets/char-yi.png`, `assets/char-li.png`, `assets/char-quan.png`).

### Glyph Maker modules (`glyph-maker/`)

| File                       | Purpose                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| `glyph-maker/types.ts`     | Enums (`GlyphId`, `EditorBackdrop`, `EditorTool`) and `[x, y, r]` stroke models  |
| `glyph-maker/defaults.ts`  | Optimized multi-anchor stroke definitions for `意`, `力`, `拳` and JSON validators |
| `glyph-maker/stroke-svg.ts`| Centripetal Catmull-Rom variable-radius disk-envelope `<path>` builder           |
| `glyph-maker/editor.ts`    | Interactive canvas editor for viewing, moving, adding, resizing, & deleting anchors |
| `glyph-maker/pixel-diff.ts`| Synchronous `Path2D` alpha comparison and signed Red/Cyan coverage diff          |
| `glyph-maker/optimizer.ts` | Regularized coordinate-descent optimizer over global, stroke, and `[x, y, r]` params |
| `glyph-maker/main.ts`      | Entry point wiring tabs, Undo history, localStorage, and standalone SVG/PNG export |

## Available scripts

| Script       | What it does                                                               |
| ------------ | -------------------------------------------------------------------------- |
| `pnpm build` | Compile TypeScript → `build/`                                              |
| `pnpm watch` | Compile in watch mode (rebuilds on save)                                   |
| `pnpm serve` | Start `http-server` on port 8000 (serves the project root, cache disabled) |
| `pnpm dev`   | Run `watch` and `serve` concurrently — the fastest way to iterate          |

> **Note:** The `serve` script uses `http-server` (installed as a devDependency)
> with caching disabled (`-c-1`) for a smooth dev experience.

## Building from the project root

You can also compile without `cd`-ing into this directory:

```bash
pnpm exec tsc --project mini-tools/logo-maker/tsconfig.json
```
