/* grant-video.spec.ts
 *
 * Unit tests for grantVideoAccess Callable Cloud Function.
 */

import * as admin from 'firebase-admin';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { grantVideoAccess } from './grant-video';
import {
  GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH,
  GrantVideoAccessRequest,
  GrantVideoAccessResponse,
  VideoGrant,
  VideoGrantKind,
  initVideoItem,
} from '../data-model/vod';
import { initMember } from '../data-model/members';
import { MailSendingStatus, MailSettings, TransactionalEmailKey } from '../data-model/mail';
import { MemberNotification } from '../data-model/notifications';
import { sendTransactionalEmail } from '../email-dispatcher';

vi.mock('../email-dispatcher', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue('mock_mail_1'),
}));

// The deployed callable exposes `.run()` for direct invocation in tests.
interface RunnableCallable {
  run(req: CallableRequest<Partial<GrantVideoAccessRequest>>): Promise<GrantVideoAccessResponse>;
}

const runGrant = (req: CallableRequest<Partial<GrantVideoAccessRequest>>) =>
  (grantVideoAccess as unknown as RunnableCallable).run(req);

describe('grantVideoAccess', () => {
  let mockMemberSubcollectionSet: ReturnType<typeof vi.fn>;
  let mockGlobalGrantsSet: ReturnType<typeof vi.fn>;
  let mockNotificationsSet: ReturnType<typeof vi.fn>;
  let isAdminCaller = true;
  let mailSettings: MailSettings;

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
    mailSettings = { status: MailSendingStatus.Active };
    vi.clearAllMocks();
    mockMemberSubcollectionSet = vi.fn().mockResolvedValue({});
    mockGlobalGrantsSet = vi.fn().mockResolvedValue({});
    mockNotificationsSet = vi.fn().mockResolvedValue({});

    const mockDb = {
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
            where: vi.fn((_field: string, _op: string, val: string) => {
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
            where: vi.fn((_field: string, _op: string, val: string) => ({
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
              data: () => mailSettings,
            }),
          };
        }
        return {
          get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        };
      }),
    };

    vi.spyOn(admin, 'firestore').mockReturnValue(mockDb as never as admin.firestore.Firestore);
  });

  const makeCallableRequest = (data: Partial<GrantVideoAccessRequest>, email = 'admin@example.com') =>
    ({
      auth: email ? { token: { email }, uid: 'uid_admin' } : undefined,
      data,
      rawRequest: {},
      acceptsStreaming: false,
    }) as never as CallableRequest<Partial<GrantVideoAccessRequest>>;

  const lastGlobalGrant = (): VideoGrant =>
    mockGlobalGrantsSet.mock.calls[mockGlobalGrantsSet.mock.calls.length - 1][0] as VideoGrant;
  const lastNotification = (): MemberNotification =>
    mockNotificationsSet.mock.calls[0][0] as MemberNotification;

  it('rejects unauthenticated caller', async () => {
    const req = makeCallableRequest({ targetType: 'video', targetId: 'vid_101' }, '');
    await expect(runGrant(req)).rejects.toThrowError(HttpsError);
  });

  it('rejects non-admin caller', async () => {
    isAdminCaller = false;
    const req = makeCallableRequest({ targetType: 'video', targetId: 'vid_101' }, 'student@example.com');
    await expect(runGrant(req)).rejects.toThrowError(HttpsError);
  });

  it('rejects missing recipient email', async () => {
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: '',
    });
    await expect(runGrant(req)).rejects.toThrowError('A valid recipient email is required');
  });

  it('grants a single video to a member as AdminGrant without gift fields', async () => {
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'target_mem_42',
      notes: 'Private admin note',
      notificationMessage: 'Enjoy this one, from HQ!',
    });

    const result = await runGrant(req);

    expect(result).toEqual({
      success: true,
      grantedCount: 1,
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'target_mem_42',
      notifiedInApp: true,
      emailSent: true,
    });

    expect(mockMemberSubcollectionSet).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'vid_101',
        videoId: 'vid_101',
        memberDocId: 'target_mem_42',
        grantKind: VideoGrantKind.AdminGrant,
        grantedByMemberDocId: 'admin_doc_1',
        notes: 'Private admin note',
      }),
    );

    const grant = lastGlobalGrant();
    expect(grant.memberEmail).toBe('student@example.com');
    expect(grant.grantKind).toBe(VideoGrantKind.AdminGrant);
    expect(grant.giftedByName).toBeUndefined();
    expect(grant.giftedByEmail).toBeUndefined();
    expect(grant.giftedByMemberDocId).toBeUndefined();
    expect(grant.giftMessage).toBeUndefined();

    const notification = lastNotification();
    expect(notification.kind).toBe('VideoAccessGranted');
    expect(notification.markdown).toBe('Enjoy this one, from HQ!\n\n[Watch now](/videos/vid_101)');

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: 'student@example.com',
        templateKey: TransactionalEmailKey.VodAccessGranted,
        replacements: expect.objectContaining({
          name: 'Recipient Student',
          videoTitle: 'Neutral Stance & Mechanics',
          videoUrl: expect.stringContaining('/videos/vid_101'),
          message: 'Enjoy this one, from HQ!',
        }),
      }),
    );
  });

  it('ignores a client-supplied grantKind and always stores AdminGrant', async () => {
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'student@example.com',
      grantKind: VideoGrantKind.GiftPurchase,
    } as Partial<GrantVideoAccessRequest>);

    await runGrant(req);
    expect(lastGlobalGrant().grantKind).toBe(VideoGrantKind.AdminGrant);
  });

  it('grants an entire series to a member', async () => {
    const req = makeCallableRequest({
      targetType: 'series',
      targetId: 'series_basics',
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'target_mem_42',
    });

    const result = await runGrant(req);

    expect(result.success).toBe(true);
    // targetId (seriesId) + 2 videos in the series = 3 grants
    expect(result.grantedCount).toBe(3);
    expect(mockMemberSubcollectionSet).toHaveBeenCalledTimes(3);
    expect(mockGlobalGrantsSet).toHaveBeenCalledTimes(3);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: 'student@example.com',
        templateKey: TransactionalEmailKey.VodAccessGranted,
      }),
    );
  });

  it('uses a default message when the notification message is empty', async () => {
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'student@example.com',
      notificationMessage: '   ',
    });

    await runGrant(req);

    const expected = "You've been given access to **Neutral Stance & Mechanics**.";
    expect(lastNotification().markdown).toBe(`${expected}\n\n[Watch now](/videos/vid_101)`);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        replacements: expect.objectContaining({ message: expected }),
      }),
    );
  });

  it('rejects a notification message that is too long', async () => {
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'student@example.com',
      notificationMessage: 'x'.repeat(GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH + 1),
    });

    await expect(runGrant(req)).rejects.toThrowError(HttpsError);
    expect(mockGlobalGrantsSet).not.toHaveBeenCalled();
  });

  it('grants to a non-member email even when mail sending is off', async () => {
    mailSettings = { status: MailSendingStatus.Off };
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'Unregistered@Example.com',
    });

    const result = await runGrant(req);

    expect(result.success).toBe(true);
    expect(result.grantedCount).toBe(1);
    expect(result.recipientMemberDocId).toBeUndefined();
    expect(result.notifiedInApp).toBe(false);
    expect(result.emailSent).toBe(false);
    expect(mockMemberSubcollectionSet).not.toHaveBeenCalled();
    expect(mockGlobalGrantsSet).toHaveBeenCalledWith(
      expect.objectContaining({
        memberEmail: 'unregistered@example.com',
        memberDocId: '',
        grantKind: VideoGrantKind.AdminGrant,
      }),
    );
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('emails a non-member recipient when mail is on (no in-app notification)', async () => {
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'unregistered@example.com',
      recipientName: 'New Friend',
    });

    const result = await runGrant(req);

    expect(result.notifiedInApp).toBe(false);
    expect(result.emailSent).toBe(true);
    expect(mockNotificationsSet).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: 'unregistered@example.com',
        replacements: expect.objectContaining({ name: 'New Friend' }),
      }),
    );
  });

  it('skips email but still notifies in-app when VodAccessGranted email is off', async () => {
    mailSettings = {
      status: MailSendingStatus.Active,
      notificationStatus: { [TransactionalEmailKey.VodAccessGranted]: MailSendingStatus.Off },
    };
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'target_mem_42',
    });

    const result = await runGrant(req);

    expect(result.notifiedInApp).toBe(true);
    expect(result.emailSent).toBe(false);
    expect(mockNotificationsSet).toHaveBeenCalled();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('skips in-app notification and email when sendNotification is false', async () => {
    const req = makeCallableRequest({
      targetType: 'video',
      targetId: 'vid_101',
      recipientEmail: 'student@example.com',
      recipientMemberDocId: 'target_mem_42',
      sendNotification: false,
      notificationMessage: 'x'.repeat(GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH + 1),
    });

    const result = await runGrant(req);
    expect(result.success).toBe(true);
    expect(result.grantedCount).toBe(1);
    expect(result.notifiedInApp).toBe(false);
    expect(result.emailSent).toBe(false);
    expect(mockNotificationsSet).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
