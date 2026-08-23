/* login.spec.ts
 *
 * The login page is a thin wrapper: the guided sign-in flow it renders is
 * covered by inline-auth.component.spec.ts. What matters here is that the page
 * enables the one behaviour that distinguishes it from the embedded uses —
 * guidance for an email with no membership record.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoginComponent } from './login';
import { InlineAuthComponent, InlineAuthStep } from '../inline-auth/inline-auth.component';
import {
  createFirebaseStateServiceMock,
  FirebaseStateService,
} from '../firebase-state.service';
import { RoutingService } from '../routing.service';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let mockService: FirebaseStateService;

  beforeEach(async () => {
    localStorage.clear();
    mockService = createFirebaseStateServiceMock();

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: mockService },
        {
          provide: RoutingService,
          useValue: { navigateToParts: vi.fn(), hrefForView: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should render the shared sign-in flow', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-inline-auth')).toBeTruthy();
    expect(compiled.querySelector('#email-input')).toBeTruthy();
  });

  it('should explain the dead end when an email matches no membership', async () => {
    vi.spyOn(mockService, 'checkEmailStatus').mockResolvedValue({
      hasMemberRecord: false,
      hasAuthAccount: false,
      isGoogleManaged: false,
    });

    const auth = fixture.debugElement
      .query((node) => node.componentInstance instanceof InlineAuthComponent)
      .componentInstance as InlineAuthComponent;

    auth.email.set('stranger@example.com');
    await auth.checkEmail();
    fixture.detectChanges();

    // The purchase pages deliberately do not do this; see login.ts.
    expect(auth.step()).toBe(InlineAuthStep.NoMember);
    expect((fixture.nativeElement as HTMLElement).querySelector('#become-member-btn')).toBeTruthy();
  });
});
