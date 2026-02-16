---
name: angular-developer
description: Comprehensive guide for Angular 21+ development, focusing on Signals, Standalone Components, and modern best practices.
---

# Angular 21+ Developer Skill

This skill outlines the mandatory practices for developing Angular applications in v21+. It strictly enforces modern patterns (Signals, Standalone) and bans legacy approaches (Modules, Zone.js patterns).

## 1. Core Principles & "The Banned List"

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

## 2. Reactivity with Signals

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

### Side Effects (`effect`)

Use sparingly for logging, manual DOM manipulation, or syncing with external APIs.

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

## 3. Component Architecture

All components must be **Standalone**.

### Structure

```typescript
@Component({
  selector: "app-user",
  standalone: true, // Default in v19+
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage],
  template: `
    <h2>{{ name() }}</h2>
    <p>Status: {{ status() }}</p>
  `,
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

---

## 4. Routing

Use functional guards/resolvers and lazy loading.

### Configuration

```typescript
export const routes: Routes = [
  // Lazy load component
  {
    path: "settings",
    loadComponent: () => import("./settings/settings.component").then((m) => m.Settings),
  },
  // Lazy load feature routes
  {
    path: "admin",
    loadChildren: () => import("./admin/admin.routes").then((m) => m.adminRoutes),
    canActivate: [authGuard], // Functional guard
  },
];
```

### Route Params as Signals

Enable `withComponentInputBinding()` in `app.config.ts`.

```typescript
@Component({...})
export class UserDetail {
  // Route param :id automatically bound to signal input
  id = input.required<string>();

  // Computed derived from route param
  userId = computed(() => parseInt(this.id(), 10));
}
```

---

## 5. Forms (Signal Forms)

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

## 6. Dependency Injection

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

## 8. Testing (Vitest)

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

## 9. State Management

- **Local State**: `signal()` inside components.
- **Shared State**: Services with private writable signals and public readonly signals.

```typescript
@Injectable({ providedIn: "root" })
export class GlobalStore {
  private _state = signal(initialState);
  readonly state = this._state.asReadonly();
}
```
