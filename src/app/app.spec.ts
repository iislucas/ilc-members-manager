import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from './firebase-state.service';
import { ROUTING_CONFIG } from './routing.config';
import { Views } from './app.config';

describe('App', () => {
  let firebaseStateServiceMock: Partial<FirebaseStateService>;

  beforeEach(async () => {
    firebaseStateServiceMock = createFirebaseStateServiceMock();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: firebaseStateServiceMock },
        {
          provide: ROUTING_CONFIG,
          useValue: {
            pathParams: { view: Views.Members },
            urlParams: { memberId: '' },
            paths: [':view'],
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      'ILC Members Manager'
    );
  });
});
