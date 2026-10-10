/* Unit tests for the pure planning functions behind the normalize-emails backfill. */
import { describe, it, expect } from 'vitest';
import {
  planMemberEmailUpdates,
  planEventEmailUpdates,
  planSchoolEmailUpdates,
  planRegistrationEmailUpdates,
  planVideoGrantEmailUpdates,
  planVideoGrantDocIdMove,
  mergeAclDocs,
} from './email-backfill';

describe('planMemberEmailUpdates', () => {
  it('lower-cases, trims and de-duplicates emails, keeping the primary first', () => {
    expect(
      planMemberEmailUpdates({ emails: ['Primary@X.com', ' other@y.com', 'primary@x.com', ''] }),
    ).toEqual({ emails: ['primary@x.com', 'other@y.com'] });
  });
  it('normalises publicEmail', () => {
    expect(planMemberEmailUpdates({ emails: ['a@b.com'], publicEmail: 'Contact@B.com' })).toEqual({
      publicEmail: 'contact@b.com',
    });
  });
  it('returns no updates for already-normalised data (idempotent)', () => {
    const first = planMemberEmailUpdates({ emails: ['A@B.com'], publicEmail: 'X@Y.com' });
    expect(planMemberEmailUpdates({ ...first })).toEqual({});
    expect(planMemberEmailUpdates({ emails: ['a@b.com'], publicEmail: '' })).toEqual({});
  });
  it('leaves missing / malformed fields alone', () => {
    expect(planMemberEmailUpdates({})).toEqual({});
  });
});

describe('planEventEmailUpdates', () => {
  it('normalises owner/manager email arrays and updatedByEmail', () => {
    expect(
      planEventEmailUpdates({
        ownerEmails: ['Owner@X.com'],
        managerEmails: ['m@x.com', 'M@X.com'],
        updatedByEmail: 'Admin@X.com',
      }),
    ).toEqual({ ownerEmails: ['owner@x.com'], managerEmails: ['m@x.com'], updatedByEmail: 'admin@x.com' });
  });
  it('returns no updates when already normalised', () => {
    expect(planEventEmailUpdates({ ownerEmails: ['o@x.com'], managerEmails: [], updatedByEmail: '' })).toEqual({});
  });
});

describe('planSchoolEmailUpdates', () => {
  it('normalises owner/manager email arrays', () => {
    expect(planSchoolEmailUpdates({ ownerEmails: ['A@B.com'], managerEmails: ['c@d.com'] })).toEqual({
      ownerEmails: ['a@b.com'],
    });
  });
});

describe('planRegistrationEmailUpdates', () => {
  it('normalises the attendee email', () => {
    expect(planRegistrationEmailUpdates({ email: ' Attendee@X.com' })).toEqual({ email: 'attendee@x.com' });
    expect(planRegistrationEmailUpdates({ email: 'attendee@x.com' })).toEqual({});
  });
});

describe('planVideoGrantEmailUpdates', () => {
  it('normalises memberEmail and giftedByEmail', () => {
    expect(planVideoGrantEmailUpdates({ memberEmail: 'M@X.com', giftedByEmail: 'G@X.com' })).toEqual({
      memberEmail: 'm@x.com',
      giftedByEmail: 'g@x.com',
    });
    expect(planVideoGrantEmailUpdates({ memberEmail: 'm@x.com' })).toEqual({});
  });
});

describe('planVideoGrantDocIdMove', () => {
  it('moves email-keyed grant ids with a non-normalised email prefix', () => {
    expect(planVideoGrantDocIdMove('Foo@X.com_video123', 'Foo@X.com')).toBe('foo@x.com_video123');
  });
  it('does not move member-keyed or already-normalised ids', () => {
    expect(planVideoGrantDocIdMove('memberDoc_video123', 'Foo@X.com')).toBeUndefined();
    expect(planVideoGrantDocIdMove('foo@x.com_video123', 'foo@x.com')).toBeUndefined();
    expect(planVideoGrantDocIdMove('foo@x.com_video123', undefined)).toBeUndefined();
  });
});

describe('mergeAclDocs', () => {
  it('copies a legacy ACL when there is no normalised doc yet', () => {
    expect(
      mergeAclDocs(
        {
          memberDocIds: ['m1'],
          instructorIds: [],
          schoolDocIds: [],
          isAdmin: true,
          membershipExpires: '2030-01-01',
          instructorLicenseExpires: '',
          schoolLicenseExpires: '',
          notYetLinkedToMember: false,
        },
        undefined,
      ),
    ).toEqual({
      memberDocIds: ['m1'],
      instructorIds: [],
      schoolDocIds: [],
      isAdmin: true,
      membershipExpires: '2030-01-01',
      instructorLicenseExpires: '',
      schoolLicenseExpires: '',
      notYetLinkedToMember: false,
    });
  });
  it('unions permissions and never reduces them', () => {
    const merged = mergeAclDocs(
      { memberDocIds: ['m1', 'm2'], instructorIds: ['I1'], isAdmin: true, membershipExpires: 'life', notYetLinkedToMember: true },
      { memberDocIds: ['m2', 'm3'], schoolDocIds: ['s1'], isAdmin: false, membershipExpires: '2027-01-01', instructorLicenseExpires: '2026-05-01', notYetLinkedToMember: false },
    );
    expect(merged.memberDocIds).toEqual(['m2', 'm3', 'm1']);
    expect(merged.instructorIds).toEqual(['I1']);
    expect(merged.schoolDocIds).toEqual(['s1']);
    expect(merged.isAdmin).toBe(true);
    expect(merged.membershipExpires).toBe('life');
    expect(merged.instructorLicenseExpires).toBe('2026-05-01');
    expect(merged.schoolLicenseExpires).toBe('');
    expect(merged.notYetLinkedToMember).toBe(false);
  });
  it('is only unlinked when every source is explicitly unlinked', () => {
    expect(mergeAclDocs({ notYetLinkedToMember: true }, { notYetLinkedToMember: true }).notYetLinkedToMember).toBe(true);
    expect(mergeAclDocs({ notYetLinkedToMember: true }, {}).notYetLinkedToMember).toBe(false);
    expect(mergeAclDocs({}, {}).notYetLinkedToMember).toBeUndefined();
  });
  it('picks the later dated expiry', () => {
    expect(mergeAclDocs({ schoolLicenseExpires: '2026-01-01' }, { schoolLicenseExpires: '2025-12-31' }).schoolLicenseExpires).toBe('2026-01-01');
  });
});
