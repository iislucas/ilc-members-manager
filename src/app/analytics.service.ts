/*
AnalyticsService: Centralized Firebase Analytics (GA4) lifecycle, event logging,
and member user-property reporting.

Initializes Firebase Analytics in production builds (`!isDevMode()` and
`!environment.useEmulator`) with `send_page_view: false` so that every page view
(initial load and client-side SPA navigations) flows through a single sanitized
path via `RoutingService`, preventing sensitive query parameters (`oobCode`,
`session_id`, search queries) from being sent to Google Analytics.

Also provides:
- Structured, low-cardinality client-side error logging via standard GA4
  `exception` events with PII scrubbing, benign-noise filtering, per-fingerprint
  deduplication, and a per-session cap.
- Non-PII GA4 user properties describing the signed-in member's status
  (instructor ID presence, active membership, class video library subscription,
  active instructor status, student/instructor/master levels, and registered
  country).
*/
import { inject, Injectable, isDevMode } from '@angular/core';
import {
  Analytics,
  initializeAnalytics,
  isSupported,
  logEvent,
  setUserProperties,
} from 'firebase/analytics';
import {
  highestMasterLevel,
  toApplicationLevel,
  toStudentLevel,
} from '../../functions/src/data-model/curriculum';
import {
  hasActiveMembership,
  isActiveInstructor,
  Member,
} from '../../functions/src/data-model/members';
import { environment } from '../environments/environment';
import { FIREBASE_APP } from './app.config';
import { countryCodeList } from './country-codes';

export enum NavigationSource {
  Initial = 'initial',
  Navigate = 'navigate',
  Back = 'back',
  PopState = 'popstate',
  Replace = 'replace',
  TabChange = 'tab_change',
}

export enum ClientErrorCategory {
  ChunkLoad = 'chunk_load',
  FirebaseAuth = 'firebase_auth',
  FirebaseFirestore = 'firebase_firestore',
  FirebaseFunctions = 'firebase_functions',
  FirebaseStorage = 'firebase_storage',
  Firebase = 'firebase',
  Network = 'network',
  Storage = 'storage',
  Runtime = 'runtime',
  Unknown = 'unknown',
}

export interface PageViewPayload {
  pagePath: string;
  routePattern: string;
  viewId: string;
  pageTitle: string;
  navigationSource: NavigationSource;
  tab?: string;
}

export interface ClientErrorContext {
  routePattern: string;
  viewId: string;
  fatal?: boolean;
}

export interface ClassifiedClientError {
  category: ClientErrorCategory;
  name: string;
  code: string;
  description: string;
}

interface PageViewEventParams {
  page_path: string;
  page_location: string;
  page_title: string;
  view_id: string;
  route_pattern: string;
  navigation_source: NavigationSource;
  tab?: string;
}

interface ExceptionEventParams {
  description: string;
  fatal: boolean;
  error_category: ClientErrorCategory;
  error_name: string;
  error_code: string;
  route_pattern: string;
  view_id: string;
}

type PendingAnalyticsEvent =
  | { name: 'page_view'; params: PageViewEventParams }
  | { name: 'exception'; params: ExceptionEventParams };

export const MAX_PENDING_EVENTS = 20;
export const MAX_ERROR_EVENTS_PER_SESSION = 20;
export const ERROR_DEDUP_WINDOW_MS = 60_000;
const MAX_DESCRIPTION_LENGTH = 100;
const MAX_PARAM_LENGTH = 40;

const FIRESTORE_ERROR_CODES: ReadonlySet<string> = new Set([
  'aborted',
  'already-exists',
  'cancelled',
  'data-loss',
  'deadline-exceeded',
  'failed-precondition',
  'internal',
  'invalid-argument',
  'not-found',
  'out-of-range',
  'permission-denied',
  'resource-exhausted',
  'unauthenticated',
  'unavailable',
  'unimplemented',
]);

const RUNTIME_ERROR_NAMES: ReadonlySet<string> = new Set([
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
]);

// Returns true when Firebase Analytics should be initialized (production Angular
// build, not connected to emulators, and configured with a real Measurement ID).
// Note: `environment.local.ts` backs both `development` and `production` build
// targets in `angular.json` with `production: false`, so we check Angular's
// `!isDevMode()` rather than `environment.production`.
export function shouldEnableAnalytics(
  devMode: boolean,
  env: { useEmulator: boolean; firebase: { measurementId?: string } },
): boolean {
  const measurementId = env.firebase.measurementId?.trim() ?? '';
  return (
    !devMode &&
    !env.useEmulator &&
    measurementId.length > 0 &&
    !measurementId.startsWith('YOUR_')
  );
}

// Strips query strings and fragments, normalizes slashes, and redacts any
// path segment that looks like an email address.
export function sanitizePagePath(rawPath: string): string {
  const withoutQueryOrHash = rawPath.split(/[?#]/, 1)[0] ?? '';
  const withLeadingSlash = withoutQueryOrHash.startsWith('/')
    ? withoutQueryOrHash
    : `/${withoutQueryOrHash}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, '/');
  const scrubbedSegments = collapsed
    .split('/')
    .map((segment) => (segment.includes('@') ? '[email]' : segment));
  return scrubbedSegments.join('/') || '/';
}

// Converts a route/view identifier (e.g. `eventsCalendar` or `not_found`) into
// a concise, non-PII page title for GA4 reports.
export function formatViewTitle(viewId: string): string {
  const spaced = viewId
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) {
    return 'Portal';
  }
  return spaced.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

// Scrubs emails, URL query strings, and long opaque tokens from an error message.
export function sanitizeErrorMessage(raw: string): string {
  return raw
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[id]')
    .replace(/\s+/g, ' ')
    .trim();
}

// Unwraps Angular Zone/Promise wrapper errors to surface the underlying cause.
function unwrapError(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== 'object' || current === null) {
      return current;
    }
    const obj = current as { rejection?: unknown; ngOriginalError?: unknown };
    if (obj.rejection !== undefined) {
      current = obj.rejection;
    } else if (obj.ngOriginalError !== undefined) {
      current = obj.ngOriginalError;
    } else {
      break;
    }
  }
  return current;
}

function isChunkLoadError(name: string, message: string): boolean {
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Unable to preload CSS/i.test(message)
  );
}

function isNoiseError(name: string, message: string): boolean {
  if (name === 'AbortError') {
    return true;
  }
  if (/ResizeObserver loop/i.test(message)) {
    return true;
  }
  return false;
}

// Classifies an arbitrary client-side error into low-cardinality GA4 fields and
// a sanitized 100-char description. Returns null for benign browser noise.
export function classifyClientError(error: unknown): ClassifiedClientError | null {
  const unwrapped = unwrapError(error);

  let rawName = 'UnknownError';
  let rawMessage = '';
  let rawCode = '';
  let httpStatus: number | null = null;

  if (unwrapped instanceof Error) {
    rawName = unwrapped.name || 'Error';
    rawMessage = unwrapped.message || '';
    const errWithCode = unwrapped as Error & { code?: unknown; status?: unknown };
    if (typeof errWithCode.code === 'string') {
      rawCode = errWithCode.code.trim();
    }
    if (typeof errWithCode.status === 'number') {
      httpStatus = errWithCode.status;
    }
  } else if (typeof unwrapped === 'object' && unwrapped !== null) {
    const obj = unwrapped as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      status?: unknown;
    };
    if (typeof obj.name === 'string' && obj.name.trim()) {
      rawName = obj.name.trim();
    }
    if (typeof obj.message === 'string') {
      rawMessage = obj.message;
    }
    if (typeof obj.code === 'string') {
      rawCode = obj.code.trim();
    }
    if (typeof obj.status === 'number') {
      httpStatus = obj.status;
    }
  } else if (typeof unwrapped === 'string') {
    rawName = 'StringError';
    rawMessage = unwrapped;
  }

  if (isNoiseError(rawName, rawMessage)) {
    return null;
  }

  const name = rawName.slice(0, MAX_PARAM_LENGTH);
  let code = rawCode.slice(0, MAX_PARAM_LENGTH);
  let category: ClientErrorCategory;

  if (isChunkLoadError(name, rawMessage)) {
    category = ClientErrorCategory.ChunkLoad;
  } else if (code.startsWith('auth/')) {
    category = ClientErrorCategory.FirebaseAuth;
  } else if (code.startsWith('functions/')) {
    category = ClientErrorCategory.FirebaseFunctions;
  } else if (code.startsWith('storage/')) {
    category = ClientErrorCategory.FirebaseStorage;
  } else if (
    name === 'FirebaseError' &&
    (FIRESTORE_ERROR_CODES.has(code) || /firestore/i.test(rawMessage))
  ) {
    category = ClientErrorCategory.FirebaseFirestore;
  } else if (name === 'FirebaseError') {
    category = ClientErrorCategory.Firebase;
  } else if (name === 'HttpErrorResponse' && httpStatus !== null) {
    category = ClientErrorCategory.Network;
    code = `http_${httpStatus}`;
  } else if (
    name === 'QuotaExceededError' ||
    /IndexedDB|IDBDatabase|quota/i.test(rawMessage)
  ) {
    category = ClientErrorCategory.Storage;
  } else if (
    /Failed to fetch|NetworkError|Load failed|ERR_NETWORK/i.test(rawMessage)
  ) {
    category = ClientErrorCategory.Network;
  } else if (RUNTIME_ERROR_NAMES.has(name)) {
    category = ClientErrorCategory.Runtime;
  } else {
    category = ClientErrorCategory.Unknown;
  }

  const sanitizedMsg = sanitizeErrorMessage(rawMessage);
  const prefix = code ? `${category}:${name}:${code}` : `${category}:${name}`;
  const fullDescription = sanitizedMsg ? `${prefix} - ${sanitizedMsg}` : prefix;
  const description = fullDescription.slice(0, MAX_DESCRIPTION_LENGTH);

  return {
    category,
    name,
    code,
    description,
  };
}

const MAX_USER_PROPERTY_VALUE_LENGTH = 36;

const COUNTRY_NAME_BY_CODE: ReadonlyMap<string, string> = new Map(
  countryCodeList.map((entry) => [entry.id.toUpperCase(), entry.name]),
);

const COUNTRY_NAME_BY_LOWER: ReadonlyMap<string, string> = new Map(
  countryCodeList.map((entry) => [entry.name.toLowerCase(), entry.name]),
);

export interface MemberAnalyticsUserProperties {
  is_signed_in: 'true' | 'false';
  has_instructor_id: 'true' | 'false' | null;
  has_active_membership: 'true' | 'false' | null;
  has_class_subscription: 'true' | 'false' | null;
  has_active_instructor: 'true' | 'false' | null;
  student_level: string | null;
  instructor_level: string | null;
  master_level: string | null;
  registered_country: string | null;
  [key: string]: string | null;
}

// Whether the member currently has an active Class Video Library subscription.
// Matches the portal's access rule: enabled flag plus either no expiration date
// (never expires) or an expiration date on or after `today` (YYYY-MM-DD).
export function hasActiveClassSubscription(
  member: Pick<
    Member,
    'classVideoLibrarySubscription' | 'classVideoLibraryExpirationDate'
  >,
  today: string = new Date().toISOString().split('T')[0],
): boolean {
  if (!member.classVideoLibrarySubscription) {
    return false;
  }
  const expires = member.classVideoLibraryExpirationDate?.trim() ?? '';
  return !expires || expires >= today;
}

// Resolves a member's registered country to a clean, GA4-safe string (max 36 chars).
// Prefers `member.country` normalized against `countryCodeList`, and falls back to
// the leading country code prefix of `member.memberId` (e.g. `US402` -> `United States`).
export function resolveRegisteredCountry(
  member: Pick<Member, 'country' | 'memberId'>,
): string {
  const rawCountry = member.country?.trim() ?? '';
  if (rawCountry) {
    const byCode = COUNTRY_NAME_BY_CODE.get(rawCountry.toUpperCase());
    if (byCode) {
      return byCode.slice(0, MAX_USER_PROPERTY_VALUE_LENGTH);
    }
    const byName = COUNTRY_NAME_BY_LOWER.get(rawCountry.toLowerCase());
    if (byName) {
      return byName.slice(0, MAX_USER_PROPERTY_VALUE_LENGTH);
    }
    return rawCountry.slice(0, MAX_USER_PROPERTY_VALUE_LENGTH);
  }

  const rawMemberId = member.memberId?.trim() ?? '';
  const codeMatch = /^([A-Za-z]{2,3})(?=\d)/.exec(rawMemberId);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    const resolved = COUNTRY_NAME_BY_CODE.get(code) ?? code;
    return resolved.slice(0, MAX_USER_PROPERTY_VALUE_LENGTH);
  }

  return 'unknown';
}

// Maps the active signed-in `Member` (or `null` when signed out) into non-PII
// GA4 user properties within GA4's 24-char key and 36-char value limits.
export function buildMemberUserProperties(
  member: Member | null,
  today: string = new Date().toISOString().split('T')[0],
): MemberAnalyticsUserProperties {
  if (!member) {
    return {
      is_signed_in: 'false',
      has_instructor_id: null,
      has_active_membership: null,
      has_class_subscription: null,
      has_active_instructor: null,
      student_level: null,
      instructor_level: null,
      master_level: null,
      registered_country: null,
    };
  }

  const studentLevel = toStudentLevel(member.studentLevel);
  const instructorLevel = toApplicationLevel(member.applicationLevel);
  const masterLevel = highestMasterLevel(member.mastersLevels);

  return {
    is_signed_in: 'true',
    has_instructor_id: member.instructorId.trim() ? 'true' : 'false',
    has_active_membership: hasActiveMembership(member, today) ? 'true' : 'false',
    has_class_subscription: hasActiveClassSubscription(member, today)
      ? 'true'
      : 'false',
    has_active_instructor: isActiveInstructor(member, today) ? 'true' : 'false',
    student_level: studentLevel || 'none',
    instructor_level: instructorLevel || 'none',
    master_level: masterLevel || 'none',
    registered_country: resolveRegisteredCountry(member),
  };
}

@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  private app = inject(FIREBASE_APP, { optional: true });
  public analytics?: Analytics;

  private initialized = false;
  private pendingEvents: PendingAnalyticsEvent[] = [];
  private pendingUserProperties: MemberAnalyticsUserProperties | null = null;
  private lastUserPropertiesKey: string | null = null;
  private recentErrorTimestamps = new Map<string, number>();
  private errorEventsLogged = 0;

  constructor() {
    void this.initAnalytics(isDevMode(), environment);
  }

  // Initializes Firebase Analytics if enabled for this build and supported by the browser.
  // Disables automatic gtag `page_view` so `RoutingService` emits every page view with
  // sanitized paths and consistent route metadata.
  public async initAnalytics(
    devMode: boolean,
    env: { useEmulator: boolean; firebase: { measurementId?: string } },
  ): Promise<void> {
    if (!this.app || !shouldEnableAnalytics(devMode, env)) {
      this.initialized = true;
      this.pendingEvents = [];
      this.pendingUserProperties = null;
      return;
    }
    try {
      if (await isSupported()) {
        this.analytics = initializeAnalytics(this.app, {
          config: { send_page_view: false },
        });
      }
    } catch (e) {
      console.warn('AnalyticsService: Failed to initialize Analytics', e);
    } finally {
      this.initialized = true;
      this.flushPendingEvents();
    }
  }

  // Sets (or clears when signed out) non-PII GA4 user properties derived from
  // the active member profile. Deduplicates unchanged snapshots and queues
  // updates emitted before Analytics finishes async initialization.
  public setMemberUserProperties(
    member: Member | null,
    today: string = new Date().toISOString().split('T')[0],
  ): void {
    const props = buildMemberUserProperties(member, today);
    const key = JSON.stringify(props);
    if (key === this.lastUserPropertiesKey) {
      return;
    }
    this.lastUserPropertiesKey = key;

    if (!this.initialized) {
      this.pendingUserProperties = props;
      return;
    }
    if (!this.analytics) {
      return;
    }
    this.dispatchUserProperties(this.analytics, props);
  }

  // Logs a sanitized GA4 `page_view` event for initial load or in-app navigation.
  public logPageView(payload: PageViewPayload): void {
    const sanitizedPath = sanitizePagePath(payload.pagePath);
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : '';
    const params: PageViewEventParams = {
      page_path: sanitizedPath,
      page_location: origin ? `${origin}${sanitizedPath}` : sanitizedPath,
      page_title: payload.pageTitle.slice(0, MAX_DESCRIPTION_LENGTH),
      view_id: payload.viewId.slice(0, MAX_PARAM_LENGTH),
      route_pattern: payload.routePattern.slice(0, MAX_DESCRIPTION_LENGTH),
      navigation_source: payload.navigationSource,
    };
    if (payload.tab) {
      params.tab = payload.tab.slice(0, MAX_PARAM_LENGTH);
    }
    this.enqueueOrLog({ name: 'page_view', params });
  }

  // Classifies and logs a client-side error as a GA4 `exception` event with
  // per-fingerprint deduplication and a per-session cap. Returns true if the
  // event was accepted (logged or queued), or false if suppressed.
  public logClientError(
    error: unknown,
    context: ClientErrorContext,
    nowMs = Date.now(),
  ): boolean {
    const classified = classifyClientError(error);
    if (!classified) {
      return false;
    }
    if (this.errorEventsLogged >= MAX_ERROR_EVENTS_PER_SESSION) {
      return false;
    }

    const fingerprint = `${classified.category}|${classified.name}|${classified.code}|${context.routePattern}`;
    const lastLoggedAt = this.recentErrorTimestamps.get(fingerprint);
    if (
      lastLoggedAt !== undefined &&
      nowMs - lastLoggedAt < ERROR_DEDUP_WINDOW_MS
    ) {
      return false;
    }

    this.recentErrorTimestamps.set(fingerprint, nowMs);
    this.errorEventsLogged += 1;

    const params: ExceptionEventParams = {
      description: classified.description,
      fatal: context.fatal ?? false,
      error_category: classified.category,
      error_name: classified.name,
      error_code: classified.code,
      route_pattern: context.routePattern.slice(0, MAX_DESCRIPTION_LENGTH),
      view_id: context.viewId.slice(0, MAX_PARAM_LENGTH),
    };
    this.enqueueOrLog({ name: 'exception', params });
    return true;
  }

  private enqueueOrLog(event: PendingAnalyticsEvent): void {
    if (!this.initialized) {
      if (this.pendingEvents.length < MAX_PENDING_EVENTS) {
        this.pendingEvents.push(event);
      }
      return;
    }
    if (!this.analytics) {
      return;
    }
    this.dispatchEvent(this.analytics, event);
  }

  private flushPendingEvents(): void {
    const userProps = this.pendingUserProperties;
    this.pendingUserProperties = null;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    if (!this.analytics) {
      return;
    }
    // Apply pending user properties before queued events so initial page_view
    // events carry the member attributes when already known at startup.
    if (userProps) {
      this.dispatchUserProperties(this.analytics, userProps);
    }
    for (const event of events) {
      this.dispatchEvent(this.analytics, event);
    }
  }

  private dispatchUserProperties(
    analytics: Analytics,
    properties: MemberAnalyticsUserProperties,
  ): void {
    try {
      setUserProperties(analytics, properties);
    } catch (e) {
      console.warn('AnalyticsService: Failed to set user properties', e);
    }
  }

  private dispatchEvent(
    analytics: Analytics,
    event: PendingAnalyticsEvent,
  ): void {
    try {
      if (event.name === 'page_view') {
        logEvent(analytics, 'page_view', event.params);
      } else {
        logEvent(analytics, 'exception', event.params);
      }
    } catch (e) {
      console.warn(`AnalyticsService: Failed to log ${event.name} event`, e);
    }
  }
}
