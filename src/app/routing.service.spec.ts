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
    window.location.hash = '#/';
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
    expect(window.location.hash).toBe(`#/school/S1/members`);
  });

  it('should update the URL when a url param signal changes', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['jumpTo'].set('456');
    await fixture.whenStable();
    expect(window.location.hash).toBe(`#/members?jumpTo=456`);
  });

  it('should update signals from the URL', async () => {
    await configureTestBed(testConfig);

    window.location.hash = `#members?jumpTo=789&q=`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.signals[Views.ManageMembers].urlParams['jumpTo']()).toBe(
      '789',
    );
    expect(service.signals[Views.ManageMembers].urlParams['q']()).toBe(
      '',
    );
  });

  it('should omit empty URL params from the URL', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    // All URL params are at default values
    await fixture.whenStable();
    expect(window.location.hash).toBe('#/members');
  });

  it('should update path var signals from the URL', async () => {
    await configureTestBed(testConfig);

    window.location.hash = '#/school/S42/members';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.matchedPatternId()).toBe(Views.SchoolMembers);
    expect(service.signals[Views.SchoolMembers].pathVars['schoolId']()).toBe('S42');
  });

  it('should set matchedPatternId to null for unmatched URLs', async () => {
    await configureTestBed(testConfig);

    window.location.hash = '#/this/path/does/not/exist';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.matchedPatternId()).toBeNull();
  });

  it('should navigate via navigateTo', async () => {
    await configureTestBed(testConfig);

    service.navigateTo('members?q=test');
    // In jsdom, setting window.location.hash doesn't auto-fire hashchange
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(window.location.hash).toBe('#/members?q=test');
    expect(service.matchedPatternId()).toBe(Views.ManageMembers);
    expect(service.signals[Views.ManageMembers].urlParams['q']()).toBe('test');
  });

  it('should navigate via navigateToParts', async () => {
    await configureTestBed(testConfig);

    service.navigateToParts(['school', 'S7', 'members']);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(window.location.hash).toBe('#/school/S7/members');
    expect(service.matchedPatternId()).toBe(Views.SchoolMembers);
    expect(service.signals[Views.SchoolMembers].pathVars['schoolId']()).toBe('S7');
  });

  it('should remove a param from the URL when its signal is cleared', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('hello');
    await fixture.whenStable();
    expect(window.location.hash).toBe('#/members?q=hello');

    service.signals[Views.ManageMembers].urlParams['q'].set('');
    // The signal should immediately reflect the cleared value
    expect(service.signals[Views.ManageMembers].urlParams['q']()).toBe('');
  });

  it('should handle multiple URL params at once', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('search');
    service.signals[Views.ManageMembers].urlParams['jumpTo'].set('M42');
    service.signals[Views.ManageMembers].urlParams['sortBy'].set('name');
    // 'asc' differs from the default 'desc', so it will appear in the URL
    service.signals[Views.ManageMembers].urlParams['sortDir'].set('asc');
    await fixture.whenStable();
    const hash = window.location.hash;
    // All non-default params should be present
    expect(hash).toContain('q=search');
    expect(hash).toContain('jumpTo=M42');
    expect(hash).toContain('sortBy=name');
    expect(hash).toContain('sortDir=asc');
  });

  it('should encode special characters in path vars', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMemberView);
    service.signals[Views.ManageMemberView].pathVars['memberId'].set('Row 1561');
    await fixture.whenStable();
    expect(window.location.hash).toBe('#/members/Row%201561');
  });

  it('should decode special characters in path vars from URL', async () => {
    await configureTestBed(testConfig);

    window.location.hash = '#/members/Row%201561';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.matchedPatternId()).toBe(Views.ManageMemberView);
    expect(service.signals[Views.ManageMemberView].pathVars['memberId']()).toBe('Row 1561');
  });

  it('should reset URL param signals to default when absent from URL', async () => {
    await configureTestBed(testConfig);

    // First set a value
    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('hello');
    await fixture.whenStable();

    // Navigate to same route without the param
    window.location.hash = '#/members';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.signals[Views.ManageMembers].urlParams['q']()).toBe('');
    // sortBy resets to its configured default, not empty string
    expect(service.signals[Views.ManageMembers].urlParams['sortBy']()).toBe('lastUpdated');
  });

  // ── resolveUrlWithParams ──

  it('resolveUrlWithParams should carry forward non-empty signal values', async () => {
    await configureTestBed(testConfig);

    // Simulate being on ManageMembers with some params set
    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('search');
    service.signals[Views.ManageMembers].urlParams['tag'].set('expired');
    service.signals[Views.ManageMembers].urlParams['sortBy'].set('name');
    await fixture.whenStable();

    // Navigate away to a member detail
    window.location.hash = '#/members/M1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();
    expect(service.matchedPatternId()).toBe(Views.ManageMemberView);

    // Signals for ManageMembers should still hold their values
    expect(service.signals[Views.ManageMembers].urlParams['q']()).toBe('search');
    expect(service.signals[Views.ManageMembers].urlParams['tag']()).toBe('expired');

    // resolveUrlWithParams should carry those forward
    const resolved = service.resolveUrlWithParams('/members?jumpTo=M1');
    expect(resolved).toContain('jumpTo=M1');
    expect(resolved).toContain('q=search');
    expect(resolved).toContain('tag=expired');
    expect(resolved).toContain('sortBy=name');
  });

  it('resolveUrlWithParams should not overwrite explicit params', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('old-search');
    await fixture.whenStable();

    // Navigate away
    window.location.hash = '#/members/M1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();

    // Explicit q=new-search should NOT be overwritten by the old signal value
    const resolved = service.resolveUrlWithParams('/members?q=new-search');
    expect(resolved).toContain('q=new-search');
    expect(resolved).not.toContain('q=old-search');
  });

  it('resolveUrlWithParams should skip default signal values', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('search');
    // sortBy left at default ('lastUpdated'), should not appear in URL
    await fixture.whenStable();

    window.location.hash = '#/members/M1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();

    const resolved = service.resolveUrlWithParams('/members');
    expect(resolved).toContain('q=search');
    expect(resolved).not.toContain('sortBy');
    expect(resolved).not.toContain('sortDir');
  });

  it('resolveUrlWithParams should return input unchanged for unmatched paths', async () => {
    await configureTestBed(testConfig);

    const input = '/unknown/path?foo=bar';
    expect(service.resolveUrlWithParams(input)).toBe(input);
  });

  // ── hrefWithParams ──

  it('hrefWithParams should return an href with # prefix and preserved params', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('test');
    await fixture.whenStable();

    window.location.hash = '#/members/M1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();

    const href = service.hrefWithParams('/members');
    expect(href).toMatch(/^#\//);
    expect(href).toContain('q=test');
  });

  // ── navigateTo with clearUrlParams ──

  it('navigateTo should preserve params by default', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('kept');
    service.signals[Views.ManageMembers].urlParams['tag'].set('active');
    await fixture.whenStable();

    // Navigate away
    window.location.hash = '#/members/M1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();

    // Navigate back without clearUrlParams (default = false)
    service.navigateTo('/members?jumpTo=M1');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();

    expect(window.location.hash).toContain('jumpTo=M1');
    expect(window.location.hash).toContain('q=kept');
    expect(window.location.hash).toContain('tag=active');
  });

  it('navigateTo with clearUrlParams should not preserve params', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['q'].set('should-be-gone');
    await fixture.whenStable();

    // Navigate away
    window.location.hash = '#/members/M1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();

    // Navigate back WITH clearUrlParams = true
    service.navigateTo('/members?jumpTo=M1', { clearUrlParams: true });
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();

    expect(window.location.hash).toContain('jumpTo=M1');
    expect(window.location.hash).not.toContain('q=should-be-gone');
  });

  it('navigateToParts should preserve params by default', async () => {
    await configureTestBed(testConfig);

    service.matchedPatternId.set(Views.ManageMembers);
    service.signals[Views.ManageMembers].urlParams['sortBy'].set('name');
    await fixture.whenStable();

    // Navigate away
    window.location.hash = '#/members/M1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();

    // Navigate back
    service.navigateToParts(['/members']);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await fixture.whenStable();

    expect(window.location.hash).toContain('sortBy=name');
  });

  // ── hrefForView ──

  it('hrefForView should return href for view without path vars', async () => {
    await configureTestBed(testConfig);
    
    const href = service.hrefForView(Views.ManageMembers);
    expect(href).toBe('#/members');
  });

  it('hrefForView should return href for view with path vars', async () => {
    await configureTestBed(testConfig);
    
    const href = service.hrefForView(Views.SchoolMembers, { schoolId: 'S123' });
    expect(href).toBe('#/school/S123/members');
  });

  it('hrefForView should encode path variables', async () => {
    await configureTestBed(testConfig);
    
    const href = service.hrefForView(Views.ManageMemberView, { memberId: 'John Doe' });
    expect(href).toBe('#/members/John%20Doe');
  });

  it('hrefForView should throw if required path variable is missing', async () => {
    await configureTestBed(testConfig);
    
    expect(() => {
      // Cast to any to bypass TypeScript safety checks for testing the runtime error
      (service as any).hrefForView(Views.SchoolMembers);
    }).toThrowError(/Missing path variable schoolId/);
  });
});
