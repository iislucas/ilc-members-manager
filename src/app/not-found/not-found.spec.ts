import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NotFoundComponent } from './not-found';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('NotFoundComponent', () => {
  let component: NotFoundComponent;
  let fixture: ComponentFixture<NotFoundComponent>;
  let routingService: RoutingService<any>;

  const mockFirebaseState = {
    user: signal(null),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotFoundComponent],
      providers: [
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        RoutingService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotFoundComponent);
    component = fixture.componentInstance;
    routingService = TestBed.inject(RoutingService);
  });

  it('should create the not found component', () => {
    expect(component).toBeTruthy();
  });

  it('should navigate home on goHome()', () => {
    const spy = vi.spyOn(routingService, 'navigateToParts');
    component.goHome();
    expect(spy).toHaveBeenCalledWith(['']);
  });

  it('should navigate to find-an-instructor on goFindInstructor()', () => {
    const spy = vi.spyOn(routingService, 'navigateToParts');
    component.goFindInstructor();
    expect(spy).toHaveBeenCalledWith(['find-an-instructor']);
  });

  it('should navigate to events on goEvents()', () => {
    const spy = vi.spyOn(routingService, 'navigateToParts');
    component.goEvents();
    expect(spy).toHaveBeenCalledWith(['events']);
  });
});
