---
name: generalist-developer
description: Always read this; it contains the coding standards, tech stack, and best practices for this project, including pnpm (never npm or npx).
---

# ILC Members Manager Developer Guide

This guide details the technology stack, coding standards, and style conventions for the ILC Members Manager.

## 1. Project Overview

The ILC Members Manager is a **member-facing web portal** for the [I Liq Chuan](https://www.iliqchuan.com/) kung fu community. It is **not** just an admin tool — it is designed to be used by **all members** of the organisation, from headquarters administrators down to individual practitioners. The app is intended to work as a **Progressive Web App (PWA)** so it can be installed on phones and tablets for everyday use.

### User Roles

- **ILC Admins (HQ):** Full administrative access — manage all members, schools, orders, instructors, global settings, and backups.
- **School Managers & Instructors:** View the status of all students within their school(s).
- **ILC Practitioners (all members):** View their own membership status, level, and renewal dates (like a digital passbook); update their own contact information; and browse public information such as finding instructors and upcoming events.

### Key Terminology

- **sifu**: the primary instructor of a student.

## 2. Key other files to consult

- [README.md](./README.md): basic goals and details of how to build and test the project.
- [STATUS.md](./STATUS.md): the status of milestones, and goals within the project.
- [./functions/src/data-model.ts](./functions/src/data-model.ts): includes typescript definitions for core data structures.

### Agent Skills Directory

`.agent/skills/` contains skill files with targeted LLM guidance for this project. Each skill is a directory with a `SKILL.md` using YAML frontmatter (`name:`, `description:`).

| Skill | When to read |
|---|---|
| [`codebase-architecture`](.agent/skills/codebase-architecture/SKILL.md) | Always read first — architectural patterns, component map, emulator setup |
| [`generalist-project-developer`](.agent/skills/generalist-project-developer/SKILL.md) | Always read — coding standards, tech stack, best practices (this file) |
| [`angular-developer`](.agent/skills/angular-developer/SKILL.md) | When editing Angular components, templates, or routing |
| [`html-css-developer`](.agent/skills/html-css-developer/SKILL.md) | When editing HTML templates or SCSS styles |
| [`logo-iteration`](.agent/skills/logo-iteration/SKILL.md) | When working on the SVG logo generator in `mini-tools/` |

**Adding a new skill**: create `.agent/skills/{skill-name}/SKILL.md` with frontmatter `name:` and `description:`, then populate it.
**Updating a skill**: edit the relevant `SKILL.md` directly whenever you discover something non-obvious worth preserving across sessions.

---

## 3. Core Technologies

- **Package Manager:** **pnpm**. Use `pnpm` (do NOT use `npm`). Note that if you can't find the command, you may need to load `~/.zshrc` or `~/.bashrc` first.

- **Framework:** **Angular `^21.x.x`**.
  - Do NOT use the angular router.
  - Always use the Angular CLI for creating components: `pnpm exec ng generate component ${COMPONENT_NAME} --project=ilc-members-manager`
- **Language:** **TypeScript `~5.9.x`**.
- **Reactivity:** **Angular Signals** are the primary mechanism for state and reactivity; avoid Observables where possible.
- **Asynchronous Operations:** Prefer **Async/await and Signals**. Use RxJS only when necessary.
- **Server:** **Firebase `^11.10.0`**. Use standard firebase libraries (not @angular/fire).
- **HTML Styling:** **SCSS**. Use colors from `styles.scss` and `scss_variables.scss`. Import using `@use`.

---

## 4. Backend Services

This service used Firebase for the backend.

- **Authentication & Database:** Firebase Authentication and Cloud Firestore.
  - Remember that after updating any firebase firestore structure, you need to update the firebase functions to match the new structure, consider updating ACLs, and review and test the firestore rules.
- **Storage:** Firebase Cloud Storage.
- **Firebase functions:** are used to do things like cache data from one collection to another (used for ACLs, and also to make the web client more efficient).

The current Firebase project ID can be found in the file: `src/environments/environment.local.ts` and `functions/src/environments/environment.ts`.

---

## 5. Coding Style & Formatting

- **Formatter:** Prettier.
- **Indentation:** 2 spaces.
- **Quotes:** Single quotes (`'`) for all TypeScript code.
- **Whitespace:** Trim trailing whitespace and ensure a final newline.
- **Component Prefix:** Use `app` prefix (e.g., `<app-my-component>`).
- **Testing:** All new items should have a `.spec.ts` file with meaningful unit tests.
- **Styling:** Use SCSS for styling. Import using `@use`; avoid height and width of 100% unless really needed. Prefer flexbox and grid layouts.

---

## 6. Angular & TypeScript Best Practices

### TypeScript

- Use strict type checking.
- Prefer type inference.
- DO NOT USE `any` types; use appropriate types from. Use `unknown` where appropriate.
- Prefer taking arguments that are existing object types rather than making special inline types for parts of an object. Types should capture the key conceptual components, and we should take these as arguments.
- Don't use explicit boolean === value checks. Just use the boolean value directly. e.g. don't use `if (isNew === true)` use `if (isNew)`.

### Data Modeling

- **Avoid Partially Defined Objects**: For the main datatypes in this project, we strictly avoid partially defined or optional-field objects. We solve this by implementing an `initObject()` constructor (providing default values for all properties) and a `firestoreDocToObject(doc)` converter that merges database data over the initialized defaults. This guarantees that all application logic can assume defined values for all keys.
- **Always Type Database Writes (Anti-Pattern: Untyped Writes)**: Never pass untyped or loosely typed object structures (like `Record<string, unknown>`) to database write operations (like Firestore's `set()` or `update()`). Instead, always explicitly bind the payload to its corresponding domain model type (e.g. `MemberNotification`) first. This ensures type safety at write time and prevents corrupted or schema-violating records from leaking into the database.
- **Display and Selection Naming Conventions**:
  - **Members/Students**: Always format member display text, autocomplete search terms, and options in dropdowns using the format `({MemberID}) {Member Name}` (e.g., `(US402) Lucas Dixon`).
  - **Instructors**: Always format instructor display text, autocomplete search terms, and options in dropdowns using the format `{Instructor Name} [{Instructor ID}]` (e.g., `Sam Chin [1]`).
  - **ID Extraction**: When autocomplete updates are triggered in input handlers or form setters, always extract the raw ID using the proper regex pattern match (`/^\(([^)]+)\)/` for member IDs inside parentheses at the start, or `/\[([^\]]+)\]$/` for instructor IDs inside brackets at the end) before performing database lookups or persisting to Firestore.

### Angular

- Use signals for state management, and use signal forms.
- Implement lazy loading for feature routes.
- Put host bindings inside the `host` object of the decorator.
- Use `NgOptimizedImage` for static images.
- We use a custom router for handling URLs (see `src/app/routing.service.ts`), which is configured by `src/app/app.config.ts`.

#### Avoid

- Never use `subscribe()` in components – use `toSignal()` or async pipe
- Never use constructor injection – always `inject()`
- Never import `CommonModule`, avoid: (`NgIf`, `NgFor`)
  (Use `@if` / `@for` / `@switch` for control flow)
- Never use `*ngIf` / `*ngFor` – use `@if` / `@for` block syntax
- Never create NgModules – all new code is standalone

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

## 7. CSS Styling

- Use **SCSS** for all styling.
- Styles should be component-scoped by default.

---

## 8. Local Firebase Emulator Development

The app can run entirely locally against the Firebase Emulator Suite — no production data is touched.

### Full startup sequence (order matters)

```bash
# 1. ALWAYS build functions first — emulator loads dist/ at startup, not TS source
#    Ensure functions/src/environment/environment.ts exists (copy from environment.template.ts)
pnpm build:functions

# 2. Start emulators (Firestore 8080, Auth 9099, Functions 5001, Storage 9199, UI 4000)
pnpm emulator:start

# 3. Export anonymized prod data — requires ADC: gcloud auth application-default login
pnpm export:anonymized       # → tmp/seed-data/*.json

# 4. Seed emulator (Firestore data + Auth accounts)
pnpm seed:emulator

# 5. Angular dev server wired to emulators (separate terminal)
pnpm start:emulator
```

**Test login credentials** (password `testpassword123` for all):
- Admin: `member-us536@example.com`
- Regular: `member-pl100@example.com`
- Any member: `member-{memberId.toLowerCase()}@example.com`

> **`tmp/seed-data/` is git-ignored.** Re-run `pnpm export:anonymized` after significant prod data changes.

### How the emulator connection works
- `environment.emulator.ts` sets `useEmulator: true`
- `app.config.ts` calls `connectFirestoreEmulator` / `connectAuthEmulator` / `connectFunctionsEmulator` / `connectStorageEmulator` in an **eager IIFE** (not useFactory) so the default Firebase app is registered at module-load time
- The Angular build config `emulator` (in `angular.json`) swaps in `environment.emulator.ts`

### Key gotchas learned from testing
- **Functions not loaded**: always `pnpm build:functions` BEFORE starting the emulator. Rebuilding while the emulator runs DOES hot-reload JS, but the initial start needs a built dist.
- **Email case**: `checkEmailStatus` lowercases emails. ACL doc IDs are always lowercase. Anonymized emails use `member-{memberId.toLowerCase()}@example.com`.
- **Timestamp deserialization**: `firebase-admin` JSON-exports Timestamps as `{_seconds, _nanoseconds}`. The seed script restores these to proper `Timestamp` objects so `firestoreDocToXxx()` converters work.
- **`onMemberCreated` crash**: expected — FieldValue is unavailable in the Functions emulator for trigger functions. Doesn't block development; ACL is seeded separately.

### Rules tests against the emulator
```bash
pnpm test:rules              # runs Firestore security rules tests using the emulator
```

---

## 9. Testing

After adding or changing anything non-trivial, run `pnpm test` (or the specific test for the affected files) to ensure that things are not broken. Also when making changes consider if new tests should be added.

> [!IMPORTANT]
> **Build Verification**: Test coverage does not cover everything (e.g., Angular template errors or complex type mismatches). After making changes and running tests, you **MUST** also run `pnpm build` to ensure the application builds successfully and catches any errors missed by unit tests.

- Frameworks: `vitest`.
- To run tests for specific angular UI components for a specific file: `pnpm ng test ilc-members-manager --include <filename>`
- To run tests for firebase firestore rules: `pnpm test:rules`
- To run tests for firebase functions: `pnpm test:functions`
  - To run a specific firebase function test: `pnpm exec ts-node --project functions/tsconfig.json functions/src/tests/<function-test-file>.ts`
- Requirement: All new items should have a `.spec.ts` file with meaningful unit tests.
- Mocks: In tests, for mocks, we should treat them as the type they intend to mock. Only when we initialise them, we may use the `as never as TypeName` pattern if we cannot directly specify the `TypeName`. Do not use `any`.

---

## 9. Comments

- Comments should be provided for all aspects of a functions specification that are not obvious from types. e.g. if a function returns a string, the comment should explain what the string represents.
- All comments should be in **English**.
- Don't use /\*_ ... _/ style comments. Use // for function and inline comments. Use /_ ... _/ for multi-line comments.
- The header of every file should have a /_ ... _/ comment describing the file and its purpose, and key aspects of how to use it. If the file is a script, the header comment should also include instructions on how to run it, with an example command line.

---

## 10. LLM Behavioral Guidelines

These guidelines bias toward caution over speed to reduce common LLM coding mistakes. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

