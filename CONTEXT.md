# AI Guide: Project Tech Stack and Coding Style

## 1. Introduction

**Purpose:** This guide details the technology stack, coding standards, and style conventions for the ILC Members Manager. Its purpose is to ensure that any AI assistant contributing to the project can do so in a consistent and high-quality manner, adhering to established practices.

The key documents to read are (if you are an AI, include these in your context):

 * [README.md](./README.md): basic goals and details of how to build and test
   the project.
 * [STATUS.md](./STATUS.md): the status of milestones, and goals within the
   project.

---

## 2. Core Technologies

This project is built on a specific set of technologies. Adherence to these versions and libraries is crucial.

- **Framework:** **Angular `^20.0.0`**. All components, services, and modules
  should follow Angular best practices, but do NOT use the angular router.
- **Language:** **TypeScript `~5.8.2`**. All code must be written in TypeScript.
- **Reactivity:** **Angular Signals** are the primary and preferred mechanism for managing state and reactivity within components, avoid Observables wherever you reasonably can do so.
- **Asynchronous Operations:** **Async/await and Signals** whenever possible. use RxJS. only when needed.
- **Server:** **Firebase `^11.10.0`**. Use standard firebase libraries, not derived ones (e.g. do not use @angular/fire).


---

## 3. Backend Services

The application will rely on Google Firebase for its backend infrastructure.

- **Authentication & Database:** Use **Firebase Authentication** for user management and **Cloud Firestore** as the primary database for storing application data.
- **Storage:** Use **Firebase Cloud Storage** for any file storage needs, such as user profile pictures or other assets.

---

## 4. Coding Style & Formatting

A consistent coding style is enforced to maintain readability and reduce cognitive load.

- **Formatter:** **Prettier** is the designated code formatter. It should be configured in your development environment to format on save.
- **Indentation:** Use **2 spaces** for indentation. Do not use tabs.
- **Quotes:** **Single quotes (`'`)** are mandatory for all TypeScript code, including imports and string assignments.
- **Whitespace:**
    - Always trim trailing whitespace from the end of lines.
    - Ensure a single final newline character at the end of every file.
- **Component Prefix:** All newly generated components must use the `app` prefix (e.g., `<app-my-component>`).

---

## 5. Angular & TypeScript Best Practices

The project enforces a high level of type safety and modern Angular practices.

- **Dependency Injection:** Use the `inject()` function for dependency injection. Avoid constructor property promotion.
  ```typescript
  // Correct
  export class MyService {
    private http = inject(HttpClient);
  }

  // Incorrect
  export class MyService {
    constructor(private http: HttpClient) {}
  }
  ```
- **Component Inputs:** Use signal-based inputs. Avoid the `@Input()` decorator.
  ```typescript
  // Correct
  export class MyComponent {
    name = input<string>(); // Optional input
    id = input.required<string>(); // Required input
  }
  ```
- **Component Outputs:** Use the `output()` function. Avoid the `@Output()` decorator and `EventEmitter`.
  ```typescript
  // Correct
  export class MyComponent {
    itemSelected = output<string>();

    selectItem(id: string) {
      this.itemSelected.emit(id);
    }
  }
  ```
- **Strict Mode:** `strict: true` is enabled. Avoid using the `any` type. All variables and function returns must have explicit types.
- **Error Handling:** Use `unknown` for the type of the error in `catch` blocks to ensure type safety.
  ```typescript
  try {
    // ...
  } catch (error: unknown) {
    // ...
  }
  ```
- **Key Compiler Flags to Respect:**
    - `noImplicitReturns`: Ensure all code paths in a function return a value if the function is declared to do so.
    - `strictTemplates`: In Angular templates, adhere to strict type checking. Ensure all bindings are type-compatible.

---

## 6. Styling

- **Language:** **SCSS** is the standard for all styling.
- **Scope:** All styles should be component-scoped (defined in the component's `.scss` file) by default. Only add styles to the global `src/styles.scss` file if they are truly global and with good reason.

---

## 7. Testing

- **Frameworks:** **Karma** and **Jasmine** are the frameworks for unit testing.
- **Expectation:** All new components, services, or complex functions should be accompanied by a `.spec.ts` file containing meaningful unit tests that cover its basic functionality.