# AI Guide: Project Tech Stack and Coding Style

**Purpose:** This guide details the technology stack, coding standards, and
style conventions for the ILC Members Manager. Its purpose is to ensure that any
AI assistant contributing to the project can do so in a consistent and
high-quality manner, adhering to established practices.

You are an expert in TypeScript, Angular, and scalable web application
development. You write maintainable, performant, and accessible code following
Angular and TypeScript best practices.

## 1. Key other files to consult

The key documents to read are (if you are an AI, include these in your context
now):

- [README.md](./README.md): basic goals and details of how to build and test
  the project.
- [STATUS.md](./STATUS.md): the status of milestones, and goals within the
  project.
- [./functions/src/data-model.ts](./functions/src/data-model.ts) contains the
  typescript definitions for the core data structures shared between the server
  and client.

---

## 2. Core Technologies

This project is built on a specific set of technologies. Adherence to these
versions and libraries is crucial.

- **Framework:** **Angular `^21.x.x`**. All components, services, and modules
  should follow Angular best practices, but do NOT use the angular router.
  Always use the Angular CLI for cretaing components:
  `pnpm exec ng generate component ${COMPONENT_NAME} --project=ilc-members-manager`
- **Language:** **TypeScript `~5.9.x`**. All code must be written in TypeScript.
- **Reactivity:** **Angular Signals** are the primary and preferred mechanism
  for managing state and reactivity within components, avoid Observables
  wherever you reasonably can do so.
- **Asynchronous Operations:** **Async/await and Signals** whenever possible.
  use RxJS. only when needed.
- **Server:** **Firebase `^11.10.0`**. Use standard firebase libraries, not
  derived ones (e.g. do not use @angular/fire).
- **HTML Styling:** **SCSS**. Make sure to consult and use colors where
  appropriate from [styles.scss](/src/styles.scss) and
  [scss_variables.scss](/src/scss_variables.scss). Make sure to import using the
  `@use` syntax, not the old deprecated `import` one.

---

## 3. Backend Services

The application uses Google Firebase for its backend infrastructure.

- **Authentication & Database:** Use **Firebase Authentication** for user
  management and **Cloud Firestore** as the primary database for storing
  application data. We use Firebase Security Rules to control who is an admin
  and what permissions they have.
- **Storage:** Use **Firebase Cloud Storage** for any file storage needs, such
  as user profile pictures or other assets.

---

## 4. Coding Style & Formatting

A consistent coding style is enforced to maintain readability and reduce
cognitive load.

- **Formatter:** **Prettier** is the designated code formatter. It should be
  configured in your development environment to format on save.
- **Indentation:** Use **2 spaces** for indentation. Do not use tabs.
- **Quotes:** **Single quotes (`'`)** are mandatory for all TypeScript code,
  including imports and string assignments.
- **Whitespace:**
  - Always trim trailing whitespace from the end of lines.
  - Ensure a single final newline character at the end of every file.
- **Component Prefix:** All newly generated components must use the `app` prefix
  (e.g., `<app-my-component>`).

---

## 5. Angular & TypeScript Best Practices

### TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

### Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

### Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `computed()` for derived state
- Set `changeDetection: ChangeDetectionStrategy.OnPush` in `@Component` decorator
- Prefer inline templates for small components
- Use Signal-based Forms instead of reactive forms.
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead

### State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

### Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables

### Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Use the `inject()` function instead of constructor injection

### 6. CSS Styling

- **Language:** **SCSS** is the standard for all styling.
- **Scope:** All styles should be component-scoped (defined in the component's
  `.scss` file) by default. Only add styles to the global `src/styles.scss` file
  if they are truly global and with good reason.

---

## 7. Testing

- **Frameworks:** **Karma** and **Jasmine** are the frameworks for unit testing.
- **Expectation:** All new components, services, or complex functions should be
  accompanied by a `.spec.ts` file containing meaningful unit tests that cover
  its basic functionality.
