import { TestBed } from '@angular/core/testing';
import { RoutingService, RoutingConfig } from './routing.service';
import {
  Views,
  ROUTING_CONFIG,
  initPathPatterns,
  AppPathPatterns,
} from './app.config';
import { provideZonelessChangeDetection, Component, inject } from '@angular/core';
import { ComponentFixture } from '@angular/core/testing';

@Component({
  template: '',
  standalone: true,
})
class TestRouterComponent {
  routingService = inject(RoutingService);
}

describe('RoutingService', () => {
  let service: RoutingService<AppPathPatterns>;
  let fixture: ComponentFixture<TestRouterComponent>;

  const testConfig: RoutingConfig<AppPathPatterns> = {
    validPathPatterns: initPathPatterns,
  };

  async function configureTestBed(config: RoutingConfig<AppPathPatterns>) {
    await TestBed.configureTestingModule({
      imports: [TestRouterComponent],
      providers: [
        provideZonelessChangeDetection(),
        RoutingService,
        {
          provide: ROUTING_CONFIG,
          useValue: config,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestRouterComponent);
    service = fixture.componentInstance.routingService;
    await fixture.whenStable();
  }

  beforeEach(() => {
    // Reset window hash before each test
    window.location.hash = '';
  });

  it('should be created', async () => {
    await configureTestBed(testConfig);
    expect(service).toBeTruthy();
  });

  it('should update the URL when a path param signal changes', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.SchoolMembers);
    service.signals[Views.SchoolMembers].pathVars['schoolId'].set('S1');
    await fixture.whenStable();
    expect(window.location.hash).toBe(`#school/S1/members?memberId=`);
  });

  it('should update the URL when a url param signal changes', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['memberId'].set('456');
    await fixture.whenStable();
    expect(window.location.hash).toBe(`#members?memberId=456`);
  });

  it('should update signals from the URL', async () => {
    await configureTestBed(testConfig);

    window.location.hash = `#members?memberId=789`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.signals[Views.ManageMembers].urlParams['memberId']()).toBe(
      '789',
    );
  });
});
