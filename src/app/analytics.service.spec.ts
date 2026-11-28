/*
Unit tests for AnalyticsService and its pure analytics/error-classification helpers.
*/
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { deleteApp, FirebaseApp, initializeApp } from 'firebase/app';
import {
  Analytics,
  initializeAnalytics,
  isSupported,
  logEvent,
  setDefaultEventParameters,
  setUserProperties,
} from 'firebase/analytics';
import {
  ApplicationLevel,
  InstructorLicenseType,
  MasterLevel,
  StudentLevel,
} from '../../functions/src/data-model/curriculum';
import {
  initMember,
  MembershipType,
} from '../../functions/src/data-model/members';
import { FIREBASE_APP } from './app.config';
import {
  AnalyticsService,
  buildMemberUserProperties,
  classifyClientError,
  ClientErrorCategory,
  ERROR_DEDUP_WINDOW_MS,
  formatViewTitle,
  hasActiveClassSubscription,
  MAX_ERROR_EVENTS_PER_SESSION,
  NavigationSource,
  resolveRegisteredCountry,
  sanitizeErrorMessage,
  sanitizePagePath,
  shouldEnableAnalytics,
} from './analytics.service';

vi.mock('firebase/analytics', () => ({
  initializeAnalytics: vi.fn(),
  isSupported: vi.fn().mockResolvedValue(false),
  logEvent: vi.fn(),
  setDefaultEventParameters: vi.fn(),
  setUserProperties: vi.fn(),
}));

describe('Analytics helpers', () => {
  describe('shouldEnableAnalytics', () => {
    it('returns true only in production builds with a real measurementId and no emulator', () => {
      expect(
        shouldEnableAnalytics(false, {
          useEmulator: false,
          firebase: { measurementId: 'G-QKCXJJGZKW' },
        }),
      ).toBe(true);

      expect(
        shouldEnableAnalytics(true, {
          useEmulator: false,
          firebase: { measurementId: 'G-QKCXJJGZKW' },
        }),
      ).toBe(false);

      expect(
        shouldEnableAnalytics(false, {
          useEmulator: true,
          firebase: { measurementId: 'G-QKCXJJGZKW' },
        }),
      ).toBe(false);

      expect(
        shouldEnableAnalytics(false, {
          useEmulator: false,
          firebase: { measurementId: '' },
        }),
      ).toBe(false);

      expect(
        shouldEnableAnalytics(false, {
          useEmulator: false,
          firebase: { measurementId: 'YOUR_MEASUREMENT_ID_FROM_FIREBASE' },
        }),
      ).toBe(false);
    });
  });

  describe('sanitizePagePath', () => {
    it('strips query strings and fragments and normalizes slashes', () => {
      expect(sanitizePagePath('/auth/complete?mode=signIn&oobCode=secret#top')).toBe(
        '/auth/complete',
      );
      expect(sanitizePagePath('events//ev123?session_id=cs_live_123')).toBe(
        '/events/ev123',
      );
      expect(sanitizePagePath('')).toBe('/');
    });

    it('redacts email-like path segments', () => {
      expect(sanitizePagePath('/members/alice@example.com/profile')).toBe(
        '/members/[email]/profile',
      );
    });
  });

  describe('formatViewTitle', () => {
    it('formats camelCase and snake_case view IDs into readable titles', () => {
      expect(formatViewTitle('eventsCalendar')).toBe('Events Calendar');
      expect(formatViewTitle('manageVodVideo')).toBe('Manage Vod Video');
      expect(formatViewTitle('not_found')).toBe('Not Found');
      expect(formatViewTitle('')).toBe('Portal');
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('scrubs emails, URL query strings, and long opaque tokens', () => {
      const raw =
        'Failed for user alice.smith@example.com at https://app.iliqchuan.com/auth/complete?oobCode=secret123 token abcdefghijklmnopqrstuvwxyz123456';
      expect(sanitizeErrorMessage(raw)).toBe(
        'Failed for user [email] at https://app.iliqchuan.com/auth/complete token [id]',
      );
    });
  });

  describe('classifyClientError', () => {
    it('filters benign browser noise', () => {
      const abortErr = new Error('User cancelled');
      abortErr.name = 'AbortError';
      expect(classifyClientError(abortErr)).toBeNull();

      expect(
        classifyClientError(
          new Error('ResizeObserver loop completed with undelivered notifications.'),
        ),
      ).toBeNull();
    });

    it('classifies chunk load failures', () => {
      const result = classifyClientError(
        new TypeError('Failed to fetch dynamically imported module: https://app.iliqchuan.com/chunk-ABC.js'),
      );
      expect(result?.category).toBe(ClientErrorCategory.ChunkLoad);
    });

    it('classifies Firebase Auth, Functions, Storage, and Firestore errors', () => {
      const authErr = Object.assign(new Error('Network failed'), {
        name: 'FirebaseError',
        code: 'auth/network-request-failed',
      });
      expect(classifyClientError(authErr)).toEqual(
        expect.objectContaining({
          category: ClientErrorCategory.FirebaseAuth,
          code: 'auth/network-request-failed',
        }),
      );

      const fnErr = Object.assign(new Error('Unavailable'), {
        name: 'FirebaseError',
        code: 'functions/unavailable',
      });
      expect(classifyClientError(fnErr)?.category).toBe(
        ClientErrorCategory.FirebaseFunctions,
      );

      const storageErr = Object.assign(new Error('Unauthorized'), {
        name: 'FirebaseError',
        code: 'storage/unauthorized',
      });
      expect(classifyClientError(storageErr)?.category).toBe(
        ClientErrorCategory.FirebaseStorage,
      );

      const firestoreErr = Object.assign(
        new Error('Missing or insufficient permissions'),
        {
          name: 'FirebaseError',
          code: 'permission-denied',
        },
      );
      expect(classifyClientError(firestoreErr)?.category).toBe(
        ClientErrorCategory.FirebaseFirestore,
      );
    });

    it('classifies Angular HttpErrorResponse and network TypeErrors', () => {
      const httpErr = {
        name: 'HttpErrorResponse',
        status: 503,
        message: 'Http failure response for https://example.com/api?token=abc: 503',
      };
      const classified = classifyClientError(httpErr);
      expect(classified).toEqual(
        expect.objectContaining({
          category: ClientErrorCategory.Network,
          code: 'http_503',
        }),
      );
      expect(classified?.description).not.toContain('token=abc');

      expect(classifyClientError(new TypeError('Failed to fetch'))?.category).toBe(
        ClientErrorCategory.Network,
      );
    });

    it('classifies storage quota and standard runtime errors', () => {
      const quotaErr = new Error('Storage limit');
      quotaErr.name = 'QuotaExceededError';
      expect(classifyClientError(quotaErr)?.category).toBe(
        ClientErrorCategory.Storage,
      );

      expect(
        classifyClientError(new TypeError("Cannot read properties of undefined"))?.category,
      ).toBe(ClientErrorCategory.Runtime);
    });

    it('unwraps Promise rejection wrappers and truncates description to 100 chars', () => {
      const inner = new RangeError('x'.repeat(200));
      const wrapped = { rejection: inner };
      const classified = classifyClientError(wrapped);
      expect(classified?.category).toBe(ClientErrorCategory.Runtime);
      expect(classified?.name).toBe('RangeError');
      expect(classified?.description.length).toBeLessThanOrEqual(100);
    });
  });
});

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let app: FirebaseApp;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSupported).mockResolvedValue(false);
    app = initializeApp(
      {
        apiKey: 'test-api-key',
        authDomain: 'test.firebaseapp.com',
        projectId: 'test-project',
        storageBucket: 'test.appspot.com',
        messagingSenderId: '123456',
        appId: '1:123456:web:abcdef',
        measurementId: 'G-QKCXJJGZKW',
      },
      `analytics-test-${Math.random()}`,
    );

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: FIREBASE_APP, useValue: app },
      ],
    });
    service = TestBed.inject(AnalyticsService);
  });

  afterEach(async () => {
    await deleteApp(app);
  });

  it('initializes Firebase Analytics with send_page_view disabled in production when supported', async () => {
    const fakeAnalytics = { app } as Analytics;
    vi.mocked(isSupported).mockResolvedValue(true);
    vi.mocked(initializeAnalytics).mockReturnValue(fakeAnalytics);

    await service.initAnalytics(false, {
      useEmulator: false,
      firebase: { measurementId: 'G-QKCXJJGZKW' },
    });

    expect(isSupported).toHaveBeenCalledTimes(1);
    expect(initializeAnalytics).toHaveBeenCalledWith(app, {
      config: { send_page_view: false },
    });
    expect(service.analytics).toBe(fakeAnalytics);
  });

  it('skips initializeAnalytics when browser does not support Analytics', async () => {
    vi.mocked(isSupported).mockResolvedValue(false);

    await service.initAnalytics(false, {
      useEmulator: false,
      firebase: { measurementId: 'G-QKCXJJGZKW' },
    });

    expect(initializeAnalytics).not.toHaveBeenCalled();
    expect(service.analytics).toBeUndefined();
  });

  it('handles isSupported rejection gracefully without throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(isSupported).mockRejectedValue(new Error('IndexedDB blocked'));

    await expect(
      service.initAnalytics(false, {
        useEmulator: false,
        firebase: { measurementId: 'G-QKCXJJGZKW' },
      }),
    ).resolves.toBeUndefined();

    expect(initializeAnalytics).not.toHaveBeenCalled();
    expect(service.analytics).toBeUndefined();
    warnSpy.mockRestore();
  });

  it('queues events emitted before initialization resolves and flushes them once ready', async () => {
    const fakeAnalytics = { app } as Analytics;
    let resolveSupported!: (value: boolean) => void;
    vi.mocked(isSupported).mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveSupported = resolve;
      }),
    );
    vi.mocked(initializeAnalytics).mockReturnValue(fakeAnalytics);

    // Reset initialized flag to simulate startup before initAnalytics finishes.
    (service as unknown as { initialized: boolean }).initialized = false;
    const initPromise = service.initAnalytics(false, {
      useEmulator: false,
      firebase: { measurementId: 'G-QKCXJJGZKW' },
    });

    service.logPageView({
      pagePath: '/events/ev1?q=secret',
      routePattern: '/events/:eventId',
      viewId: 'eventView',
      pageTitle: 'Event View',
      navigationSource: NavigationSource.Initial,
    });

    expect(logEvent).not.toHaveBeenCalled();

    resolveSupported(true);
    await initPromise;

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      fakeAnalytics,
      'page_view',
      expect.objectContaining({
        page_path: '/events/ev1',
        route_pattern: '/events/:eventId',
        view_id: 'eventView',
        page_title: 'Event View',
        navigation_source: NavigationSource.Initial,
      }),
    );
  });

  it('logs sanitized exception events, deduplicates within cooldown, and enforces session cap', async () => {
    const fakeAnalytics = { app } as Analytics;
    vi.mocked(isSupported).mockResolvedValue(true);
    vi.mocked(initializeAnalytics).mockReturnValue(fakeAnalytics);

    await service.initAnalytics(false, {
      useEmulator: false,
      firebase: { measurementId: 'G-QKCXJJGZKW' },
    });

    const err = new TypeError('Cannot read title for alice@example.com');
    const ctx = { routePattern: '/videos/:videoId', viewId: 'videoView' };

    expect(service.logClientError(err, ctx, 1_000)).toBe(true);
    // Duplicate within cooldown window is suppressed.
    expect(service.logClientError(err, ctx, 1_000 + ERROR_DEDUP_WINDOW_MS - 1)).toBe(false);
    // Allowed again once cooldown expires.
    expect(service.logClientError(err, ctx, 1_000 + ERROR_DEDUP_WINDOW_MS)).toBe(true);

    expect(logEvent).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenCalledWith(
      fakeAnalytics,
      'exception',
      expect.objectContaining({
        error_category: ClientErrorCategory.Runtime,
        error_name: 'TypeError',
        error_code: '',
        route_pattern: '/videos/:videoId',
        view_id: 'videoView',
        fatal: false,
      }),
    );
    const loggedParams = vi.mocked(logEvent).mock.calls[0][2] as Record<string, unknown>;
    expect(String(loggedParams['description'])).toContain('[email]');
    expect(String(loggedParams['description'])).not.toContain('alice@example.com');

    // Fill up to the per-session cap with distinct routes, then verify further errors are dropped.
    let logged = 2;
    for (let i = 0; i < MAX_ERROR_EVENTS_PER_SESSION; i++) {
      const accepted = service.logClientError(
        new Error(`Failure ${i}`),
        { routePattern: `/route-${i}`, viewId: `view${i}` },
        500_000 + i,
      );
      if (accepted) {
        logged += 1;
      }
    }
    expect(logged).toBe(MAX_ERROR_EVENTS_PER_SESSION);
    expect(logEvent).toHaveBeenCalledTimes(MAX_ERROR_EVENTS_PER_SESSION);
  });

  describe('member user properties', () => {
    it('evaluates hasActiveClassSubscription using flag and expiration date', () => {
      const base = initMember();
      expect(hasActiveClassSubscription(base, '2026-11-28')).toBe(false);

      expect(
        hasActiveClassSubscription(
          {
            classVideoLibrarySubscription: true,
            classVideoLibraryExpirationDate: '',
          },
          '2026-11-28',
        ),
      ).toBe(true);

      expect(
        hasActiveClassSubscription(
          {
            classVideoLibrarySubscription: true,
            classVideoLibraryExpirationDate: '2026-11-28',
          },
          '2026-11-28',
        ),
      ).toBe(true);

      expect(
        hasActiveClassSubscription(
          {
            classVideoLibrarySubscription: true,
            classVideoLibraryExpirationDate: '2026-11-27',
          },
          '2026-11-28',
        ),
      ).toBe(false);
    });

    it('resolves registered country from member.country, code, or memberId prefix within 36 chars', () => {
      expect(
        resolveRegisteredCountry({ country: 'france', memberId: '' }),
      ).toBe('France');
      expect(resolveRegisteredCountry({ country: 'US', memberId: '' })).toBe(
        'United States',
      );
      expect(resolveRegisteredCountry({ country: '', memberId: 'US402' })).toBe(
        'United States',
      );
      expect(resolveRegisteredCountry({ country: '', memberId: 'AUS12' })).toBe(
        'Australia',
      );
      expect(resolveRegisteredCountry({ country: '', memberId: '' })).toBe(
        'unknown',
      );
      expect(
        resolveRegisteredCountry({
          country: 'Congo, the Democratic Republic of the',
          memberId: '',
        }).length,
      ).toBeLessThanOrEqual(36);
    });

    it('maps an active instructor member and enforces GA4 key/value limits', () => {
      const member = {
        ...initMember(),
        memberId: 'FR104',
        country: 'France',
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2027-06-01',
        instructorId: '42',
        instructorLicenseType: InstructorLicenseType.Annual,
        instructorLicenseExpires: '2027-06-01',
        classVideoLibrarySubscription: true,
        classVideoLibraryExpirationDate: '2027-01-15',
        studentLevel: StudentLevel.Level7,
        applicationLevel: ApplicationLevel.Level3,
        mastersLevels: [MasterLevel.Good, MasterLevel.Wonder],
      };

      const props = buildMemberUserProperties(member, '2026-11-28');
      expect(props).toEqual({
        is_signed_in: 'true',
        has_instructor_id: 'true',
        has_active_membership: 'true',
        has_class_subscription: 'true',
        has_active_instructor: 'true',
        student_level: '7',
        instructor_level: '3',
        master_level: 'Wonder Hands',
        registered_country: 'France',
      });

      for (const [k, v] of Object.entries(props)) {
        expect(k.length).toBeLessThanOrEqual(24);
        if (v !== null) {
          expect(v.length).toBeLessThanOrEqual(36);
        }
      }
    });

    it('marks has_active_instructor false when instructor license is valid but membership is expired', () => {
      const member = {
        ...initMember(),
        memberId: 'US402',
        country: '',
        membershipType: MembershipType.Annual,
        currentMembershipExpires: '2025-01-01',
        instructorId: '88',
        instructorLicenseType: InstructorLicenseType.Life,
        instructorLicenseExpires: 'life',
        studentLevel: StudentLevel.Entry,
        applicationLevel: ApplicationLevel.None,
        mastersLevels: [],
      };

      const props = buildMemberUserProperties(member, '2026-11-28');
      expect(props).toEqual({
        is_signed_in: 'true',
        has_instructor_id: 'true',
        has_active_membership: 'false',
        has_class_subscription: 'false',
        has_active_instructor: 'false',
        student_level: 'Entry',
        instructor_level: 'none',
        master_level: 'none',
        registered_country: 'United States',
      });
    });

    it('clears member attributes when signed out', () => {
      expect(buildMemberUserProperties(null, '2026-11-28')).toEqual({
        is_signed_in: 'false',
        has_instructor_id: null,
        has_active_membership: null,
        has_class_subscription: null,
        has_active_instructor: null,
        student_level: null,
        instructor_level: null,
        master_level: null,
        registered_country: null,
      });
    });

    it('flushes queued user properties before queued page_view events and deduplicates unchanged updates', async () => {
      const fakeAnalytics = { app } as Analytics;
      let resolveSupported!: (value: boolean) => void;
      vi.mocked(isSupported).mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveSupported = resolve;
        }),
      );
      vi.mocked(initializeAnalytics).mockReturnValue(fakeAnalytics);

      const callOrder: string[] = [];
      vi.mocked(setUserProperties).mockImplementation(() => {
        callOrder.push('setUserProperties');
      });
      vi.mocked(logEvent).mockImplementation(() => {
        callOrder.push('logEvent');
      });

      (service as unknown as { initialized: boolean }).initialized = false;
      const initPromise = service.initAnalytics(false, {
        useEmulator: false,
        firebase: { measurementId: 'G-QKCXJJGZKW' },
      });

      const member = {
        ...initMember(),
        country: 'Poland',
        membershipType: MembershipType.Life,
        studentLevel: StudentLevel.Level4,
      };

      service.logPageView({
        pagePath: '/videos',
        routePattern: '/videos',
        viewId: 'videos',
        pageTitle: 'Videos',
        navigationSource: NavigationSource.Initial,
      });
      service.setMemberUserProperties(member, '2026-11-28');

      resolveSupported(true);
      await initPromise;

      expect(callOrder).toEqual(['setUserProperties', 'logEvent']);
      expect(setUserProperties).toHaveBeenCalledTimes(1);

      // Identical snapshot is deduplicated.
      service.setMemberUserProperties({ ...member }, '2026-11-28');
      expect(setUserProperties).toHaveBeenCalledTimes(1);

      // Updating an attribute dispatches a new setUserProperties call.
      service.setMemberUserProperties(
        { ...member, classVideoLibrarySubscription: true },
        '2026-11-28',
      );
      expect(setUserProperties).toHaveBeenCalledTimes(2);
      expect(setUserProperties).toHaveBeenLastCalledWith(
        fakeAnalytics,
        expect.objectContaining({
          has_class_subscription: 'true',
          has_active_membership: 'true',
          student_level: '4',
          registered_country: 'Poland',
        }),
      );

      // Signing out clears member properties.
      service.setMemberUserProperties(null, '2026-11-28');
      expect(setUserProperties).toHaveBeenCalledTimes(3);
      expect(setUserProperties).toHaveBeenLastCalledWith(
        fakeAnalytics,
        expect.objectContaining({
          is_signed_in: 'false',
          has_active_membership: null,
          registered_country: null,
        }),
      );
    });
  });

  describe('app version tracking', () => {
    it('queues app version before init, flushes as user property and default event param before page_view, and deduplicates', async () => {
      const fakeAnalytics = { app } as Analytics;
      let resolveSupported!: (value: boolean) => void;
      vi.mocked(isSupported).mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveSupported = resolve;
        }),
      );
      vi.mocked(initializeAnalytics).mockReturnValue(fakeAnalytics);

      const callOrder: string[] = [];
      vi.mocked(setUserProperties).mockImplementation(() => {
        callOrder.push('setUserProperties');
      });
      vi.mocked(setDefaultEventParameters).mockImplementation(() => {
        callOrder.push('setDefaultEventParameters');
      });
      vi.mocked(logEvent).mockImplementation(() => {
        callOrder.push('logEvent');
      });

      (service as unknown as { initialized: boolean }).initialized = false;
      const initPromise = service.initAnalytics(false, {
        useEmulator: false,
        firebase: { measurementId: 'G-QKCXJJGZKW' },
      });

      service.logPageView({
        pagePath: '/',
        routePattern: '/',
        viewId: 'home',
        pageTitle: 'Home',
        navigationSource: NavigationSource.Initial,
      });
      service.setAppVersion('  0.0.1+2026-11-28T11:52  ');

      expect(setUserProperties).not.toHaveBeenCalled();
      expect(setDefaultEventParameters).not.toHaveBeenCalled();

      resolveSupported(true);
      await initPromise;

      expect(callOrder).toEqual([
        'setUserProperties',
        'setDefaultEventParameters',
        'logEvent',
      ]);
      expect(setUserProperties).toHaveBeenCalledWith(fakeAnalytics, {
        web_app_version: '0.0.1+2026-11-28T11:52',
      });
      expect(setDefaultEventParameters).toHaveBeenCalledWith({
        web_app_version: '0.0.1+2026-11-28T11:52',
      });

      // Duplicate and empty values are ignored.
      service.setAppVersion('0.0.1+2026-11-28T11:52');
      service.setAppVersion('   ');
      expect(setUserProperties).toHaveBeenCalledTimes(1);
      expect(setDefaultEventParameters).toHaveBeenCalledTimes(1);

      // Values longer than 36 chars are truncated to fit GA4 user property limits.
      const longVersion = '1.2.3+2026-11-28T11:52:00-extra-build-metadata';
      service.setAppVersion(longVersion);
      expect(setUserProperties).toHaveBeenLastCalledWith(fakeAnalytics, {
        web_app_version: longVersion.slice(0, 36),
      });
      expect(setDefaultEventParameters).toHaveBeenLastCalledWith({
        web_app_version: longVersion.slice(0, 36),
      });
    });
  });
});
