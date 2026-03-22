---
name: angular-developer
description: Angular 21+ development, focusing on Signals, Standalone Components, and modern best practices; read this whenever you see you are using angular. Skip if you are only writing firebase functions.
---

# Angular 21+ Developer Skill

This skill outlines the mandatory practices for developing Angular applications in v21+. It strictly enforces modern patterns (Signals, Standalone) and bans legacy approaches (Modules, Zone.js patterns).

## Core Principles & "The Banned List"

> [!CAUTION]
> **STRICTLY PROHIBITED PATTERNS**
>
> 1.  **Modules**: Never create `NgModule`. No `CommonModule`, `SharedModule`, etc.
> 2.  **Constructor Injection**: Never use constructor injection. Always use `inject()`.
> 3.  **Legacy Control Flow**: Never use `*ngIf`, `*ngFor`, `*ngSwitch`. Use `@if`, `@for`, `@switch`.
> 4.  **Subscriptions**: Never manually `.subscribe()` in components. Use `toSignal()`, `async` pipe, or `rxResource`.
> 5.  **Zone.js Patterns**: Avoid patterns that rely on Zone.js.
> 6.  **Class-based Inputs/Outputs**: Never use `@Input()` or `@Output()`. Use `input()` and `output()`.

---

## Reactivity with Signals

Signals are the primary mechanism for state, derived state, and side effects.

### Writable State (`signal`)

```typescript
const count = signal(0);
count.set(5);
count.update((c) => c + 1);
```

### Derived State (`computed`)

Pure transformations of other signals.

```typescript
const doubleCount = computed(() => count() * 2);
```

### Derived Writable State (`linkedSignal`)

Prefer `linkedSignal` over `effect` when you need to write a signal value derived from another signal. `linkedSignal` is a writable signal that re-derives from its source when the source changes, but can also be written to independently. Only use `effect` for writing signal values when `linkedSignal` does not work (e.g. when you need to guard against re-derivation based on form dirty state).

```typescript
// Re-derives when source changes, but can be independently written to.
const editable = linkedSignal(() => structuredClone(source()));

// With source comparison to avoid unnecessary re-derivation:
const editable = linkedSignal({
  source: sourceSignal,
  computation: (newVal, previous) => {
    if (previous && deepEqual(newVal, previous.source)) {
      return previous.value;
    }
    return structuredClone(newVal);
  },
});
```

### Side Effects (`effect`)

Use sparingly for logging, manual DOM manipulation, syncing with external APIs, or cases where `linkedSignal` cannot express the required guard logic (e.g. checking form dirty state before syncing).

> [!IMPORTANT]
> **Do NOT use `effect` to write signal values when `linkedSignal` can do the job.** Writing signals inside effects should be a last resort.

```typescript
effect(() => {
  console.log(`Count is ${count()}`);
});
```

### RxJS Interop (`toSignal`, `toObservable`)

```typescript
// Observable -> Signal
const data = toSignal(data$, { initialValue: [] });

// Signal -> Observable
const query$ = toObservable(query);
```

---

## Component Architecture

All components must be **Standalone**.

### Structure

```typescript
@Component({
  selector: "app-user",
  standalone: true, // Default in v19+
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage],
  templateUrl: './user.component.html',
  styleUrl: './user.component.scss',
})
export class UserComponent {
  // Inputs
  name = input.required<string>();
  isAdmin = input(false, { transform: booleanAttribute });

  // Outputs
  update = output<void>();

  // Host Bindings
  // Use 'host' property in component metadata
}
```

### Templates and Styles

Templates should **always** be in a separate file (e.g., `component.html`), as should SCSS styles (`component.scss`). Avoid inline templates or styles unless the component is completely trivial.

### Declarative Checks in Templates

Avoid rewriting the same signal many times with optional chaining and checks. Instead, sensibly bind the signal's value using `@let`.

**❌ Bad:**
```html
@if (order().billingAddress) {
  <div class="small">{{ order().billingAddress?.phone }}</div>
  <div class="small">{{ order().billingAddress?.email }}</div>
}
```

**✅ Good:**
```html
@let billingAddress = order().billingAddress;
@if (billingAddress) {
    <div class="small">{{ billingAddress.phone }}</div>
    <div class="small">{{ billingAddress.email }}</div>
}
```

### Control Flow

```html
@if (isAdmin()) {
<admin-panel />
} @else {
<user-view />
} @for (item of items(); track item.id) {
<item-card [item]="item" />
} @empty {
<p>No items found.</p>
}
```

### Declarative Navigation (Hrefs vs Click Handlers)

Prefer using standard `<a href="...">` tags for navigation instead of `(click)` handlers that programmatically navigate. This improves UI responsiveness, enables standard browser features (like middle-click or hover previews), and enforces better design patterns.

To support this strictly and type-safely, use `routingService.hrefForView(viewName, pathVars?)` directly in the template.

**❌ Bad:**
```html
<div class="card" (click)="handleCardClick()">Navigate</div>
```
```typescript
handleCardClick() {
  if (this.hasAccess()) {
    this.routingService.matchedPatternId.set(Views.Dashboard);
  } else {
    window.open('https://external.link', '_blank');
  }
}
```

**✅ Good:**
```html
<a class="card" 
   [href]="hasAccess() ? routingService.hrefForView('dashboard') : 'https://external.link'"
   [target]="hasAccess() ? '_self' : '_blank'">
  Navigate
</a>
```
```typescript
// In component class:
protected routingService = inject(RoutingService);
```

---

## Routing

Use my routing service to handle routing.

```typescript
import { addUrlParams, pathPattern, pv } from "./routing.utils";
import { RoutingConfig } from "./routing.service";

// TODO: add more details here.
```

---

## Forms (Signal Forms)

Use the new Signal Forms API for type-safe, reactive forms.

```typescript
import { form, required, email } from "@angular/forms/signals";

export class LoginPage {
  // Model
  credentials = signal({ email: "", password: "" });

  // Form with Validation
  loginForm = form(this.credentials, (s) => {
    required(s.email);
    email(s.email);
    required(s.password);
  });

  onSubmit() {
    if (this.loginForm.valid()) {
      // Proceed
    }
  }
}
```

---

## Dependency Injection

Always use `inject()`.

```typescript
@Injectable({ providedIn: "root" })
export class UserService {
  private http = inject(HttpClient); // ✅ Correct
  // constructor(private http: HttpClient) {} // ❌ STOP DOING THIS
}
```

---

## 7. HTTP & Data Fetching

Use `httpResource` for signal-based fetch.

```typescript
// Define resource
userResource = httpResource<User>(() => `/api/users/${this.userId()}`);

// Use in template
@if (userResource.isLoading()) {
  <spinner />
} @else if (userResource.hasValue()) {
  <user-profile [user]="userResource.value()" />
}
```

---

## Testing (Vitest)

Use **Vitest** for all testing.

### Signal Testing

```typescript
it("should update derived state", () => {
  const count = signal(0);
  const double = computed(() => count() * 2);

  count.set(2);
  expect(double()).toBe(4);
});
```

### Component Testing

```typescript
beforeEach(async () => {
  await TestBed.configureTestingModule({
    imports: [CounterComponent], // Import standalone component
  }).compileComponents();
});

it("should increment", () => {
  const fixture = TestBed.createComponent(CounterComponent);
  const component = fixture.componentInstance;

  component.increment();
  expect(component.count()).toBe(1);
});
```

### Mocking with Vitest

```typescript
const spy = vi.fn();
vi.spyOn(service, "method").mockReturnValue(of(data));
```

---

## State Management

- **Local State**: `signal()` inside components.
- **Shared State**: Services with private writable signals and public readonly signals.

```typescript
@Injectable({ providedIn: "root" })
export class GlobalStore {
  private _state = signal(initialState);
  readonly state = this._state.asReadonly();
}
```

---

## Environment & Configuration Management

Manage configuration variables and global links using Angular environment files.

### Setup

- **`src/environments/environment.local.ts`**: Holds local development overrides and sensitive/variable globals (e.g., app-specific product links). This file is **NOT** committed to git.
- **`src/environments/environment.ts`**: The template file that other developers copy. This file **IS** committed to git.

### Best Practices

1. **No Hardcoded Constants in Components**: Move application configuration details (e.g., external product links, support email addresses) out of components (e.g., `home.ts`) and into environment files.
2. **Keep Templates in Sync**: Whenever you add a configuration key to `environment.local.ts`, you **MUST** update `environment.ts` with a template/placeholder value (e.g., `'YOUR_API_KEY'` or `'YOUR_PRODUCT_URL'`). This ensures other developers know the parameter exists when they pull the code.
3. **Usage**:
   ```typescript
   import { environment } from '../../environments/environment';
   
   export class MyComponent {
     protected links = environment.links;
   }
   ```
```
