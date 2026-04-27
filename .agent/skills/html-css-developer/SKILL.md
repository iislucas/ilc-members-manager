---
name: html-css-developer
description: Read this when making HTML templates/files or CSS/SCSS styling changes. Covers the design system, color palette, layout patterns, component styling conventions, and common pitfalls.
---

# HTML & CSS Developer Skill

> [!CAUTION]
> **REUSE EXISTING STYLES — DO NOT RECREATE THEM**
>
> Before writing any new CSS, check `src/styles.scss` and `src/scss_variables.scss` for existing classes and variables. The global stylesheet already provides standardised styles for **buttons** (6 variants), **chips** (7 types), **cards**, **menus**, **inputs**, **search boxes**, and **error containers**. If a global class exists for what you need, use it directly in the HTML — do not redefine it locally in a component's SCSS.
>
> If you need a new shared style, add it to `styles.scss` or `scss_variables.scss` — not in a component file. Component SCSS should only contain **layout and positioning** specific to that component.

## 1. Design Philosophy

The app is a **functional, data-dense management portal** — not a marketing site. The aesthetic priorities are:

1. **Clarity over decoration**: Clean layouts, readable typography, moderate whitespace.
2. **Warm muted palette**: The brand uses `$theme-bg-color` / `$theme-border-color` / `$theme-chip-bg-color` (warm reds/pinks) as the primary accent. Blue (`$theme-tag-*`) is reserved for tags and interactive states.
3. **Subtle depth**: Light box-shadows (`$shadow-color`) and border-based separation rather than heavy gradients.
4. **Responsive simplicity**: Grid/flexbox layouts that collapse gracefully at 600px. No complex responsive breakpoint system — just a single mobile breakpoint.
5. **Reuse global styles**: Shared UI patterns (buttons, chips, cards, menus, inputs, errors) are defined once in `styles.scss`. Component SCSS should only handle layout and component-specific positioning.

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

All colors are defined as SCSS variables in `src/scss_variables.scss`. **Always use the variable name**, never hardcode a hex value that already has a variable.

### Variable Groups

| Group | Variables | Used For |
| --- | --- | --- |
| **Brand / Theme** | `$theme-bg-color`, `$theme-border-color`, `$theme-heading-color-subtle` | Header, footer, form section headings, card backgrounds |
| **Buttons** | `$button-bg-color`, `$button-border-color`, `$button-text-color`, `$button-hover-bg-color`, `$button-active-bg-color` | All `<button>` element states |
| **Shadows** | `$shadow-color`, `$shadow-color-hover`, `$shadow-color-active` | Box-shadow on buttons, cards |
| **Chips** | `$theme-chip-bg-color`, `$theme-chip-border-color` | Level chips, identifier chips, email chips |
| **Tags** | `$theme-tag-bg-color`, `$theme-tag-border-color` | Tag chips (blue-tinted) |
| **Text** | `$text-primary`, `$text-secondary`, `$text-muted`, `$text-placeholder` | Heading, body, label, and metadata text |
| **Borders** | `$border-color-light`, `$separator-color` | Input borders, card outlines, dividers, section separators |
| **Menus** | `$menu-item-hover-color` | Hover state for menu items, subtle-button hover |
| **Errors** | `$theme-error-text-color`, `$theme-error-bg-color`, `$theme-error-border-color` | Error containers |
| **Focus** | `$focus-ring-color` | Search input focus rings, active tab indicators |
| **Headings** | `$heading-accent-color` | Bold accent color for edit-form h3 headings |
| **Lists** | `$row-border-color`, `$row-highlight-bg`, `$row-highlight-border` | Row borders, jump-to-item highlighting |
| **Layout** | `$max-main-width`, `$card-padding`, `$card-sep` | Content width caps, card spacing |

---

## 4. Typography

- **Body font**: `Arial, Helvetica, sans-serif` (set on `body` in `styles.scss`)
- **Monospace**: `monospace` — used for chips (email, identifier, tag), timestamps
- **No external fonts are loaded** (no Google Fonts CDN link)
- **Font sizing**: Mix of relative (`small`, `large`, `em`, `rem`) and keyword sizes

### Global Heading Styles (in `styles.scss` and `app.scss`)

These are set globally — do not redefine heading colors in component SCSS:

| Element | Global Styles | Where Defined |
| --- | --- | --- |
| `h1` | `text-align: center; margin-top: 1em` | `app.scss` (inside `main`) |
| `h2` | `color: $text-primary` | `styles.scss` |
| `h3` | `font-weight: bold; color: $heading-accent-color` | `edit-form.scss` (for form contexts) |

### Typography Utility Classes (in `styles.scss`)

| Class | Styles | Use For |
| --- | --- | --- |
| `.small-email` | `font-size: smaller; font-family: monospace` | Inline email addresses |

---

## 5. Layout Patterns

### App Shell

```
┌─────────────────────────────┐
│  app-header (.nav-bar)      │  ← $theme-bg-color, border-bottom: 2px solid $theme-border-color
├─────────────────────────────┤
│         main                │  ← max-width: $max-main-width, centered, padding: 0 1em
│    ┌───────────────────┐    │
│    │  page content     │    │
│    └───────────────────┘    │
├─────────────────────────────┤
│  app-footer                 │  ← $theme-bg-color, border-top: 2px solid $theme-border-color
└─────────────────────────────┘
```

- `.app-container`: `display: flex; flex-direction: column; min-height: 100vh`
- `main`: `max-width: $max-main-width` (900px), `margin: 0 auto`, `padding: 0 1em`, `flex-grow: 1`
- **All page content is automatically width-constrained by `main`.** Do NOT add `max-width: $max-main-width` to individual component `:host` blocks or wrapper divs — it is redundant and inconsistent.

### Common Page Layouts

1. **Default** — just render content directly. The `main` element handles the max-width constraint automatically.

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

All `<button>` elements are globally styled in `styles.scss`. **Do not re-style buttons in component SCSS** — use the existing variant classes instead:
- Base style: `$button-bg-color` background, `$shadow-color` shadow, hover lift + press push transitions
- Disabled: reduced opacity, no shadow

**Use these existing variant classes** (all defined in `styles.scss`):

| Class | Purpose | When to Use |
| --- | --- | --- |
| _(no class)_ | Default button | Primary actions (Save, Submit) |
| `.icon-only-button` | Circular, transparent, icon-only | Dismiss, toggle, inline actions |
| `.round-button` | Fully circular with padding | Floating actions |
| `.delete-button` | Neutral by default, red on hover | Destructive actions |
| `.inline-link-button` | Looks like a text link | Inline text links that are buttons |
| `.subtle-button` | Transparent with soft hover | Back/navigation, secondary actions |

> [!IMPORTANT]
> If you find yourself writing `background-color`, `border`, `box-shadow`, or `border-radius` for a button in a component SCSS file, **stop** — you almost certainly should be using one of the above global classes instead.

### Cards

Use the `.card` class from `styles.scss` — it provides `$theme-bg-color` background, `$theme-border-color` border, rounded corners, and flex-column layout. Do not redefine card styles locally.

The home page overrides `.card` with white background and interactive hover (lift effect) — this is one of the few cases where a component legitimately overrides a global class.

### Chips

Chips are **all globally defined in `styles.scss`**. Do not create new chip styles in component SCSS — pick the correct existing class:

| Class | Use For | Background Variable |
| --- | --- | --- |
| `.level-chip` | Student/Application levels | `$theme-chip-bg-color` |
| `.tag-chip` | Custom member tags | `$theme-tag-bg-color` (monospace) |
| `.identifier-chip` | IDs, status labels | `$theme-chip-bg-color` (monospace) |
| `.email-chip` | Email addresses | `$theme-chip-bg-color` (monospace) |
| `.missing-identifier-chip` | Missing data placeholders | Dashed border, no fill |
| `.dynamic-identifier-chip` | Editable/dynamic IDs | Dashed border |
| `.active-tag-chip` | Active filter indicators | Blue pill with clear button |

The `.identifier-chip` also supports status modifiers: `.expired-recent`, `.expired-old`, `.status-issue`, `.status-inactive`, `.instructor-id`.

Wrap chips in a `.level-info` flex container:
```html
<div class="level-info">
  <span class="tag-chip">tag1</span>
  <div class="level-chip">Student 3</div>
</div>
```

> [!IMPORTANT]
> If you need a small rounded badge with a background color, it is almost certainly one of the chip classes above. Do not create a new one.

### Menus / Dropdowns

Three global classes in `styles.scss` provide the full menu system:
- **`.menu-style`** — White container with border, shadow, and column flex layout
- **`.menu-item`** — Row inside a menu with icon + label gap and hover state
- **`.menu-overlay`** — Full-screen click-away backdrop (add `.transparent` for invisible variant)

To create a positioned dropdown in a component, `@extend .menu-style` and add positioning:

```scss
@use "../../styles" as *;
.my-dropdown {
  @extend .menu-style;
  position: absolute;
  top: calc(100% + 5px);
  right: 0;
}
```

Do not redefine the menu's background, border, shadow, or padding — it's all in the base class.

### Inputs

Globally styled in `styles.scss`:
- Text/password/email: Bottom border only (`border-bottom: 1px solid #ccc`), rounded corners
- `max-width: 30em`, `flex-grow: 1`
- Disabled: `background-color: #eee; border: none;`
- Date: Full border, auto-width

### Search Boxes

Use the `.list-search-header` pattern from `styles.scss` — it provides a pill-shaped search input with an absolutely-positioned icon and focus ring. The pattern is already used across member-list, school-list, and other list views. Reuse it rather than creating a new search box layout.

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

1. **Reuse first**: Does a global class in `styles.scss` already do what you need? (buttons, chips, cards, menus, inputs, errors, search boxes). If yes, use it — do not recreate it.
2. **Variables**: Are you using SCSS variables from `scss_variables.scss` instead of hardcoding hex colors?
3. **No local button/chip styles**: If your component SCSS contains `background-color`, `border-radius`, or `box-shadow` for a button or chip, you are almost certainly duplicating a global style.
4. **`@use` imports**: If you're using `@extend` or SCSS variables, did you add the `@use` import?
5. **Responsive**: Does the layout work at `max-width: 600px`? Did you add a `@media` query if needed?
6. **Flexbox**: Are you using `flex-wrap: wrap` on row containers that might overflow on small screens?
7. **Form sections**: If editing a form, are you using `edit-form.scss` and its `.form-section` grid pattern?
8. **Icons**: Are you using `<app-icon name="...">` (not raw SVGs, not image tags)?
9. **Transitions**: Did you add a `transition` for any interactive state changes (hover, focus, active)?
10. **Class naming**: Are your class names descriptive and scoped to the component? (e.g., `.member-view-actions`, not `.actions`)
11. **No height/width 100%**: Prefer flex-based sizing.
