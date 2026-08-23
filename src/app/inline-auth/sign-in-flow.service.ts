/* sign-in-flow.service.ts
 *
 * The sign-in attempt currently in progress, shared across route changes
 * within one visit.
 *
 * Someone who types their email on the login page, is told there is no
 * membership for it, and follows "Become a Member" has already answered the
 * question the next page would otherwise ask again — along with the lookup it
 * would otherwise repeat.
 *
 * Deliberately in memory only. This is transient flow state, not a remembered
 * login: it survives an in-app navigation and nothing more, so a reload or a
 * new tab starts clean. What persists is `RememberedLogin` in localStorage,
 * which is only ever written after a sign-in has actually succeeded — see
 * inline-auth.component.ts.
 */

import { Injectable, signal } from '@angular/core';
import { CheckEmailStatusResult } from '../../../functions/src/data-model';

@Injectable({ providedIn: 'root' })
export class SignInFlowService {
  /** The address entered so far, if any. */
  readonly email = signal<string>('');

  /** The lookup for that address, so the next page need not repeat it. */
  readonly status = signal<CheckEmailStatusResult | null>(null);

  /** Called once an email has actually been looked up. */
  record(email: string, status: CheckEmailStatusResult): void {
    this.email.set(email);
    this.status.set(status);
  }

  clear(): void {
    this.email.set('');
    this.status.set(null);
  }
}
