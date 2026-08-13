/* complete-profile.spec.ts
 *
 * Unit tests for CompleteProfileComponent.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompleteProfileComponent } from './complete-profile';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { SearchableSet } from '../searchable-set';
import { CountryCode } from '../country-codes';
import { initMember, Member, MembershipType } from '../../../functions/src/data-model';

describe('CompleteProfileComponent', () => {
  let fixture: ComponentFixture<CompleteProfileComponent>;
  let component: CompleteProfileComponent;
  let mockFirebaseService: {
    user: ReturnType<typeof signal>;
    logout: ReturnType<typeof vi.fn>;
  };
  let mockDataManager: {
    countries: SearchableSet<'name', CountryCode>;
    updateMember: ReturnType<typeof vi.fn>;
  };
  let userSignal: ReturnType<typeof signal>;

  const sampleMember: Member = {
    ...initMember(),
    docId: 'mem_123',
    memberId: 'US101',
    name: 'Jane Doe',
    emails: ['jane@example.com'],
    currentMembershipExpires: '2026-12-31',
    membershipType: MembershipType.Annual,
    dateOfBirth: '1990-01-01',
    country: 'United States',
    lastUpdated: '2026-01-01',
  };

  beforeEach(async () => {
    userSignal = signal({
      firebaseUser: { email: 'jane@example.com', uid: 'uid_123' },
      member: sampleMember,
    });

    mockFirebaseService = {
      user: userSignal,
      logout: vi.fn().mockResolvedValue({ success: true }),
    };

    mockDataManager = {
      countries: new SearchableSet<'name', CountryCode>(
        ['name', 'id'],
        'name',
        [
          { id: 'US', name: 'United States' },
          { id: 'GB', name: 'United Kingdom' },
        ],
      ),
      updateMember: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [CompleteProfileComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: mockFirebaseService },
        { provide: DataManagerService, useValue: mockDataManager },
        {
          provide: RoutingService,
          useValue: {
            navigateToParts: vi.fn(),
            hrefForView: vi.fn((v: string) => `/${v}`),
          },
        },
      ],
    }).compileComponents();
  });

  async function createComponent(): Promise<void> {
    fixture = TestBed.createComponent(CompleteProfileComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should create component and populate initial signals', async () => {
    await createComponent();
    expect(component).toBeTruthy();
    expect(component.fillName()).toBe('Jane Doe');
    expect(component.fillDOB()).toBe('1990-01-01');
    expect(component.fillCountry()).toBe('United States');
    expect(component.userEmail()).toBe('jane@example.com');
  });

  it('should handle logout action', async () => {
    await createComponent();
    await component.onLogout();
    expect(mockFirebaseService.logout).toHaveBeenCalled();
  });

  it('should submit profile updates to DataManagerService', async () => {
    await createComponent();
    component.fillName.set('Jane Updated');
    await component.submitProfileEnrichment();

    expect(mockDataManager.updateMember).toHaveBeenCalledWith(
      'mem_123',
      expect.objectContaining({
        name: 'Jane Updated',
        dateOfBirth: '1990-01-01',
        country: 'United States',
      }),
      sampleMember,
    );
  });
});
