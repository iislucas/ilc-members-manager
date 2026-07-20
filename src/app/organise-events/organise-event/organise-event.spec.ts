import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { ProposeEventComponent } from './organise-event';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../../firebase-state.service';
import { RoutingService } from '../../routing.service';
import { DataManagerService } from '../../data-manager.service';
import { FIREBASE_APP } from '../../app.config';
import { SearchableSet } from '../../searchable-set';

describe('ProposeEventComponent', () => {
  let component: ProposeEventComponent;
  let fixture: ComponentFixture<ProposeEventComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProposeEventComponent],
      providers: [
        { provide: FirebaseStateService, useValue: createFirebaseStateServiceMock() },
        { provide: RoutingService, useValue: { navigateToParts: () => {} } },
        { provide: FIREBASE_APP, useValue: {} },
        {
          provide: DataManagerService,
          useValue: {
            instructors: new SearchableSet(['instructorId'], 'instructorId', []),
          }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProposeEventComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have submit button disabled when form is invalid', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(true);
  });

  it('should enable submit button when form is valid', async () => {
    component.eventModel.update(m => ({
      ...m,
      title: 'Test Event',
      start: '2026-04-04',
      end: '2026-04-05',
      leadingInstructorId: 'FR102',
    }));
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(false);
  });

  it('lists Instructor among the missing required fields when unset', async () => {
    component.eventModel.update(m => ({ ...m, leadingInstructorId: '' }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.missingFields()).toContain('Instructor required.');
  });

  it('defaults the owner to the signed-in submitter and pins them as a manager', async () => {
    const firebaseState = TestBed.inject(FirebaseStateService);
    (firebaseState.user as WritableSignal<unknown>).set({
      member: { docId: 'member-1', name: 'Alice Organiser', memberId: 'FR1' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    // Owner (main contact) defaults to the submitter's member doc.
    expect(component.eventModel().ownerDocId).toBe('member-1');
    // The submitter is shown as a pinned manager row.
    expect(fixture.nativeElement.textContent).toContain('Alice Organiser (you)');
  });
});
