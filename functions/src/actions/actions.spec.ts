/* actions.spec.ts
 *
 * Comprehensive unit tests for the database actions library covering
 * member, school, grading, event, vod, and order domain operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as admin from 'firebase-admin';
import {
  createActionContext,
  ActionContext,
  MembershipType,
  EventStatus,
  GradingStatus,
  PaymentStatus,
  VodAccessTier,
  VideoGrantKind,
  OrderKind,
  OrderStatus,
  SquareSpaceOrder,
  SquareSpaceLineItemType,
  createMember,
  getMember,
  getMemberByMemberId,
  getMemberByEmail,
  updateMember,
  renewMembership,
  setMemberStatus,
  scheduleMemberAccountDeletion,
  cancelMemberAccountDeletion,
  createSchool,
  getSchool,
  getSchoolBySchoolId,
  updateSchool,
  addSchoolManager,
  removeSchoolManager,
  deleteSchool,
  createGrading,
  getGrading,
  acceptGrading,
  declineGrading,
  recordGradingResult,
  linkGradingToEvent,
  unlinkGradingFromEvent,
  createEvent,
  getEvent,
  setEventStatus,
  addEventManager,
  removeEventManager,
  deleteEvent,
  createVideo,
  getVideo,
  setVideoPublished,
  createOrUpdateVideoSeries,
  grantVideoAccess,
  revokeVideoAccess,
  listMemberVideoGrants,
  deleteVideo,
  getOrder,
  getOrderByNumber,
  updateOrderNotes,
  linkOrderToMember,
  linkOrderToSchool,
  reprocessOrder,
} from './index';

// ============================================================================
// In-Memory Firestore Mock
// ============================================================================

class InMemoryFirestore {
  private data = new Map<string, Record<string, unknown>>();

  private getDocKey(col: string, id: string): string {
    return `${col}/${id}`;
  }

  runTransaction<T>(updateFunction: (transaction: {
    get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
  }) => Promise<T>): Promise<T> {
    const tx = {
      get: async (ref: { path: string }) => {
        const stored = this.data.get(ref.path);
        return {
          exists: Boolean(stored),
          data: () => stored,
        };
      },
      set: (ref: { path: string }, docData: Record<string, unknown>, options?: { merge?: boolean }) => {
        if (options?.merge) {
          const prev = this.data.get(ref.path) || {};
          this.data.set(ref.path, { ...prev, ...docData });
        } else {
          this.data.set(ref.path, { ...docData });
        }
      },
    };
    return updateFunction(tx);
  }

  doc(path: string) {
    const self = this;
    return {
      path,
      id: path.split('/').pop() || '',
      get: async () => {
        const stored = self.data.get(path);
        return {
          exists: Boolean(stored),
          id: path.split('/').pop() || '',
          data: () => stored,
        };
      },
      set: async (val: Record<string, unknown>, options?: { merge?: boolean }) => {
        if (options?.merge) {
          const prev = self.data.get(path) || {};
          self.data.set(path, { ...prev, ...val });
        } else {
          self.data.set(path, { ...val });
        }
      },
      update: async (val: Record<string, unknown>) => {
        const prev = self.data.get(path) || {};
        self.data.set(path, { ...prev, ...val });
      },
      delete: async () => {
        self.data.delete(path);
      },
    };
  }

  batch() {
    const ops: Array<() => void> = [];
    const self = this;

    return {
      set: (docRef: { path: string }, val: Record<string, unknown>, options?: { merge?: boolean }) => {
        ops.push(() => {
          if (options?.merge) {
            const prev = self.data.get(docRef.path) || {};
            self.data.set(docRef.path, { ...prev, ...val });
          } else {
            self.data.set(docRef.path, { ...val });
          }
        });
      },
      update: (docRef: { path: string }, val: Record<string, unknown>) => {
        ops.push(() => {
          const prev = self.data.get(docRef.path) || {};
          self.data.set(docRef.path, { ...prev, ...val });
        });
      },
      delete: (docRef: { path: string }) => {
        ops.push(() => {
          self.data.delete(docRef.path);
        });
      },
      commit: async () => {
        for (const op of ops) op();
      },
    };
  }

  collection(colName: string) {
    const self = this;

    return {
      path: colName,
      doc: (docId?: string) => {
        const id = docId || `auto_${Math.random().toString(36).substring(2, 9)}`;
        const path = `${colName}/${id}`;

        return {
          id,
          path,
          get: async () => {
            const stored = self.data.get(path);
            return {
              exists: Boolean(stored),
              id,
              data: () => stored,
            };
          },
          set: async (val: Record<string, unknown>, options?: { merge?: boolean }) => {
            if (options?.merge) {
              const prev = self.data.get(path) || {};
              self.data.set(path, { ...prev, ...val });
            } else {
              self.data.set(path, { ...val });
            }
          },
          update: async (val: Record<string, unknown>) => {
            const prev = self.data.get(path) || {};
            self.data.set(path, { ...prev, ...val });
          },
          delete: async () => {
            self.data.delete(path);
          },
          collection: (subColName: string) => {
            return self.collection(`${path}/${subColName}`);
          },
        };
      },
      where: (field: string, op: string, val: unknown) => {
        return self.createFilterQuery(colName, [{ field, op, val }]);
      },
      limit: (max: number) => {
        return self.createFilterQuery(colName, []).limit(max);
      },
      get: async () => {
        return self.createFilterQuery(colName, []).get();
      },
    };
  }

  private createFilterQuery(colPath: string, filters: Array<{ field: string; op: string; val: unknown }>) {
    const self = this;
    let limitCount: number | null = null;

    const queryObj = {
      where: (field: string, op: string, val: unknown) => {
        filters.push({ field, op, val });
        return queryObj;
      },
      limit: (n: number) => {
        limitCount = n;
        return queryObj;
      },
      get: async () => {
        const docs: Array<{ id: string; ref: any; data: () => Record<string, unknown> }> = [];

        for (const [key, value] of self.data.entries()) {
          const segments = key.split('/');
          const docColPath = segments.slice(0, -1).join('/');
          const id = segments[segments.length - 1];

          if (docColPath !== colPath) continue;

          let matches = true;
          for (const f of filters) {
            const docVal = value[f.field];
            if (f.op === '==' && docVal !== f.val) {
              matches = false;
              break;
            }
            if (f.op === 'array-contains') {
              if (!Array.isArray(docVal) || !docVal.includes(f.val)) {
                matches = false;
                break;
              }
            }
            if (f.op === '>=' && (docVal as string) < (f.val as string)) {
              matches = false;
              break;
            }
          }

          if (matches) {
            docs.push({
              id,
              ref: self.doc(key),
              data: () => value,
            });
          }

          if (limitCount && docs.length >= limitCount) break;
        }

        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
        };
      },
    };

    return queryObj;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Database Actions Library', () => {
  let inMemoryDb: InMemoryFirestore;
  let ctx: ActionContext;

  beforeEach(() => {
    inMemoryDb = new InMemoryFirestore();
    // Initialize system/counters doc
    inMemoryDb.doc('system/counters').set({
      memberIdCounters: { US: 100, FR: 200 },
      instructorIdCounter: 100,
      schoolIdCounter: 100,
    });

    ctx = createActionContext({
      db: inMemoryDb as unknown as admin.firestore.Firestore,
      actor: {
        memberDocId: 'actor_doc_1',
        name: 'Admin Actor',
        email: 'admin@example.com',
        isAdmin: true,
      },
      dryRun: false,
    });
  });

  describe('Members Actions', () => {
    it('creates a new member with atomic memberId counter and schema defaults', async () => {
      const res = await createMember(ctx, {
        name: 'Jean Dupont',
        email: 'jean@example.fr',
        countryCode: 'FR',
        city: 'Paris',
      });

      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();
      expect(res.data?.name).toBe('Jean Dupont');
      expect(res.data?.memberId).toBe('FR201');
      expect(res.data?.emails).toEqual(['jean@example.fr']);
      expect(res.data?.membershipType).toBe(MembershipType.Annual);

      const retrieved = await getMember(ctx, res.data!.docId);
      expect(retrieved?.name).toBe('Jean Dupont');
      expect(retrieved?.memberId).toBe('FR201');
    });

    it('enforces dryRun without committing member writes', async () => {
      const dryCtx = { ...ctx, dryRun: true };
      const res = await createMember(dryCtx, {
        name: 'Dry Member',
        email: 'dry@example.com',
        countryCode: 'US',
      });

      expect(res.success).toBe(true);
      expect(res.dryRun).toBe(true);
      expect(res.data?.memberId).toContain('DRYRUN');

      const retrieved = await getMember(ctx, res.data!.docId);
      expect(retrieved).toBeNull();
    });

    it('rejects creating a member with a duplicate email', async () => {
      await createMember(ctx, {
        name: 'Existing Member',
        email: 'duplicate@example.com',
        countryCode: 'US',
      });

      const res = await createMember(ctx, {
        name: 'Another Person',
        email: 'duplicate@example.com',
        countryCode: 'US',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('already exists');
    });

    it('looks up members by email and memberId', async () => {
      const created = await createMember(ctx, {
        name: 'Alice Wonder',
        email: 'alice@example.com',
        countryCode: 'US',
      });

      const byEmail = await getMemberByEmail(ctx, 'alice@example.com');
      expect(byEmail?.docId).toBe(created.data?.docId);

      const byId = await getMemberByMemberId(ctx, created.data!.memberId);
      expect(byId?.name).toBe('Alice Wonder');
    });

    it('updates member fields and keeps emails in sync', async () => {
      const created = await createMember(ctx, {
        name: 'Bob Smith',
        email: 'bob@example.com',
        countryCode: 'US',
      });

      const updateRes = await updateMember(ctx, created.data!.docId, {
        city: 'New York',
        email: 'bob.new@example.com',
      });

      expect(updateRes.success).toBe(true);
      expect(updateRes.data?.city).toBe('New York');
      expect(updateRes.data?.emails).toContain('bob.new@example.com');
      expect(updateRes.data?.emails).toContain('bob@example.com');
    });

    it('renews membership and preserves firstMembershipStarted', async () => {
      const created = await createMember(ctx, {
        name: 'Clara Oswald',
        email: 'clara@example.com',
        countryCode: 'UK',
        firstMembershipStarted: '2024-01-01',
      });

      const res = await renewMembership(ctx, created.data!.docId, {
        expirationDate: '2027-12-31',
      });

      expect(res.success).toBe(true);
      expect(res.data?.firstMembershipStarted).toBe('2024-01-01');
      expect(res.data?.currentMembershipExpires).toBe('2027-12-31');
      expect(res.data?.membershipType).toBe(MembershipType.Annual);
    });

    it('schedules and cancels member account deletion', async () => {
      const created = await createMember(ctx, {
        name: 'Deleting Member',
        email: 'delete.me@example.com',
        countryCode: 'US',
      });

      const schedRes = await scheduleMemberAccountDeletion(ctx, created.data!.docId, 30);
      expect(schedRes.success).toBe(true);
      expect(schedRes.data?.deletionDate).toBeDefined();

      const cancelRes = await cancelMemberAccountDeletion(ctx, created.data!.docId);
      expect(cancelRes.success).toBe(true);
    });
  });

  describe('Schools Actions', () => {
    it('creates a school with auto-allocated schoolId counter', async () => {
      const res = await createSchool(ctx, {
        schoolName: 'ILC Paris School',
        schoolCountry: 'France',
        schoolCity: 'Paris',
      });

      expect(res.success).toBe(true);
      expect(res.data?.schoolId).toBe('SCH-101');
      expect(res.data?.schoolName).toBe('ILC Paris School');

      const retrieved = await getSchool(ctx, res.data!.docId);
      expect(retrieved?.schoolId).toBe('SCH-101');

      const bySchoolId = await getSchoolBySchoolId(ctx, 'SCH-101');
      expect(bySchoolId?.schoolName).toBe('ILC Paris School');
    });

    it('updates school and propagates schoolId rename to members', async () => {
      const school = await createSchool(ctx, {
        schoolName: 'Old School',
        schoolCountry: 'US',
        schoolId: 'SCH-OLD',
      });

      const member = await createMember(ctx, {
        name: 'School Student',
        email: 'student@example.com',
        countryCode: 'US',
        primarySchoolId: 'SCH-OLD',
      });

      const updateRes = await updateSchool(ctx, school.data!.docId, {
        schoolId: 'SCH-NEW',
        schoolName: 'New Renamed School',
      });

      expect(updateRes.success).toBe(true);
      expect(updateRes.data?.schoolId).toBe('SCH-NEW');

      const updatedMember = await getMember(ctx, member.data!.docId);
      expect(updatedMember?.primarySchoolId).toBe('SCH-NEW');
    });

    it('adds and removes school managers', async () => {
      const school = await createSchool(ctx, {
        schoolName: 'Manager Test School',
        schoolCountry: 'US',
      });

      await addSchoolManager(ctx, school.data!.docId, 'INST-50');
      let current = await getSchool(ctx, school.data!.docId);
      expect(current?.managerInstructorIds).toContain('INST-50');

      await removeSchoolManager(ctx, school.data!.docId, 'INST-50');
      current = await getSchool(ctx, school.data!.docId);
      expect(current?.managerInstructorIds).not.toContain('INST-50');
    });

    it('deletes a school', async () => {
      const school = await createSchool(ctx, {
        schoolName: 'To Be Deleted',
        schoolCountry: 'US',
      });

      const delRes = await deleteSchool(ctx, school.data!.docId);
      expect(delRes.success).toBe(true);

      const check = await getSchool(ctx, school.data!.docId);
      expect(check).toBeNull();
    });
  });

  describe('Gradings Actions', () => {
    let studentDocId: string;

    beforeEach(async () => {
      const s = await createMember(ctx, {
        name: 'Grading Student',
        email: 'grading.student@example.com',
        countryCode: 'US',
        studentLevel: 'Level 1' as any,
      });
      studentDocId = s.data!.docId;
    });

    it('creates a grading linked to a student', async () => {
      const res = await createGrading(ctx, {
        studentMemberDocId: studentDocId,
        level: 'Level 2',
        gradingInstructorId: 'INST-10',
      });

      expect(res.success).toBe(true);
      expect(res.data?.studentMemberDocId).toBe(studentDocId);
      expect(res.data?.studentName).toBe('Grading Student');
      expect(res.data?.level).toBe('Level 2');
      expect(res.data?.status).toBe(GradingStatus.AwaitingAcceptance);
    });

    it('accepts a grading request and records actor audit', async () => {
      const grading = await createGrading(ctx, {
        studentMemberDocId: studentDocId,
        level: 'Level 2',
        gradingInstructorId: 'INST-10',
      });

      const acceptRes = await acceptGrading(ctx, grading.data!.docId, {
        memberDocId: 'inst_doc_10',
        name: 'Sifu Sam',
      });

      expect(acceptRes.success).toBe(true);
      expect(acceptRes.data?.status).toBe(GradingStatus.AwaitingGrading);
      expect(acceptRes.data?.acceptedByName).toBe('Sifu Sam');
      expect(acceptRes.data?.studentLevelAtAcceptance).toBe('Level 1');
    });

    it('declines a grading request with notes', async () => {
      const grading = await createGrading(ctx, {
        studentMemberDocId: studentDocId,
        level: 'Level 2',
      });

      const declineRes = await declineGrading(
        ctx,
        grading.data!.docId,
        'Cannot travel on requested date',
        { name: 'Sifu Alex' },
      );

      expect(declineRes.success).toBe(true);
      expect(declineRes.data?.status).toBe(GradingStatus.Declined);
      expect(declineRes.data?.declineNotes).toContain('Cannot travel');
    });

    it('records a pass result and automatically updates student level on member record', async () => {
      const grading = await createGrading(ctx, {
        studentMemberDocId: studentDocId,
        level: 'Level 2',
      });

      const resultRes = await recordGradingResult(
        ctx,
        grading.data!.docId,
        { pass: true, resultNotes: 'Exemplary form and understanding.', awardLevel: true },
        { name: 'Grandmaster' },
      );

      expect(resultRes.success).toBe(true);
      expect(resultRes.data?.status).toBe(GradingStatus.Passed);

      // Verify member record was updated with the new level
      const student = await getMember(ctx, studentDocId);
      expect(student?.studentLevel).toBe('Level 2');
    });

    it('links and unlinks an event on a grading', async () => {
      const ev = await createEvent(ctx, {
        title: 'Summer Seminar 2026',
        start: '2026-07-15',
      });

      const grading = await createGrading(ctx, {
        studentMemberDocId: studentDocId,
        level: 'Level 3',
      });

      const linkRes = await linkGradingToEvent(ctx, grading.data!.docId, ev.data!.docId);
      expect(linkRes.success).toBe(true);
      expect(linkRes.data?.gradingEventDocId).toBe(ev.data!.docId);
      expect(linkRes.data?.gradingEvent).toBe('Summer Seminar 2026');

      const unlinkRes = await unlinkGradingFromEvent(ctx, grading.data!.docId);
      expect(unlinkRes.success).toBe(true);
      expect(unlinkRes.data?.gradingEventDocId).toBe('');
    });
  });

  describe('Events Actions', () => {
    it('creates an event with owner information resolved from member record', async () => {
      const owner = await createMember(ctx, {
        name: 'Organizer Sam',
        email: 'organizer@example.com',
        countryCode: 'US',
      });

      const res = await createEvent(ctx, {
        title: 'Winter Workshop 2026',
        start: '2026-12-01',
        location: 'Boulder, CO',
        ownerDocId: owner.data!.docId,
      });

      expect(res.success).toBe(true);
      expect(res.data?.title).toBe('Winter Workshop 2026');
      expect(res.data?.ownerName).toBe('Organizer Sam');
      expect(res.data?.status).toBe(EventStatus.Listed); // Admin actor default
    });

    it('changes event status and manages event managers', async () => {
      const ev = await createEvent(ctx, {
        title: 'Spring Camp',
        start: '2026-04-10',
      });

      const cancelRes = await setEventStatus(ctx, ev.data!.docId, EventStatus.Cancelled);
      expect(cancelRes.success).toBe(true);
      expect(cancelRes.data?.status).toBe(EventStatus.Cancelled);

      const addMgrRes = await addEventManager(ctx, ev.data!.docId, 'mgr_doc_5');
      expect(addMgrRes.success).toBe(true);
      expect(addMgrRes.data?.managerDocIds).toContain('mgr_doc_5');

      const remMgrRes = await removeEventManager(ctx, ev.data!.docId, 'mgr_doc_5');
      expect(remMgrRes.success).toBe(true);
      expect(remMgrRes.data?.managerDocIds).not.toContain('mgr_doc_5');
    });

    it('deletes an event', async () => {
      const ev = await createEvent(ctx, {
        title: 'Delete Me Event',
        start: '2026-01-01',
      });

      const delRes = await deleteEvent(ctx, ev.data!.docId);
      expect(delRes.success).toBe(true);

      const check = await getEvent(ctx, ev.data!.docId);
      expect(check).toBeNull();
    });
  });

  describe('VOD Actions', () => {
    let memberDocId: string;

    beforeEach(async () => {
      const m = await createMember(ctx, {
        name: 'Video Subscriber',
        email: 'subscriber@example.com',
        countryCode: 'US',
      });
      memberDocId = m.data!.docId;
    });

    it('creates and publishes a video item', async () => {
      const res = await createVideo(ctx, {
        title: 'Spinning Hands Fundamentals',
        accessTier: VodAccessTier.ClassVideoSubscribers,
        tags: ['spinning_hands', 'level_2'],
      });

      expect(res.success).toBe(true);
      expect(res.data?.title).toBe('Spinning Hands Fundamentals');
      expect(res.data?.isPublished).toBe(false);

      const pubRes = await setVideoPublished(ctx, res.data!.docId, true);
      expect(pubRes.success).toBe(true);
      expect(pubRes.data?.isPublished).toBe(true);
      expect(pubRes.data?.publishedAt).toBeDefined();
    });

    it('curates a series across multiple videos', async () => {
      const v1 = await createVideo(ctx, { title: 'Part 1: Distance' });
      const v2 = await createVideo(ctx, { title: 'Part 2: Contact Point' });

      const seriesRes = await createOrUpdateVideoSeries(
        ctx,
        'spacing-series',
        {
          title: 'Understanding Spacing & Contact',
          priceCents: 2900,
        },
        [v1.data!.docId, v2.data!.docId],
      );

      expect(seriesRes.success).toBe(true);
      expect(seriesRes.data?.updatedCount).toBe(2);

      const checkV1 = await getVideo(ctx, v1.data!.docId);
      expect(checkV1?.seriesId).toBe('spacing-series');
      expect(checkV1?.seriesPartIndex).toBe(1);
      expect(checkV1?.seriesPriceCents).toBe(2900);

      const checkV2 = await getVideo(ctx, v2.data!.docId);
      expect(checkV2?.seriesPartIndex).toBe(2);
    });

    it('grants and revokes video access for a member', async () => {
      const video = await createVideo(ctx, { title: 'Exclusive Masterclass' });

      const grantRes = await grantVideoAccess(ctx, {
        videoId: video.data!.docId,
        recipientMemberDocId: memberDocId,
        grantKind: VideoGrantKind.AdminGrant,
        notes: 'Complimentary grant for attendance',
      });

      expect(grantRes.success).toBe(true);
      expect(grantRes.data?.grantedCount).toBe(1);

      const grants = await listMemberVideoGrants(ctx, memberDocId);
      expect(grants.length).toBe(1);
      expect(grants[0].videoId).toBe(video.data!.docId);
      expect(grants[0].grantKind).toBe(VideoGrantKind.AdminGrant);

      const revokeRes = await revokeVideoAccess(ctx, memberDocId, video.data!.docId);
      expect(revokeRes.success).toBe(true);

      const grantsAfter = await listMemberVideoGrants(ctx, memberDocId);
      expect(grantsAfter.length).toBe(0);
    });

    it('deletes a video from the catalog', async () => {
      const video = await createVideo(ctx, { title: 'Discard Video' });
      const delRes = await deleteVideo(ctx, video.data!.docId);
      expect(delRes.success).toBe(true);

      const check = await getVideo(ctx, video.data!.docId);
      expect(check).toBeNull();
    });
  });

  describe('Orders Actions', () => {
    it('updates order notes', async () => {
      const orderRef = inMemoryDb.collection('orders').doc('order_123');
      await orderRef.set({
        docId: 'order_123',
        ilcAppOrderKind: OrderKind.Squarespace,
        orderNumber: 'SQ-9999',
        lastUpdated: new Date().toISOString(),
      });

      const res = await updateOrderNotes(ctx, 'order_123', 'Verified payment with bank');
      expect(res.success).toBe(true);

      const updated = await getOrder(ctx, 'order_123');
      expect(updated?.ilcAppNotes).toBe('Verified payment with bank');
    });

    it('links an order line item to a member and school', async () => {
      const orderRef = inMemoryDb.collection('orders').doc('order_sq_link');
      const orderData = {
        id: 'sq_link_1',
        createdOn: new Date().toISOString(),
        modifiedOn: new Date().toISOString(),
        fulfillmentStatus: 'FULFILLED',
        docId: 'order_sq_link',
        ilcAppOrderKind: OrderKind.Squarespace,
        orderNumber: 'SQ-4455',
        lastUpdated: new Date().toISOString(),
        customerEmail: 'buyer@example.com',
        lineItems: [
          {
            id: 'li_1',
            sku: 'MEM-YEAR',
            quantity: '1',
            unitPricePaid: { value: '50.00' },
            lineItemType: SquareSpaceLineItemType.Service,
          },
        ],
      };
      await orderRef.set(orderData as any);

      await linkOrderToMember(ctx, 'order_sq_link', 'US402', 0);
      await linkOrderToSchool(ctx, 'order_sq_link', 'SCH-55', 0);

      const updated = (await getOrder(ctx, 'order_sq_link')) as SquareSpaceOrder;
      expect(updated.lineItems?.[0].ilcAppMemberIdInferred).toBe('US402');
      expect(updated.lineItems?.[0].ilcAppSchoolIdInferred).toBe('SCH-55');
    });

    it('resets processing state on an order for reprocessing', async () => {
      const orderRef = inMemoryDb.collection('orders').doc('order_reprocess');
      const orderData = {
        id: 'sq_reprocess_1',
        createdOn: new Date().toISOString(),
        modifiedOn: new Date().toISOString(),
        fulfillmentStatus: 'FULFILLED',
        docId: 'order_reprocess',
        ilcAppOrderKind: OrderKind.Squarespace,
        orderNumber: 'SQ-8888',
        ilcAppOrderStatus: OrderStatus.Error,
        ilcAppOrderIssues: ['Member not found'],
        lastUpdated: new Date().toISOString(),
        customerEmail: 'reprocess@example.com',
        lineItems: [
          {
            id: 'li_2',
            sku: 'GRA-1',
            quantity: '1',
            unitPricePaid: { value: '80.00' },
            lineItemType: SquareSpaceLineItemType.Service,
            ilcAppProcessingStatus: OrderStatus.Error,
          },
        ],
      };
      await orderRef.set(orderData as any);

      const res = await reprocessOrder(ctx, 'order_reprocess');
      expect(res.success).toBe(true);

      const updated = (await getOrder(ctx, 'order_reprocess')) as SquareSpaceOrder;
      expect(updated.ilcAppOrderStatus).toBeUndefined();
      expect(updated.ilcAppOrderIssues).toBeUndefined();
      expect(updated.lineItems?.[0].ilcAppProcessingStatus).toBeUndefined();
    });
  });
});
