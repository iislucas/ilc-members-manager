---
name: generalist-project-developer
description: Project-specific coding standards, tech stack, and best practices for the ILC Members Manager.
---

# ILC Members Manager Developer Guide

This guide details the technology stack, coding standards, and style conventions for the ILC Members Manager. 

## 1. Key other files to consult

- [README.md](./README.md): basic goals and details of how to build and test the project.
- [STATUS.md](./STATUS.md): the status of milestones, and goals within the project.
- [./functions/src/data-model.ts](./functions/src/data-model.ts): includes typescript definitions for core data structures.

---

## 2. Core Technologies

- **Framework:** **Angular `^21.x.x`**. 
  - Do NOT use the angular router.
  - Always use the Angular CLI for creating components: `pnpm exec ng generate component ${COMPONENT_NAME} --project=ilc-members-manager`
- **Language:** **TypeScript `~5.9.x`**.
- **Reactivity:** **Angular Signals** are the primary mechanism for state and reactivity; avoid Observables where possible.
- **Asynchronous Operations:** Prefer **Async/await and Signals**. Use RxJS only when necessary.
- **Server:** **Firebase `^11.10.0`**. Use standard firebase libraries (not @angular/fire).
- **HTML Styling:** **SCSS**. Use colors from `styles.scss` and `scss_variables.scss`. Import using `@use`.

---

## 3. Backend Services

- **Authentication & Database:** Firebase Authentication and Cloud Firestore.
- **Storage:** Firebase Cloud Storage.

---

## 4. Coding Style & Formatting

- **Formatter:** Prettier.
- **Indentation:** 2 spaces.
- **Quotes:** Single quotes (`'`) for all TypeScript code.
- **Whitespace:** Trim trailing whitespace and ensure a final newline.
- **Component Prefix:** Use `app` prefix (e.g., `<app-my-component>`).

---

## 5. Angular & TypeScript Best Practices

### TypeScript
- Use strict type checking.
- Prefer type inference.
- Avoid `any`, use `unknown`.

### Angular
- Use standalone components.
- Use signals for state management.
- Implement lazy loading for feature routes.
- Put host bindings inside the `host` object of the decorator.
- Use `NgOptimizedImage` for static images.

### Components
- Focus on single responsibility.
- Use `input()` and `output()` functions.
- Use `computed()` for derived state.
- Set `changeDetection: ChangeDetectionStrategy.OnPush`.
- Prefer inline templates for small components.
- Use Signal-based Forms.
- Do NOT use `ngClass` or `ngStyle`; use native class/style bindings.

### State Management
- Use signals for local state and `computed()` for derived state.
- Keep transformations pure.
- Use `update` or `set` on signals, never `mutate`.

### Templates
- Keep them simple.
- Use native control flow (`@if`, `@for`, `@switch`).
- Use the async pipe for observables.

### Services
- Single responsibility.
- Use `providedIn: 'root'`.
- Use the `inject()` function.

---

## 6. CSS Styling
- Use **SCSS** for all styling.
- Styles should be component-scoped by default.

---

## 7. Testing
- Frameworks: **Karma** and **Jasmine**.
- Requirement: All new items should have a `.spec.ts` file with meaningful unit tests.
