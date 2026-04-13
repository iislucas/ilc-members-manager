import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProposeEventComponent } from './propose-event';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../../firebase-state.service';
import { RoutingService } from '../../routing.service';
import { DataManagerService } from '../../data-manager.service';
import { FIREBASE_APP } from '../../app.config';

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
            instructors: { 
              get: () => null,
              entries: () => []
            } 
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
    }));
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(false);
  });
});
