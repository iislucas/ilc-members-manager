/* member-docs-for-email.spec.ts
 *
 * Unit tests for the shared "which member docs belong to this email?" lookup
 * used by both checkEmailStatus (pre-auth) and getUserDetails (post-auth).
 */

import { describe, it, expect } from 'vitest';
import { emailHasMemberRecord, findMemberDocsForEmail } from './member-docs-for-email';
import { InMemoryFirestore } from './testing/in-memory-firestore';

describe('findMemberDocsForEmail', () => {
  it('returns the existing members listed in the ACL', async () => {
    const fake = new InMemoryFirestore({
      acl: { 'a@x.com': { memberDocIds: ['m1', 'gone'] } },
      members: { m1: { emails: ['a@x.com'] } },
    });
    const res = await findMemberDocsForEmail(fake.asFirestore(), 'a@x.com');
    expect(res.memberDocs.map((d) => d.id)).toEqual(['m1']);
    expect(res.aclNeedsRepair).toBe(false);
    expect(res.acl?.memberDocIds).toEqual(['m1', 'gone']);
  });

  it('falls back to the members query when every ACL entry is deleted', async () => {
    const fake = new InMemoryFirestore({
      acl: { 'a@x.com': { memberDocIds: ['gone'] } },
      members: { m2: { emails: ['a@x.com'] } },
    });
    const res = await findMemberDocsForEmail(fake.asFirestore(), 'a@x.com');
    expect(res.memberDocs.map((d) => d.id)).toEqual(['m2']);
    expect(res.aclNeedsRepair).toBe(true);
  });

  it('tries the raw email for legacy un-normalised member data', async () => {
    const fake = new InMemoryFirestore({
      members: { m3: { emails: ['Legacy@X.com'] } },
    });
    const res = await findMemberDocsForEmail(fake.asFirestore(), 'legacy@x.com', ' Legacy@X.com ');
    expect(res.memberDocs.map((d) => d.id)).toEqual(['m3']);
    expect(res.acl).toBeNull();
    expect(res.aclNeedsRepair).toBe(true);
  });

  it('returns nothing (and no repair) when no member matches', async () => {
    const fake = new InMemoryFirestore({
      acl: { 'admin@x.com': { memberDocIds: [], isAdmin: true } },
    });
    const res = await findMemberDocsForEmail(fake.asFirestore(), 'admin@x.com');
    expect(res.memberDocs).toEqual([]);
    expect(res.aclNeedsRepair).toBe(false);
    expect(res.acl?.isAdmin).toBe(true);
  });
});

describe('emailHasMemberRecord', () => {
  it('is true only when an existing member is linked', async () => {
    const fake = new InMemoryFirestore({
      acl: {
        'stale@x.com': { memberDocIds: ['gone'] },
        'ok@x.com': { memberDocIds: ['m1'] },
      },
      members: { m1: { emails: ['ok@x.com'] } },
    });
    expect(await emailHasMemberRecord(fake.asFirestore(), 'ok@x.com')).toBe(true);
    expect(await emailHasMemberRecord(fake.asFirestore(), 'stale@x.com')).toBe(false);
    expect(await emailHasMemberRecord(fake.asFirestore(), 'nobody@x.com')).toBe(false);
  });
});
