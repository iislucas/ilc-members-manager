---
name: html-css-developer
description: Read this when making HTML template or CSS/SCSS styling changes. Covers the design system, color palette, layout patterns, component styling conventions, and common pitfalls.
---

# HTML & CSS Developer Skill

This skill covers the visual design system, SCSS architecture, and HTML/CSS conventions for the ILC Members Manager. Read this before making any styling or template changes.

## 1. Design Philosophy

The app is a **functional, data-dense management portal** — not a marketing site. The aesthetic priorities are:

1. **Clarity over decoration**: Clean layouts, readable typography, generous whitespace.
2. **Warm muted palette**: Reds/pinks (`#ffeeee`, `#955`, `#eedddd`) as the brand accent, with blue used only for tags and interactive states.
3. **Subtle depth**: Light box-shadows (`0 2px 4px rgba(0,0,0,0.1)`) and border-based separation rather than heavy gradients.
4. **Responsive simplicity**: Grid/flexbox layouts that collapse gracefully at 600px. No complex responsive breakpoint system — just a single mobile breakpoint.
5. **Component-scoped styles**: Each Angular component has its own SCSS file. Shared patterns live in the global `styles.scss`.

---

## 2. Core Files

| File | Purpose |
| --- | --- |
| `src/scss_variables.scss` | All SCSS variables (colors, spacing, shadows) |
| `src/styles.scss` | Global styles: buttons, inputs, chips, menus, cards, errors |
| `src/app/edit-form.scss` | Shared form layout (grid-based, responsive) |
| `src/app/mobile-editor/markdown-styles.scss` | Shared markdown rendering mixin |

### Importing Variables and Styles

```scss
// Standard import pattern for component SCSS files:
@use "../../scss_variables" as *;    // Access all SCSS variables
@use "../../styles" as *;            // Access global classes (needed for @extend)

// Or with a namespace:
@use "../../scss_variables" as v;    // Access via v.$variable-name

// The edit-form shared stylesheet:
@use "../edit-form.scss" as *;       // Used by member-details, event-edit, school-edit, etc.
```

---

## 3. Color Palette

### Theme Colors (SCSS Variables)

```scss
// Brand / Theme
$theme-bg-color: #ffeeee;           // Light pink — header, footer, form section headings, cards
$theme-border-color: #955;          // Dark red — primary borders (header/footer stripe)
$theme-heading-color-subtle: #777;  // Form section heading text

// Buttons
$button-bg-color: #bbf;             // Light blue-violet
$button-border-color: #66a;
$button-text-color: #222;
$button-hover-bg-color: #aae;
$button-active-bg-color: #99d;

// Shadows
$shadow-color: rgba(0, 0, 0, 0.1);
$shadow-color-hover: rgba(0, 0, 0, 0.15);
$shadow-color-active: rgba(0, 0, 0, 0.2);

// Chips
$theme-chip-bg-color: #eedddd;      // Warm pink-beige
$theme-chip-border-color: #caa;
$theme-tag-bg-color: #e0f2fe;       // Light blue (for tags)
$theme-tag-border-color: #bae6fd;

// Menus
$menu-item-hover-color: #ddf;       // Light blue hover for menu items

// Errors
$theme-error-text-color: #744;
$theme-error-bg-color: #ffdddd;
$theme-error-border-color: #c99;

// Lists
$row-border-color: #ebebeb;
$row-highlight-bg: #f4f9ff;
$row-highlight-border: #4da3ff;

// Layout
$max-main-width: 800px;
$card-padding: 10px;
$card-sep: 0.75em;
```

### Hardcoded Colors in Use

These appear frequently inline and should be reused consistently:

| Color | Usage |
| --- | --- |
| `#333` | Primary text |
| `#555` | Secondary text, labels |
| `#666` | Muted text, descriptions |
| `#777` | Subtle text, IDs |
| `#888` | Search icons, placeholder-like elements |
| `#ccc` | Borders, dividers (most common border) |
| `#eee` | Light separators, disabled backgrounds |
| `#007bff` | Focus rings (search inputs) |
| `#0066cc` | Link text |
| `#722` | Dark red heading text (form sections) |
| `white` | Card backgrounds, menu backgrounds |

---

## 4. Typography

- **Body font**: `Arial, Helvetica, sans-serif` (set on `body` in `styles.scss`)
- **Monospace**: `monospace` — used for chips (email, identifier, tag), timestamps
- **No external fonts are loaded** (no Google Fonts CDN link)
- **Font sizing**: Mix of relative (`small`, `large`, `em`, `rem`) and keyword sizes
- **Headings**: `h1` centered, `h3` bold with color `#722` in form contexts

### Typography Scale (Common Patterns)

```scss
// Headings
h1    { text-align: center; margin-top: 1em; }
h2    { font-size: 1.25rem – 1.5rem; color: #333; }
h3    { font-weight: bold; color: #722; font-size: 1.1em; }  // In .form-section

// Body text
p     { color: #666; font-size: 0.9rem; line-height: 1.4; }

// Small / metadata
.note          { font-size: small; color: #555; }
.timestamp     { font-family: monospace; font-size: small; }
.small-email   { font-size: smaller; font-family: monospace; }
```

---

## 5. Layout Patterns

### App Shell

```
┌─────────────────────────────┐
│  app-header (.nav-bar)      │  ← $theme-bg-color, border-bottom: 2px solid $theme-border-color
├─────────────────────────────┤
│  main                       │  ← flex-column, margin: 0 1em, flex-grow: 1
│    ┌───────────────────┐    │
│    │  page content      │    │
│    └───────────────────┘    │
├─────────────────────────────┤
│  app-footer                 │  ← $theme-bg-color, border-top: 2px solid $theme-border-color
└─────────────────────────────┘
```

- `.app-container`: `display: flex; flex-direction: column; min-height: 100vh`
- `main`: `flex-grow: 1; gap: 1em;` content stretches vertically

### Common Page Layouts

1. **Centered container** (`max-width` + `margin: 0 auto`):
   ```scss
   .home-container { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
   .organise-event-container { max-width: 800px; margin: 0 auto; }
   ```

2. **Full-stretch list** (`:host` as flex column):
   ```scss
   :host {
     display: flex;
     flex-direction: column;
     justify-content: start;
     align-items: stretch;
     flex-grow: 1;
   }
   ```

3. **Cards grid** (auto-fill with minmax):
   ```scss
   .cards-grid {
     display: grid;
     grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
     gap: 1rem;
   }
   ```

### Flexbox Patterns

The app uses flexbox extensively. Common patterns:

```scss
// Row with centered items and wrapping
.row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 1em;
}

// Space-between actions bar
.form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

// Search/filter header
.search-header {
  display: flex;
  flex-direction: row;
  gap: 1rem;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}
```

### Grid Pattern (Edit Forms)

The shared `edit-form.scss` uses a two-column grid for label/input pairs:

```scss
.form-section {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px 20px;
  align-items: center;

  h3 { grid-column: 1 / -1; }    // Headings span full width
  p  { grid-column: 1 / -1; }    // Paragraphs span full width

  @media (max-width: 600px) {
    grid-template-columns: 1fr;   // Stack on mobile
  }
}
```

---

## 6. Component Catalogue

### Buttons

All `<button>` elements are globally styled in `styles.scss`:
- Flex container with centered content and gap
- Blue-violet background (`$button-bg-color: #bbf`)
- Subtle shadow + hover lift + press push transitions
- Disabled: reduced opacity, no shadow

**Button variants** (add these classes):

| Class | Purpose |
| --- | --- |
| `.icon-only-button` | Circular, transparent, icon-only (no bg, no border, no shadow) |
| `.round-button` | Fully circular with padding |
| `.delete-button` | Neutral by default, red on hover |
| `.inline-link-button` | Looks like a text link (underlined, blue, no bg/border) |
| `.subtle-button` | Transparent, used for back/navigation; hover shows soft bg |

### Cards

```scss
.card {
  background-color: $theme-bg-color;  // Light pink
  border-radius: 0.5em;
  padding: 1em;
  border: 1px solid $theme-border-color;
  min-width: 7em;
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: 0.3em;
}
```

Home page cards override this with white background and interactive hover (lift effect).

### Chips

Chips are globally defined. Use the correct class for the content type:

| Class | Use For | Background |
| --- | --- | --- |
| `.level-chip` | Student/Application levels | `$theme-chip-bg-color` (warm pink) |
| `.tag-chip` | Custom member tags | `$theme-tag-bg-color` (light blue), monospace |
| `.identifier-chip` | IDs, status labels | `$theme-chip-bg-color`, monospace |
| `.email-chip` | Email addresses | `$theme-chip-bg-color`, monospace |
| `.missing-identifier-chip` | Missing data placeholders | Dashed border |
| `.dynamic-identifier-chip` | Editable/dynamic IDs | Dashed border |
| `.active-tag-chip` | Active filter indicators | Blue pill with clear button |

Wrap chips in `.level-info` container:
```html
<div class="level-info">
  <span class="tag-chip">tag1</span>
  <div class="level-chip">Student 3</div>
</div>
```

### Menus / Dropdowns

```scss
.menu-style {
  background-color: white;
  border: 1px solid #ccc;
  border-radius: 5px;
  padding: 0.4em;
  z-index: 100;
  box-shadow: 4px 4px 4px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
}

.menu-item {
  padding: 0.5em;
  white-space: nowrap;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.75em;
}

.menu-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(0, 0, 0, 0.1);
  z-index: 50;
  &.transparent { background-color: transparent; }
}
```

Usage: Components `@extend .menu-style` (requires `@use "../../styles" as *;`).

### Inputs

Globally styled in `styles.scss`:
- Text/password/email: Bottom border only (`border-bottom: 1px solid #ccc`), rounded corners
- `max-width: 30em`, `flex-grow: 1`
- Disabled: `background-color: #eee; border: none;`
- Date: Full border, auto-width

### Search Boxes

```scss
.list-search-header .search-box {
  position: relative;
  input[type="text"] {
    padding: 8px 8px 8px 35px;  // Space for icon
    border: 1px solid #ccc;
    border-radius: 20px;        // Pill shape
    &:focus {
      border-color: #007bff;
      box-shadow: 0 0 5px rgba(0, 123, 255, 0.3);
    }
  }
  .search-icon {
    position: absolute;
    left: 10px;
    color: #888;
  }
}
```

### Error Containers

```html
<div class="error-container">
  <span class="error-message">Something went wrong</span>
  <button class="icon-only-button" (click)="dismiss()">
    <app-icon name="close"></app-icon>
  </button>
</div>
```

### Spinner / Loading

- `<app-spinner>` component wraps a loading message
- Header uses a `.loading-slider` CSS animation (sliding bar)

---

## 7. Icons

The app uses a **custom inline SVG icon system** via `<app-icon name="...">`:

```html
<app-icon name="search"></app-icon>
<app-icon name="close"></app-icon>
<app-icon name="arrow_back"></app-icon>
<app-icon name="visibility"></app-icon>
```

- Icons are embedded SVG data in `src/app/icons/icon-data.ts`
- The component sets `display: inline-block` on host
- Icon names follow Material Icons naming convention
- Size/fill can be customized via inputs: `width`, `height`, `fill`

---

## 8. Responsive Design

### The Single Breakpoint

The app uses **one primary breakpoint**: `max-width: 600px` (mobile).

```scss
@media (max-width: 600px) {
  // Grid collapses to single column
  .form-section { grid-template-columns: 1fr; }
  // Cards go full-width
  .cards-grid { grid-template-columns: 1fr; }
  // Form actions stack vertically
  .form-actions { flex-direction: column; align-items: flex-start; }
}
```

A few components also use `768px` for tablet-width adjustments (import-export).

### Responsive Patterns

- **Grid collapse**: `grid-template-columns` goes from `auto 1fr` to `1fr`
- **Flex wrap**: Use `flex-wrap: wrap` on row containers
- **`max-width` constraints**: Content areas capped at `800px` or `1200px`
- **No height/width: 100%** unless truly needed (prefer flexbox grow)

---

## 9. Transitions & Animations

The app uses **subtle, functional transitions** — not decorative animations:

```scss
// Standard hover/interaction transition
transition: all 0.2s ease-in-out;

// Header resize animation (logged-in ↔ logged-out)
transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);

// Search input focus
transition: border-color 0.3s ease, box-shadow 0.3s ease;

// Card hover lift
transition: transform 0.2s, box-shadow 0.2s;

// Form section border reveal
transition: border-color 0.3s ease-in-out;
```

The only keyframe animation is `.loading-slider` (header loading bar).

---

## 10. Common Pitfalls

### SCSS `@use` Does NOT Copy CSS Rules

`@use "../../styles" as *;` only makes **variables, mixins, and functions** available. It does **not** copy CSS class definitions into the component's stylesheet. If you need a global class:
- Define it in `src/styles.scss` (it will be globally available to all HTML)
- Or use `@extend .global-class` (which requires `@use` of the source file)

### `@extend` Requires `@use`

```scss
// ✅ Correct — class can be found and extended
@use "../../styles" as *;
.my-menu { @extend .menu-style; }

// ❌ Wrong — SCSS compiler error: ".menu-style does not exist"
.my-menu { @extend .menu-style; }
```

### Class Name Mismatches

Angular's ViewEncapsulation.Emulated scopes all component SCSS classes. If a class in the HTML doesn't match any class in the component's SCSS **or** in global `styles.scss`, it will have no effect. Always verify class names match.

### Avoid These

- ❌ `height: 100%` / `width: 100%` — prefer flexbox `flex-grow: 1` and `align-items: stretch`
- ❌ `@import` — always use `@use`
- ❌ `::ng-deep` — avoid unless absolutely necessary (e.g., styling third-party editor content like ProseMirror)
- ❌ Inline styles — use SCSS classes
- ❌ `ngClass` / `ngStyle` — use native class/style bindings

---

## 11. Checklist for HTML/CSS Changes

Before submitting any styling change:

1. **Variables**: Are you using SCSS variables from `scss_variables.scss` instead of hardcoding theme colors?
2. **Global classes**: Is there already a global class in `styles.scss` for what you're building (chip, button variant, menu, error)?
3. **`@use` imports**: If you're using `@extend` or SCSS variables, did you add the `@use` import?
4. **Responsive**: Does the layout work at `max-width: 600px`? Did you add a `@media` query if needed?
5. **Flexbox**: Are you using `flex-wrap: wrap` on row containers that might overflow on small screens?
6. **Form sections**: If editing a form, are you using `edit-form.scss` and its `.form-section` grid pattern?
7. **Icons**: Are you using `<app-icon name="...">` (not raw SVGs, not image tags)?
8. **Transitions**: Did you add a `transition` for any interactive state changes (hover, focus, active)?
9. **Class naming**: Are your class names descriptive and scoped to the component? (e.g., `.member-view-actions`, not `.actions`)
10. **No height/width 100%**: Prefer flex-based sizing.
