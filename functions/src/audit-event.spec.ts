import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Put ALL state that mock factories touch into vi.hoisted().
 * Vitest hoists vi.mock() to the top of the file; vi.hoisted() runs before those.
 */
const __audit = vi.hoisted(() => {
  type SetCall = { docId: string; data: any; options: any };

  return {
    // trigger capture
    capturedHandler: null as ((event: any) => Promise<any>) | null,

    // write capture
    setCalls: [] as SetCall[],

    // admin/app mocks
    initializeAppMock: vi.fn(),
    getAppsMock: vi.fn<() => any[]>(() => []),

    // firestore mocks (created inside mock factory but we keep refs here for assertions)
    mocks: {
      Timestamp: null as any,
      getFirestore: null as any,
    },
  };
});

/**
 * Mock firebase-functions v2 wrapper so we can:
 * 1) capture the handler your module registers
 * 2) call it directly in tests (offline)
 */
vi.mock('firebase-functions/v2/firestore', () => {
  return {
    onDocumentWrittenWithAuthContext: vi.fn((_path: string, handler: any) => {
      __audit.capturedHandler = handler;
      return handler;
    }),
  };
});

/**
 * Mock firebase-admin/app: ensureAdminInitialized() behavior
 */
vi.mock('firebase-admin/app', () => {
  return {
    initializeApp: (...args: any[]) => __audit.initializeAppMock(...args),
    getApps: () => __audit.getAppsMock(),
  };
});

/**
 * Mock firebase-admin/firestore: Timestamp + getFirestore()
 * We'll capture writes to auditEvents.
 */
vi.mock('firebase-admin/firestore', () => {
  // Define these inside the factory (safe), then store references into __audit for assertions.
  const Timestamp = {
    now: vi.fn(() => ({ __ts: 'now' })),
    fromDate: vi.fn((d: Date) => ({ __ts: 'fromDate', date: d.toISOString() })),
  };

  const getFirestore = vi.fn(() => ({
    collection: vi.fn((_name: string) => ({
      doc: vi.fn((docId: string) => ({
        set: vi.fn(async (data: any, options: any) => {
          __audit.setCalls.push({ docId, data, options });
        }),
      })),
    })),
  }));

  __audit.mocks.Timestamp = Timestamp;
  __audit.mocks.getFirestore = getFirestore;

  return { Timestamp, getFirestore };
});

/**
 * Import AFTER mocks so module wiring uses our mocks.
 */
import {
  onDocumentWriteWithAuth,
  __setAuditConfigProvider,
  FilterMode,
  __resetAuditConfigProvider,
} from './audit-event';
import {
  AuditEventType,
  AuthContextType,
  DocumentModificationType,
} from '../../shared/src/audit-event-model';

/** ---------- Minimal Firestore snapshot mocks ---------- */

type PlainObject = Record<string, any>;

function snap(exists: boolean, data: PlainObject | undefined) {
  return {
    exists,
    data: () => data,
  };
}

function change(before: any, after: any) {
  return { before, after };
}

/**
 * Build an event shaped like FirestoreAuthEvent<Change<DocumentSnapshot>|undefined>
 * with the fields your code reads.
 */
function makeEvent(params: {
  id?: string;
  time?: string | null;
  authType?: string;
  authId?: string | null;
  document?: string;
  project?: string;
  database?: string;
  namespace?: string;
  location?: string;
  memberId?: string | null;
  before?: { exists: boolean; data?: PlainObject };
  after?: { exists: boolean; data?: PlainObject };
  dataUndefined?: boolean;
}) {
  const id = params.id ?? 'evt-1';
  const document = params.document ?? 'members/abc';
  const memberId = params.memberId ?? 'abc';

  const beforeSnap = params.before
    ? snap(params.before.exists, params.before.data)
    : snap(false, undefined);

  const afterSnap = params.after
    ? snap(params.after.exists, params.after.data)
    : snap(false, undefined);

  return {
    id,
    time: params.time === undefined ? '2026-03-05T12:34:56.000Z' : params.time,
    authType: (params.authType ?? 'api_key') as any,
    authId: params.authId ?? 'user-1',
    document,
    project: params.project ?? 'proj-1',
    database: params.database ?? '(default)',
    namespace: params.namespace ?? '(default)',
    location: params.location ?? 'us-central1',
    params: { memberId },
    data: params.dataUndefined ? undefined : change(beforeSnap, afterSnap),
  };
}

/** ---------- Helpers for assertions ---------- */

function expectOneAuditWrite() {
  expect(__audit.setCalls.length).toBe(1);
  expect(__audit.setCalls[0].options).toEqual({ merge: false });
  return __audit.setCalls[0].data;
}

function expectNoAuditWrite() {
  expect(__audit.setCalls.length).toBe(0);
}

/** ---------- Tests ---------- */

describe('firestore audit - offline unit tests', () => {
  beforeEach(() => {
    __audit.setCalls.length = 0;
    __resetAuditConfigProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {});

  it('registers the trigger handler via onDocumentWrittenWithAuthContext', async () => {
    expect(onDocumentWriteWithAuth).toBeTypeOf('function');
    expect(__audit.capturedHandler).not.toBeNull();
  });

  it('skips when event.data is undefined', async () => {
    const evt = makeEvent({ dataUndefined: true });
    await (__audit.capturedHandler as any)(evt);
    expectNoAuditWrite();
  });

  it('logs and skips when memberId param is missing/empty', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const evt = makeEvent({
      memberId: '' as any,
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(evt);

    expect(errSpy).toHaveBeenCalledTimes(1);
    expectNoAuditWrite();
  });

  it('CREATE: emits CREATE modifications for every leaf, with dotted paths', async () => {
    const evt = makeEvent({
      id: 'evt-create-1',
      before: { exists: false },
      after: {
        exists: true,
        data: {
          name: 'Ada',
          profile: { age: 33, flags: { vip: true } },
        },
      },
    });

    await (__audit.capturedHandler as any)(evt);

    const audit = expectOneAuditWrite();
    expect(audit.type).toBe(AuditEventType.DocumentModification);
    expect(audit.modificationType).toBe(DocumentModificationType.CREATE);
    expect(audit.documentId).toBe('abc');
    expect(audit.documentPath).toBe('members/abc');

    // occurredAt uses Timestamp.fromDate(event.time)
    expect(__audit.mocks.Timestamp.fromDate).toHaveBeenCalledTimes(1);

    const mods = audit.modifications;
    const byPath = new Map(mods.map((m: any) => [m.fieldPath, m]));

    expect(byPath.get('name')).toMatchObject({
      type: DocumentModificationType.CREATE,
      before: null,
      after: 'Ada',
    });

    expect(byPath.get('profile.age')).toMatchObject({
      type: DocumentModificationType.CREATE,
      before: null,
      after: '33',
    });

    expect(byPath.get('profile.flags.vip')).toMatchObject({
      type: DocumentModificationType.CREATE,
      before: null,
      after: 'true',
    });
  });

  it('DELETE: emits DELETE modifications for every leaf, with dotted paths', async () => {
    const evt = makeEvent({
      id: 'evt-del-1',
      before: {
        exists: true,
        data: { name: 'Ada', profile: { age: 33 } },
      },
      after: { exists: false },
    });

    await (__audit.capturedHandler as any)(evt);

    const audit = expectOneAuditWrite();
    expect(audit.modificationType).toBe(DocumentModificationType.DELETE);

    const byPath = new Map(
      audit.modifications.map((m: any) => [m.fieldPath, m]),
    );

    expect(byPath.get('name')).toMatchObject({
      type: DocumentModificationType.DELETE,
      before: 'Ada',
      after: null,
    });

    expect(byPath.get('profile.age')).toMatchObject({
      type: DocumentModificationType.DELETE,
      before: '33',
      after: null,
    });
  });

  it('UPDATE: emits UPDATE for changed leaves and CREATE/DELETE for new/removed nested fields', async () => {
    const evt = makeEvent({
      id: 'evt-upd-1',
      before: {
        exists: true,
        data: {
          name: 'Ada',
          profile: { age: 33, city: 'NYC' },
        },
      },
      after: {
        exists: true,
        data: {
          name: 'Ada Lovelace',
          profile: { age: 34 },
          status: 'active',
        },
      },
    });

    await (__audit.capturedHandler as any)(evt);

    const audit = expectOneAuditWrite();
    expect(audit.modificationType).toBe(DocumentModificationType.UPDATE);

    const byPath = new Map(
      audit.modifications.map((m: any) => [m.fieldPath, m]),
    );

    expect(byPath.get('name')).toMatchObject({
      type: DocumentModificationType.UPDATE,
      before: 'Ada',
      after: 'Ada Lovelace',
    });

    expect(byPath.get('profile.age')).toMatchObject({
      type: DocumentModificationType.UPDATE,
      before: '33',
      after: '34',
    });

    expect(byPath.get('profile.city')).toMatchObject({
      type: DocumentModificationType.DELETE,
      before: 'NYC',
      after: null,
    });

    expect(byPath.get('status')).toMatchObject({
      type: DocumentModificationType.CREATE,
      before: null,
      after: 'active',
    });
  });

  it('UPDATE: arrays are atomic (default arraysAreAtomic=true)', async () => {
    const evt = makeEvent({
      id: 'evt-arr-1',
      before: { exists: true, data: { tags: ['a', 'b'] } },
      after: { exists: true, data: { tags: ['a', 'b', 'c'] } },
    });

    await (__audit.capturedHandler as any)(evt);

    const audit = expectOneAuditWrite();
    const mods = audit.modifications;

    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({
      fieldPath: 'tags',
      type: DocumentModificationType.UPDATE,
      before: JSON.stringify(['a', 'b']),
      after: JSON.stringify(['a', 'b', 'c']),
    });
  });

  it('UPDATE: does not write an audit doc when no diffs exist', async () => {
    const evt = makeEvent({
      id: 'evt-nodiff-1',
      before: { exists: true, data: { a: 1, b: { c: 'x' } } },
      after: { exists: true, data: { a: 1, b: { c: 'x' } } },
    });

    await (__audit.capturedHandler as any)(evt);

    expectNoAuditWrite();
  });

  it('stringification: undefined is recorded as the string "undefined" (even though Firestore can’t store it)', async () => {
    const evt = makeEvent({
      id: 'evt-undef-1',
      before: { exists: true, data: { a: 1 } },
      after: { exists: true, data: { a: 1, b: undefined } },
    });

    await (__audit.capturedHandler as any)(evt);

    const audit = expectOneAuditWrite();
    const byPath = new Map(
      audit.modifications.map((m: any) => [m.fieldPath, m]),
    );

    expect(byPath.get('b')).toMatchObject({
      type: DocumentModificationType.CREATE,
      before: null,
      after: 'undefined',
    });
  });

  it('stringification: circular objects fall back to String(value) (no crash)', async () => {
    const circ: any = { a: 1 };
    circ.self = circ;

    const evt = makeEvent({
      id: 'evt-circ-1',
      before: { exists: true, data: { a: 1 } },
      after: { exists: true, data: { a: 1, circ } },
    });

    await (__audit.capturedHandler as any)(evt);

    const audit = expectOneAuditWrite();
    const mod = audit.modifications.find((m: any) => m.fieldPath === 'circ');
    expect(mod).toBeTruthy();
    expect(mod.type).toBe(DocumentModificationType.CREATE);
    expect(typeof mod.after).toBe('string');
  });

  it('non-plain objects are treated as atomic leaves (e.g., Timestamp/GeoPoint-like)', async () => {
    class FirestoreLikeThing {
      constructor(public x: number) {}
    }

    const beforeThing = new FirestoreLikeThing(1);
    const afterThing = new FirestoreLikeThing(2);

    const evt = makeEvent({
      id: 'evt-nonplain-1',
      before: { exists: true, data: { t: beforeThing } },
      after: { exists: true, data: { t: afterThing } },
    });

    await (__audit.capturedHandler as any)(evt);

    const audit = expectOneAuditWrite();
    const mod = audit.modifications.find((m: any) => m.fieldPath === 't');

    expect(mod).toBeTruthy();
    expect(mod.type).toBe(DocumentModificationType.UPDATE);
    expect(typeof mod.before).toBe('string');
    expect(typeof mod.after).toBe('string');
    expect(mod.before).not.toBe(mod.after);
  });

  it('auth context mapping: api_key -> USER', async () => {
    const evt = makeEvent({
      id: 'evt-auth-1',
      authType: 'api_key',
      authId: 'user-xyz',
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(evt);

    const audit = expectOneAuditWrite();
    expect(audit.authContext).toEqual({
      authType: AuthContextType.User,
      authId: 'user-xyz',
    });
  });

  it('auth context mapping: service_account -> SERVICE_ACCOUNT', async () => {
    const evt = makeEvent({
      id: 'evt-auth-2',
      authType: 'service_account',
      authId: 'svc-abc',
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(evt);

    const audit = expectOneAuditWrite();
    expect(audit.authContext).toEqual({
      authType: AuthContextType.ServiceAccount,
      authId: 'svc-abc',
    });
  });

  it('occurredAt: uses Timestamp.now() when event.time is missing', async () => {
    const evt = makeEvent({
      id: 'evt-time-1',
      time: null,
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(evt);

    const audit = expectOneAuditWrite();
    expect(__audit.mocks.Timestamp.now).toHaveBeenCalledTimes(1);
    expect(audit.occurredAt).toEqual({ __ts: 'now' });
  });

  it('initializes admin SDK only when getApps().length === 0', async () => {
    __audit.getAppsMock.mockReturnValueOnce([]);

    const evt1 = makeEvent({
      id: 'evt-init-1',
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });
    await (__audit.capturedHandler as any)(evt1);
    expect(__audit.initializeAppMock).toHaveBeenCalledTimes(1);

    __audit.getAppsMock.mockReturnValueOnce([{}]);

    const evt2 = makeEvent({
      id: 'evt-init-2',
      before: { exists: false },
      after: { exists: true, data: { b: 2 } },
    });
    await (__audit.capturedHandler as any)(evt2);
    expect(__audit.initializeAppMock).toHaveBeenCalledTimes(1);
  });

  it('writes audit doc to auditEvents/{eventId}', async () => {
    const evt = makeEvent({
      id: 'evt-write-1',
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(evt);

    expect(__audit.setCalls.length).toBe(1);
    expect(__audit.setCalls[0].docId).toBe('evt-write-1');
    expect(__audit.setCalls[0].data.eventId).toBe('evt-write-1');
  });

  it('ignores writes to auditEvents collection (no recursion)', async () => {
    const evt = makeEvent({
      id: 'evt-ignore-auditEvents-1',
      document: 'auditEvents/evt-ignore-auditEvents-1',
      // params doesn't matter; should short-circuit before memberId validation
      memberId: '' as any,
      before: { exists: true, data: { a: 1 } },
      after: { exists: true, data: { a: 2 } },
    });

    await (__audit.capturedHandler as any)(evt);

    expectNoAuditWrite();
  });

  it('ignores writes to auditEvents when document is a full Firestore resource path', async () => {
    const evt = makeEvent({
      id: 'evt-ignore-auditEvents-2',
      document:
        'projects/proj-1/databases/(default)/documents/auditEvents/evt-ignore-auditEvents-2',
      memberId: '' as any,
      before: { exists: true, data: { a: 1 } },
      after: { exists: true, data: { a: 2 } },
    });

    await (__audit.capturedHandler as any)(evt);

    expectNoAuditWrite();
  });

  it('collection filter: whitelist allows only collections in CollectionFilterList', async () => {
    __setAuditConfigProvider(() => ({
      collectionFilterList: ['members'],
      collectionFilterMode: FilterMode.Whitelist,
    }));

    // Allowed: members/*
    const allowedEvt = makeEvent({
      id: 'evt-filter-allow-1',
      document: 'members/abc',
      memberId: 'abc',
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(allowedEvt);
    expect(__audit.setCalls.length).toBe(1);

    // Not allowed: other/*
    __audit.setCalls.length = 0;

    const blockedEvt = makeEvent({
      id: 'evt-filter-block-1',
      document: 'other/xyz',
      memberId: 'abc', // should be ignored due to filter
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(blockedEvt);
    expectNoAuditWrite();
  });

  it('collection filter: blacklist blocks collections in CollectionFilterList', async () => {
    __setAuditConfigProvider(() => ({
      collectionFilterList: ['members'],
      collectionFilterMode: FilterMode.Blacklist,
    }));

    // Blocked: members/*
    const blockedEvt = makeEvent({
      id: 'evt-filter-blacklist-1',
      document: 'members/abc',
      memberId: 'abc',
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(blockedEvt);
    expectNoAuditWrite();

    // Allowed: other/*
    const allowedEvt = makeEvent({
      id: 'evt-filter-blacklist-2',
      document: 'other/xyz',
      memberId: 'abc',
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(allowedEvt);
    expect(__audit.setCalls.length).toBe(1);
  });

  it('collection filter: whitelist with empty list allows nothing', async () => {
    __setAuditConfigProvider(() => ({
      collectionFilterList: [],
      collectionFilterMode: FilterMode.Whitelist,
    }));

    const evt = makeEvent({
      id: 'evt-filter-empty-whitelist-1',
      document: 'members/abc',
      memberId: 'abc',
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(evt);

    expectNoAuditWrite();
  });

  it('collection filter: blacklist with empty list allows everything (except auditEvents)', async () => {
    __setAuditConfigProvider(() => ({
      collectionFilterList: [],
      collectionFilterMode: FilterMode.Blacklist,
    }));

    const evt = makeEvent({
      id: 'evt-filter-empty-blacklist-1',
      document: 'members/abc',
      memberId: 'abc',
      before: { exists: false },
      after: { exists: true, data: { a: 1 } },
    });

    await (__audit.capturedHandler as any)(evt);

    expect(__audit.setCalls.length).toBe(1);
  });
});
