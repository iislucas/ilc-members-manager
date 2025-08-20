import { TestBed } from '@angular/core/testing';
import { RoutingService } from './routing.service';
import { ROUTING_CONFIG, RoutingConfig } from './routing.config';
import { Views } from './app.config';
import { provideZonelessChangeDetection } from '@angular/core';

describe('RoutingService', () => {
  let service: RoutingService;

  const testConfig: RoutingConfig = {
    pathParams: { view: Views.Members },
    urlParams: { memberId: '' },
    paths: ['/:view'],
  };

  function configureTestBed(config: RoutingConfig) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RoutingService,
        {
          provide: ROUTING_CONFIG,
          useValue: config,
        },
      ],
    });
    service = TestBed.inject(RoutingService);
  }

  beforeEach(() => {
    // Reset window hash before each test
    window.location.hash = '';
  });

  it('should be created', () => {
    configureTestBed(testConfig);
    expect(service).toBeTruthy();
  });

  it('should update the URL when a path param signal changes', (done) => {
    configureTestBed(testConfig);

    service.pathParamSignals['view'].set(Views.ImportExport);
    setTimeout(() => {
      expect(window.location.hash).toBe(`#/${Views.ImportExport}`);
      done();
    });
  });

  it('should update the URL when a url param signal changes', (done) => {
    configureTestBed(testConfig);

    service.urlParamSignals['memberId'].set('123');
    setTimeout(() => {
      expect(window.location.hash).toBe(`#/${Views.Members}?memberId=123`);
      done();
    });
  });

  it('should update signals from the URL', (done) => {
    configureTestBed(testConfig);

    window.location.hash = `/${Views.ImportExport}?memberId=456`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    setTimeout(() => {
      expect(service.pathParamSignals['view']()).toBe(Views.ImportExport);
      expect(service.urlParamSignals['memberId']()).toBe('456');
      done();
    });
  });
});
