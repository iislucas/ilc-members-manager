/* grant-video.spec.ts
 *
 * Unit tests for grantVideoAccess Callable Cloud Function.
 */

import * as admin from 'firebase-admin';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { grantVideoAccess, GrantVideoAccessRequest } from './grant-video';
import { VideoGrantKind, initVideoItem } from '../data-model/vod';
import { initMember } from '../data-model/members';
import { sendTransactionalEmail } from '../email-dispatcher';

vi.mock('../email-dispatcher', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue('mock_mail_1'),
}));

describe('grantVideoAccess', () => {
  let mockMemberSubcollectionSet: any;
  let mockGlobalGrantsSet: any;
  let mockNotificationsSet: any;
  let mockDb: any;
  let isAdminCaller = true;
  let mailSettingsStatus = 'active';

  const mockAdminMember = {
    ...initMember(),
    docId: 'admin_doc_1',
    name: 'Admin User',
    emails: ['admin@example.com'],
    isAdmin: true,
  };

  const mockTargetMember = {
    ...initMember(),
    docId: 'target_mem_42',
    name: 'Recipient Student',
    emails: ['student@example.com'],
  };

  const mockVideo = {
    ...initVideoItem(),
    docId: 'vid_101',
    title: 'Neutral Stance & Mechanics',
    seriesId: 'series_basics',
  };

  const mockSeriesVideo1 = {
    ...initVideoItem(),
    docId: 'vid_series_1',
    title: 'Series Part 1',
    seriesId: 'series_basics',
  };

  const mockSeriesVideo2 = {
    ...initVideoItem(),
    docId: 'vid_series_2',
    title: 'Series Part 2',
    seriesId: 'series_basics',
  };

  beforeEach(() => {
    isAdminCaller = true;
    mailSettingsStatus = 'active';
    vi.clearAllMocks();
    mockMemberSubcollectionSet = vi.fn().mockResolvedValue({});
    mockGlobalGrantsSet = vi.fn().mockResolvedValue({});
    mockNotificationsSet = vi.fn().mockResolvedValue({});

    mockDb = {
      collection: vi.fn((colName: string) => {
        if (colName === 'acl') {
          return {
            doc: vi.fn((email: string) => {
              const exists = email === 'admin@example.com' || email === 'student@example.com';
              return {
                get: vi.fn().mockResolvedValue({
                  exists,
                  data: () => ({
                    isAdmin: email === 'admin@example.com' && isAdminCaller,
                    memberDocIds: email === 'admin@example.com' ? ['admin_doc_1'] : ['target_mem_42'],
                  }),
                }),
              };
            }),
          };
        }
        if (colName === 'members') {
          return {
            doc: vi.fn((docId: string) => {
              const data = docId === 'admin_doc_1' ? mockAdminMember : mockTargetMember;
              return {
                get: vi.fn().mockResolvedValue({
                  exists: docId === 'admin_doc_1' || docId === 'target_mem_42',
                  id: docId,
                  data: () => data,
                }),
                collection: vi.fn((subName: string) => {
                  if (subName === 'videoGrants') {
                    return {
                      doc: vi.fn().mockReturnValue({ set: mockMemberSubcollectionSet }),
                    };
                  }
                  if (subName === 'notifications') {
                    return {
                      doc: vi.fn().mockReturnValue({ set: mockNotificationsSet }),
                      where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
                      }),
                    };
                  }
                  return {};
                }),
              };
            }),
            where: vi.fn((field: string, op: string, val: string) => {
              const known = val === 'admin@example.com' || val === 'student@example.com';
              return {
                limit: vi.fn().mockReturnValue({
                  get: vi.fn().mockResolvedValue({
                    empty: !known,
                    docs: known
                      ? [
                          {
                            id: val === 'admin@example.com' ? 'admin_doc_1' : 'target_mem_42',
                            data: () => (val === 'admin@example.com' ? mockAdminMember : mockTargetMember),
                          },
                        ]
                      : [],
                  }),
                }),
              };
            }),
          };
        }
        if (colName === 'videos') {
          return {
            doc: vi.fn((vidId: string) => ({
              get: vi.fn().mockResolvedValue({
                exists: vidId === 'vid_101',
                id: vidId,
                data: () => mockVideo,
              }),
            })),
            where: vi.fn((field: string, op: string, val: string) => ({
              get: vi.fn().mockResolvedValue({
                empty: val !== 'series_basics',
                docs: [
                  { id: 'vid_series_1', data: () => mockSeriesVideo1 },
                  { id: 'vid_series_2', data: () => mockSeriesVideo2 },
                ],
              }),
            })),
          };
        }
        if (colName === 'video_grants') {
          return {
            doc: vi.fn().mockReturnValue({ set: mockGlobalGrantsSet }),
          };
        }
        return {};
      }),
      doc: vi.fn((docPath: string) => {
        if (docPath === 'system/mail-settings') {
          return {
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ status: mailSettingsStatus }),
            }),
          };
        }
        return {
          get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        };
      }),
    };

    vi.spyOn(admin, 'firestore').mockReturnValue(mockDb as any);
  });

  const makeCallableRequest = (data: Partial<GrantVideoAccessRequest>, email = 'admin@example.com') =>
    ({
      auth: email ? { token: { email }, uid: 'uid_admin' } : undefined,
      data,
      rawRequest: {} as any,
      accepts: () => true,
    }) as unknown as import('firebase-functions/v2/https').CallableRequest<GrantVideoAccessRequest>;

  it('rejects unauthenticated caller', async () => {
    const req = makeCallableRequest({ targetType: 'video', targetId: 'vid_101' }, '');
    await expect((grantVideoAccess as any).run(req)).rejects.toThrowError(HttpsError);
  });

  it('rejects non-admin caller', async () => {
    isAdminCaller = false;
    const req = makeCallableRequest({ targetType: 'video', targetId: 'vid_101' }, 'student@example.com');
    await expect((grantVideoAccess as any).run(req)).rejects.toThrowError(HttpsError);
  });

  it('rejects missing recipient email', async () => {
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: '',
    });
    await expect((grantVideoAccess as any).run(req)).rejects.toThrowError('A valid recipient email is required');
  });

  it('successfully grants single video to member', async () => {
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'target_mem_42',
      grantKind: VideoGrantKind.AdminGrant,
      notes: 'Gift from Grandmaster for dedication',
    });

    const result = await (grantVideoAccess as any).run(req);

    expect(result.success).toBe(true);
    expect(result.grantedCount).toBe(1);
    expect(result.recipientMemberDocId).toBe('target_mem_42');

    expect(mockMemberSubcollectionSet).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'vid_101',
        videoId: 'vid_101',
        memberDocId: 'target_mem_42',
        grantKind: 'admin_grant',
        giftedByName: 'Admin User',
        notes: 'Gift from Grandmaster for dedication',
      }),
    );

    expect(mockGlobalGrantsSet).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'vid_101',
        memberEmail: 'student@example.com',
        grantKind: 'admin_grant',
      }),
    );

    expect(mockNotificationsSet).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'VideoAccessGranted',
      }),
    );

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: 'student@example.com',
        templateKey: 'vodGiftReceived',
        replacements: expect.objectContaining({
          name: 'Recipient Student',
          giverName: 'Admin User',
          videoTitle: 'Neutral Stance & Mechanics',
          videoUrl: expect.stringContaining('/videos/vid_101'),
          giftMessage: 'Gift from Grandmaster for dedication',
        }),
      }),
    );
  });

  it('successfully grants an entire series to member', async () => {
    const req = makeCallableRequest({
      targetType: 'series',
      targetId: 'series_basics',
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'target_mem_42',
      grantKind: VideoGrantKind.Complimentary,
    });

    const result = await (grantVideoAccess as any).run(req);

    expect(result.success).toBe(true);
    // targetId (seriesId) + 2 videos in the series = 3 grants
    expect(result.grantedCount).toBe(3);
    expect(mockMemberSubcollectionSet).toHaveBeenCalledTimes(3);
    expect(mockGlobalGrantsSet).toHaveBeenCalledTimes(3);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: 'student@example.com',
        templateKey: 'vodGiftReceived',
      }),
    );
  });

  it('rejects granting to non-member when mail sending is off', async () => {
    mailSettingsStatus = 'off';
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'unregistered@example.com',
    });

    await expect((grantVideoAccess as any).run(req)).rejects.toThrowError(
      'Email notifications are currently turned off. Access can only be granted to existing member accounts.',
    );
  });

  it('allows granting to existing member when mail sending is off', async () => {
    mailSettingsStatus = 'off';
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'target_mem_42',
    });

    const result = await (grantVideoAccess as any).run(req);
    expect(result.success).toBe(true);
    expect(result.grantedCount).toBe(1);
  });

  it('skips in-app notification and email when sendNotification is false', async () => {
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'target_mem_42',
      grantKind: VideoGrantKind.AdminGrant,
      sendNotification: false,
    });

    const result = await (grantVideoAccess as any).run(req);
    expect(result.success).toBe(true);
    expect(result.grantedCount).toBe(1);
    expect(mockNotificationsSet).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
