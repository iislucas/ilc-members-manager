---
name: generalist-project-developer
description: Project-specific coding standards, tech stack, and best practices for the ILC Members Manager.
---

# ILC Members Manager Developer Guide

This guide details the technology stack, coding standards, and style conventions for the ILC Members Manager.

Some language from Kung Fu / I Liq Chuan that is used:

- sifu: this refers to the primary instructor of a student.

## 1. Key other files to consult

- [README.md](./README.md): basic goals and details of how to build and test the project.
- [STATUS.md](./STATUS.md): the status of milestones, and goals within the project.
- [./functions/src/data-model.ts](./functions/src/data-model.ts): includes typescript definitions for core data structures.

---

## 2. Core Technologies

- **Package Manager:** **pnpm**. Use `pnpm` (do NOT use `npm`).
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

This service used Firebase for the backend.

- **Authentication & Database:** Firebase Authentication and Cloud Firestore.
  - Remember that after updating any firebase firestore structure, you need to update the firebase functions to match the new structure, consider updating ACLs, and review and test the firestore rules.
- **Storage:** Firebase Cloud Storage.
- **Firebase functions:** are used to do things like cache data from one collection to another (used for ACLs, and also to make the web client more efficient).

The current Firebase project ID can be found in the file: `src/environments/environment.local.ts` and `functions/src/environments/environment.ts`.

---

## 4. Coding Style & Formatting

- **Formatter:** Prettier.
- **Indentation:** 2 spaces.
- **Quotes:** Single quotes (`'`) for all TypeScript code.
- **Whitespace:** Trim trailing whitespace and ensure a final newline.
- **Component Prefix:** Use `app` prefix (e.g., `<app-my-component>`).
- **Testing:** All new items should have a `.spec.ts` file with meaningful unit tests.

---

## 5. Angular & TypeScript Best Practices

### TypeScript

- Use strict type checking.
- Prefer type inference.
- DO NOT USE `any` types; use appropriate types from. Use `unknown` where appropriate.
- Prefer taking arguments that are existing object types rather than making special inline types for parts of an object. Types should capture the key conceptual components, and we should take these as arguments.

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
- To run tests for specific angular UI components for a specific file: `pnpm ng test ilc-members-manager --include <filename>`
- To run tests for firebase firestore rules: `pnpm test:rules`
- To run tests for firebase functions: `pnpm test:functions`
  - To run a specific firebase function test: `pnpm exec ts-node --project functions/tsconfig.json functions/src/tests/<function-test-file>.ts`
- Requirement: All new items should have a `.spec.ts` file with meaningful unit tests.
