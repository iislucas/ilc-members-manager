---
name: logo-iteration
description: Iterating on ILC logo SVG quality by comparing generated output against a reference PNG using the pixel diff tool
---

# Logo Iteration Workflow

Use this skill when improving the visual fidelity of the ILC logo SVG generator (`mini-tools/iliqchuan-logo-maker.ts`).

## Environment Setup

### 1. TypeScript Compiler in Watch Mode

Start the compiler in watch mode so changes auto-compile:

```bash
pnpm exec tsc mini-tools/iliqchuan-logo-maker.ts --target ES2020 --module ES2020 --outDir mini-tools/build --skipLibCheck --lib ES2020,DOM --watch
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

### Step 3: Make Changes

Two types of changes:

1. **Code changes** → Edit `iliqchuan-logo-maker.ts` geometry/rendering logic
2. **Default parameter changes** → Edit `iliqchuan-logo-maker.html` slider `value=` attributes

> [!TIP]
> Prefer fixing structural/code issues first (bigger RMSE drops). Parameter adjustments are done by basic in-tool hill-climbing of the parameters to get closer to the reference image.

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
- Whether the change was a code fix or parameter tuning

## Key Files

| File                                       | Role                                          |
| ------------------------------------------ | --------------------------------------------- |
| `mini-tools/iliqchuan-logo-maker.ts`       | SVG generation logic, pixel diff, persistence |
| `mini-tools/iliqchuan-logo-maker.html`     | UI controls with default parameter values     |
| `mini-tools/build/iliqchuan-logo-maker.js` | Compiled output (auto-generated)              |
| `public/iliqchuan-white-bg.png`            | Reference image for pixel diff                |

## Tips

- **Batch 1-2 improvements per round** — easier to validate cause/effect
- **Check both the live preview AND the diff canvases** — the diff renders at a fixed resolution and may highlight issues not obvious in the live preview
- **Use the diff heatmap** to identify which spatial regions have the most error (brightest red)
- **Save good parameter sets** using the "Save Parameters" button before making code changes — you can always "Load Parameters" to restore them
- **The reference image has a white background** — when comparing, ensure `transparentBg` is unchecked
- **Chinese font rendering** may vary across systems — `'Noto Serif SC'` is the preferred web font but may not be installed locally
