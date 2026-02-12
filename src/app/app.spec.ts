import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from './firebase-state.service';
import { ROUTING_CONFIG, Views, initPathPatterns } from './app.config';
import { DataManagerService, DataServiceState } from './data-manager.service';
import { signal } from '@angular/core';

describe('App', () => {
  let firebaseStateServiceMock: Partial<FirebaseStateService>;
  let dataManagerServiceMock: Partial<DataManagerService>;

  beforeEach(async () => {
    firebaseStateServiceMock = createFirebaseStateServiceMock();
    dataManagerServiceMock = {
      loadingState: signal(DataServiceState.Loaded) as any,
      members: { loaded: signal(true) } as any,
      schools: { loaded: signal(true) } as any,
      instructors: { loaded: signal(true) } as any,
      myStudents: { loaded: signal(true) } as any,
    };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: firebaseStateServiceMock },
        { provide: DataManagerService, useValue: dataManagerServiceMock },
        {
          provide: ROUTING_CONFIG,
          useValue: {
            validPathPatterns: initPathPatterns,
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    await fixture.whenStable();
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('ILC App');
  });
});
