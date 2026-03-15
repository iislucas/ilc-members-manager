---
name: logo-iteration
description: Iterating on ILC logo SVG quality by comparing generated output against a reference PNG using the pixel diff tool
---

# Logo Iteration Workflow

Use this skill when improving the visual fidelity of the ILC logo SVG generator (source in `mini-tools/logo-maker/`).

## Environment Setup

### 1. TypeScript Compiler in Watch Mode

Start the compiler in watch mode so changes auto-compile:

```bash
pnpm exec tsc --project mini-tools/logo-maker/tsconfig.json --watch
```

### 2. HTTP Server

The tool must be served via HTTP (not file://) for module loading and reference image auto-load:

```bash
python3 -m http.server 8079 -d /Users/ldixon/zxd/ilc-members-manager
```

### 3. Open in Browser

```
http://localhost:8079/mini-tools/iliqchuan-logo-maker.html
```

## Iteration Loop

### Step 1: Observe

- Open the tool in the browser
- Take a screenshot showing the **Reference**, **Generated**, and **Diff heatmap** canvases
- Note the **RMSE score**
- Compare them visually: which elements differ most?

### Step 2: Analyze Differences

Common categories of difference (ordered by typical RMSE impact):

| Category        | What to look for                                       | Fix approach                                       |
| --------------- | ------------------------------------------------------ | -------------------------------------------------- |
| **Structural**  | Missing elements, wrong orientation, mirrored shapes   | Fix geometry code in `buildXxxSvg()` functions     |
| **Proportions** | Elements too big/small relative to each other          | Adjust default HTML `value=` attributes on sliders |
| **Fill/stroke** | Wrong fill mode (outline vs filled), wrong colors      | Fix rendering logic in builder functions           |
| **Shapes**      | Tips, spokes, or curves don't match reference contours | Adjust path geometry, bezier control points        |
| **Text**        | Font, size, spacing, position along arc                | Adjust font-family, letter-spacing, text offset    |

Think about changes that make the image structure correct first, such that auto-optimization works better, and avoids local wrong minima spaces of the optimization.

### Step 3: Make Changes

Two types of changes:

1. **Code changes** → Edit the relevant module in `mini-tools/logo-maker/` (see Code Structure below)
2. **Default parameter changes** → Edit `iliqchuan-logo-maker.html` slider `value=` attributes

> [!TIP]
> Prefer fixing structural/code issues first (bigger RMSE drops). Parameter adjustments are done by basic in-tool hill-climbing of the parameters to get closer to the reference image. If the auto-optimization doesn't work for some aspect that you see from visual inspection, suggest to the user possible ways to either ajdust the code so that auto-optimization works better, or suggest modifications to the auto-optimization logic itself.

Make sure the code has appropriate and enough comments to explain the logic. Make sure there are names for the various parts of the image too. For example, the yin-yang is made of two halves, and there are two eyes, and there are rings around the yin-yang. These should be named in the code.

Consider when to break up elements and optimize them independently (e.g. when text should be broken up into individual words or letters and optimized independently, rather than collectively). This is especially relevant when the auto-optimization is not working well for some aspect of the image.

If some value is at the min or max of it's parameter range, consider if the range should be expanded, or if the initial settings are wrong, or something is misplaced leading to the auto-optimization not working well for that aspect. If this happens, think about some change in structure to improve initial settings. e.g. did we add too many cirlces or are we missing one?

Note: All elements in the logo should always exist and have non-zero size. If they get set to zero, consider if the range should be expanded or the element should be removed.

### Step 4: Verify

- If using `--watch`, the TS compiler auto-recompiles; otherwise run the compile command
- Refresh the browser page (hard refresh: Cmd+Shift+R)
- Take a new screenshot
- Compare the new RMSE score to the previous one
- Confirm the diff heatmap shows improvement in the targeted area

### Step 5: Record Progress

After each round, note:

- What was changed
- RMSE before → after
- Update the default parameters in `iliqchuan-logo-maker.html` to the those that were produced after the auto-optimization.
- Consider the next things to do or major changes to update.

## Code Structure

The logo maker source lives in `mini-tools/logo-maker/` as ES modules:

| Module              | Lines | Purpose                                                              |
| ------------------- | ----- | -------------------------------------------------------------------- |
| `types.ts`          | ~75   | `LogoParams` interface, DOM helpers (`$`, `numVal`, `strVal`, etc.)  |
| `params.ts`         | ~100  | `getParams()`, `saveParams()`, `loadParams()` — localStorage I/O    |
| `svg-builders.ts`   | ~300  | All SVG geometry: yin-yang, rings, text arcs, spokes, tips, assembly |
| `pixel-diff.ts`     | ~200  | `updateDiff()` visual heatmap, `computeRMSEFast()` for optimization |
| `optimizer.ts`      | ~150  | `STAGES` config, `runOptimization()` hill-climbing coordinate descent|
| `main.ts`           | ~260  | Entry point: update loop, PNG export, UI wiring, initialization     |

### Import graph

```
main.ts
  ├── types.ts
  ├── params.ts       → types.ts
  ├── svg-builders.ts → types.ts
  ├── pixel-diff.ts   → types.ts, svg-builders.ts
  └── optimizer.ts    → types.ts, params.ts, pixel-diff.ts
```

### Key design patterns

- **Two-pass tip rendering**: `buildTipsSvg()` in `svg-builders.ts` uses a silhouette+interior approach. Pass 1 draws all shapes in `strokeColor` with a thick stroke to create a bordered silhouette. Pass 2 overlays the same shapes in `fillLight` with no stroke, filling the interior white. This creates clean bordered shapes without internal stroke artifacts.
- **Ring-penetrating cutouts**: When tips sit directly on the outer ring (spoke length ≤ 1), the interior pass extends inward past the ring's stroke to erase the ring line under the tip, creating a seamless union.
- **Dependency injection for `update()`**: The optimizer takes `updateFn` as a parameter rather than importing `update()` directly, avoiding circular dependencies.

## Key Files

| File                                       | Role                                          |
| ------------------------------------------ | --------------------------------------------- |
| `mini-tools/logo-maker/*.ts`               | Modular TypeScript source (see table above)   |
| `mini-tools/logo-maker/tsconfig.json`      | TypeScript build config for the modules       |
| `mini-tools/logo-maker/build/*.js`         | Compiled output (auto-generated)              |
| `mini-tools/iliqchuan-logo-maker.html`     | UI controls with default parameter values     |
| `public/iliqchuan-white-bg.png`            | Reference image for pixel diff                |

## Tips

- **Batch 1-2 improvements per round** — easier to validate cause/effect
- **Check both the live preview AND the diff canvases** — the diff renders at a fixed resolution and may highlight issues not obvious in the live preview
- **Use the diff heatmap** to identify which spatial regions have the most error (brightest red)
- **Save good parameter sets** using the "Save Parameters" button before making code changes — you can always "Load Parameters" to restore them
- **The reference image has a white background** — when comparing, ensure `transparentBg` is unchecked
- **Chinese font rendering** may vary across systems — `'Noto Serif SC'` is the preferred web font but may not be installed locally
