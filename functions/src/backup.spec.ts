/* backup.spec.ts — unit tests for database backup system */
import * as admin from 'firebase-admin';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BACKUP_COLLECTIONS,
  BACKUP_SUBCOLLECTION_GROUPS,
  BACKUP_MIXED_COLLECTIONS,
  BACKUP_RETENTION_DAYS,
  cleanupOldBackups,
  performBackup,
} from './backup';
import { FirestoreCollection, FirestoreSubcollection } from './data-model/collections';
import { BlogPostSourceKind } from './data-model/content-cache';

describe('backup system', () => {
  it('should include all required top-level authored collections in BACKUP_COLLECTIONS', () => {
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.Products);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.Events);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.Members);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.Schools);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.Gradings);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.Orders);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.Acl);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.System);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.Videos);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.VideoGrants);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.Statistics);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.ArticlesPost);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.MembersPost);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.InstructorsPost);
    expect(BACKUP_COLLECTIONS).toContain(FirestoreCollection.NewsPost);
  });

  it('should include all required authored subcollections in BACKUP_SUBCOLLECTION_GROUPS', () => {
    expect(BACKUP_SUBCOLLECTION_GROUPS).toContain(FirestoreSubcollection.Registrations);
    expect(BACKUP_SUBCOLLECTION_GROUPS).toContain(FirestoreSubcollection.Notifications);
    expect(BACKUP_SUBCOLLECTION_GROUPS).toContain(FirestoreSubcollection.Uploads);
    expect(BACKUP_SUBCOLLECTION_GROUPS).toContain(FirestoreSubcollection.VideoProgress);
    expect(BACKUP_SUBCOLLECTION_GROUPS).toContain(FirestoreSubcollection.VideoGrants);
    expect(BACKUP_SUBCOLLECTION_GROUPS).toContain(FirestoreSubcollection.PushSubscriptions);
    expect(BACKUP_SUBCOLLECTION_GROUPS).toContain(FirestoreSubcollection.VideoTimeRanges);
  });

  describe('performBackup', () => {
    let savedContent: string | null = null;
    let savedOptions: unknown = null;
    let mockFileSave: ReturnType<typeof vi.fn>;
    let mockBucketFile: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      savedContent = null;
      savedOptions = null;
      mockFileSave = vi.fn().mockImplementation((content: string, opts: unknown) => {
        savedContent = content;
        savedOptions = opts;
        return Promise.resolve();
      });

      mockBucketFile = vi.fn().mockReturnValue({
        save: mockFileSave,
      });

      vi.spyOn(admin, 'storage').mockReturnValue({
        bucket: vi.fn().mockReturnValue({
          file: mockBucketFile,
          getFiles: vi.fn().mockResolvedValue([[]]),
        }),
      } as any);

      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: (col: string) => {
          return {
            get: vi.fn().mockImplementation(async () => {
              if (col === FirestoreCollection.Products) {
                return {
                  size: 1,
                  docs: [
                    {
                      id: 'prod_workshop_1',
                      data: () => ({ title: 'Intensive Workshop', price: 150 }),
                    },
                  ],
                };
              }
              if (col === FirestoreCollection.ArticlesPost) {
                return {
                  size: 2,
                  docs: [
                    {
                      id: 'article_published',
                      data: () => ({ title: 'Published Guide', isDraft: false, status: 'published' }),
                    },
                    {
                      id: 'article_draft',
                      data: () => ({ title: 'Draft Philosophy Essay', isDraft: true, status: 'draft' }),
                    },
                  ],
                };
              }
              if (col === FirestoreCollection.MembersPost) {
                return {
                  size: 4,
                  docs: [
                    {
                      id: 'post_cached',
                      data: () => ({ kind: BlogPostSourceKind.Squarespace, title: 'Cached Post', isDraft: false }),
                    },
                    {
                      id: 'post_authored',
                      data: () => ({ kind: BlogPostSourceKind.FirebaseSourced, title: 'App Post' }),
                    },
                    {
                      id: 'post_draft_squarespace_kind',
                      data: () => ({ kind: BlogPostSourceKind.Squarespace, title: 'Draft Overriding Squarespace', isDraft: true }),
                    },
                    {
                      id: 'post_draft_unspecified_kind',
                      data: () => ({ title: 'Draft Without Kind', status: 'draft' }),
                    },
                  ],
                };
              }
              return {
                size: 0,
                docs: [],
              };
            }),
          };
        },
        collectionGroup: (group: string) => {
          return {
            get: vi.fn().mockImplementation(async () => {
              if (group === FirestoreSubcollection.Registrations) {
                return {
                  size: 2,
                  docs: [
                    {
                      id: 'reg_1',
                      ref: { path: 'events/ev_123/registrations/reg_1' },
                      data: () => ({ name: 'Alice', amountPaidCents: 15000, status: 'paid' }),
                    },
                    {
                      id: 'reg_1',
                      ref: { path: 'members/mem_456/registrations/reg_1' },
                      data: () => ({ name: 'Alice', amountPaidCents: 15000, status: 'paid' }),
                    },
                  ],
                };
              }
              return {
                size: 0,
                docs: [],
              };
            }),
          };
        },
      } as any);
    });

    it('performs backup including products, registrations, and draft articles', async () => {
      const fileName = await performBackup();

      expect(fileName).toMatch(/^backups\/backup-.*\.json$/);
      expect(mockFileSave).toHaveBeenCalledTimes(1);

      const parsed = JSON.parse(savedContent!);
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('data');

      // Check products
      expect(parsed.data).toHaveProperty('products');
      expect(parsed.data.products).toEqual([
        { id: 'prod_workshop_1', title: 'Intensive Workshop', price: 150 },
      ]);

      // Check articles-post (includes both published and draft articles)
      expect(parsed.data).toHaveProperty('articles-post');
      expect(parsed.data['articles-post']).toEqual([
        { id: 'article_published', title: 'Published Guide', isDraft: false, status: 'published' },
        { id: 'article_draft', title: 'Draft Philosophy Essay', isDraft: true, status: 'draft' },
      ]);

      // Check registrations
      expect(parsed.data).toHaveProperty('registrations');
      expect(parsed.data.registrations).toEqual([
        {
          id: 'reg_1',
          path: 'events/ev_123/registrations/reg_1',
          name: 'Alice',
          amountPaidCents: 15000,
          status: 'paid',
        },
        {
          id: 'reg_1',
          path: 'members/mem_456/registrations/reg_1',
          name: 'Alice',
          amountPaidCents: 15000,
          status: 'paid',
        },
      ]);

      // Check members-post preserves ALL posts including cached Squarespace ones, authored ones, and drafts
      expect(parsed.data).toHaveProperty('members-post');
      expect(parsed.data['members-post']).toEqual([
        { id: 'post_cached', kind: BlogPostSourceKind.Squarespace, title: 'Cached Post', isDraft: false },
        { id: 'post_authored', kind: BlogPostSourceKind.FirebaseSourced, title: 'App Post' },
        { id: 'post_draft_squarespace_kind', kind: BlogPostSourceKind.Squarespace, title: 'Draft Overriding Squarespace', isDraft: true },
        { id: 'post_draft_unspecified_kind', title: 'Draft Without Kind', status: 'draft' },
      ]);
    });

    it('throws error when file save fails', async () => {
      mockFileSave.mockRejectedValue(new Error('Storage failure'));

      await expect(performBackup()).rejects.toThrow('Database backup failed.');
    });
  });

  describe('cleanupOldBackups', () => {
    it('has BACKUP_RETENTION_DAYS set to 180', () => {
      expect(BACKUP_RETENTION_DAYS).toBe(180);
    });

    it('deletes backup files older than 180 days and retains newer ones', async () => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;

      const mockDeleteOld = vi.fn().mockResolvedValue([]);
      const mockDeleteRecent = vi.fn().mockResolvedValue([]);
      const mockDeleteNonBackup = vi.fn().mockResolvedValue([]);

      const oldFile = {
        name: 'backups/backup-2025-01-01T00:00:00.000Z.json',
        getMetadata: vi.fn().mockResolvedValue([{ timeCreated: new Date(now - 190 * dayMs).toISOString() }]),
        delete: mockDeleteOld,
      };

      const recentFile = {
        name: 'backups/backup-2026-09-01T00:00:00.000Z.json',
        getMetadata: vi.fn().mockResolvedValue([{ timeCreated: new Date(now - 30 * dayMs).toISOString() }]),
        delete: mockDeleteRecent,
      };

      const nonBackupFile = {
        name: 'backups/some-other-file.txt',
        getMetadata: vi.fn().mockResolvedValue([{ timeCreated: new Date(now - 200 * dayMs).toISOString() }]),
        delete: mockDeleteNonBackup,
      };

      const mockBucket = {
        getFiles: vi.fn().mockResolvedValue([[oldFile, recentFile, nonBackupFile]]),
      } as any;

      const deleted = await cleanupOldBackups(mockBucket, 180);

      expect(deleted).toEqual(['backups/backup-2025-01-01T00:00:00.000Z.json']);
      expect(mockDeleteOld).toHaveBeenCalledTimes(1);
      expect(mockDeleteRecent).not.toHaveBeenCalled();
      expect(mockDeleteNonBackup).not.toHaveBeenCalled();
    });

    it('falls back to filename timestamp if metadata timeCreated is missing', async () => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;

      const mockDelete = vi.fn().mockResolvedValue([]);
      const oldTimestamp = new Date(now - 200 * dayMs).toISOString();

      const oldFileNoMeta = {
        name: `backups/backup-${oldTimestamp}.json`,
        getMetadata: vi.fn().mockResolvedValue([{}]),
        delete: mockDelete,
      };

      const mockBucket = {
        getFiles: vi.fn().mockResolvedValue([[oldFileNoMeta]]),
      } as any;

      const deleted = await cleanupOldBackups(mockBucket, 180);

      expect(deleted).toEqual([`backups/backup-${oldTimestamp}.json`]);
      expect(mockDelete).toHaveBeenCalledTimes(1);
    });
  });
});
