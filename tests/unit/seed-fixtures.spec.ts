/*
 * Fixture-integrity unit tests — no emulator required.
 *
 * Guards the committed fixture (and so build-fixture-subset.ts's output): reads
 * the dataset straight from disk and asserts it is a CLOSED, anonymized graph —
 * referential integrity, role coverage, and PII hygiene.
 *
 *   pnpm test:fixtures
 *
 * These invariants describe a curated dataset. The raw full export in
 * tmp/seed-data is intentionally NOT closed (empty-id rows, dangling refs,
 * un-anonymized school emails) — that is exactly why we curate — so do not point
 * SEED_FIXTURE_DIR at the raw export here; it is expected to fail. (Dataset
 * selection is meant for the loader and behavioral tests, not this guardian.)
 *
 * Run via `pnpm test:fixtures` (not part of the default `pnpm test`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

type RawDoc = Record<string, unknown> & { id?: string };

// Dataset directory: SEED_FIXTURE_DIR (relative to cwd) or the committed fixture.
const dir = path.resolve(process.cwd(), process.env['SEED_FIXTURE_DIR'] ?? 'tests/fixtures/seed');

function read(file: string): RawDoc[] {
  const p = path.join(dir, file);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf-8')) as RawDoc[]) : [];
}

function str(doc: RawDoc, key: string): string {
  const v = doc[key];
  return typeof v === 'string' ? v : '';
}
function strArr(doc: RawDoc, key: string): string[] {
  const v = doc[key];
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
}

const members = read('members.json');
const schools = read('schools.json');
const instructors = read('instructors.json');
const gradings = read('gradings.json');
const acl = read('acl.json');

const memberDocIds = new Set(members.map((m) => str(m, 'id')));
const instructorIds = new Set(instructors.map((i) => str(i, 'instructorId')));
const schoolIds = new Set(schools.map((s) => str(s, 'schoolId')));
const schoolDocIds = new Set(schools.map((s) => str(s, 'id')));

describe(`seed fixture integrity (${dir})`, () => {
  it('has a non-empty, seedable dataset (every doc has a non-empty id)', () => {
    expect(members.length).toBeGreaterThan(0);
    expect(schools.length).toBeGreaterThan(0);
    expect(instructors.length).toBeGreaterThan(0);
    for (const docs of [members, schools, instructors, gradings, acl]) {
      for (const d of docs) expect(str(d, 'id')).not.toBe('');
    }
  });

  it('every member primaryInstructorId/primarySchoolId resolves (or is blank)', () => {
    for (const m of members) {
      const inst = str(m, 'primaryInstructorId');
      if (inst) expect(instructorIds).toContain(inst);
      const sid = str(m, 'primarySchoolId');
      if (sid) expect(schoolIds).toContain(sid);
      const sdoc = str(m, 'primarySchoolDocId');
      if (sdoc) expect(schoolDocIds).toContain(sdoc);
    }
  });

  it('every grading references a seeded student/instructor/school (or is blank)', () => {
    for (const g of gradings) {
      expect(memberDocIds).toContain(str(g, 'studentMemberDocId'));
      const gi = str(g, 'gradingInstructorId');
      if (gi) expect(instructorIds).toContain(gi);
      const sid = str(g, 'schoolId');
      if (sid) expect(schoolIds).toContain(sid);
    }
  });

  it('every school owner resolves to a seeded instructor', () => {
    for (const s of schools) {
      const owner = str(s, 'ownerInstructorId');
      if (owner) expect(instructorIds).toContain(owner);
    }
  });

  it('every ACL references only seeded members and schools', () => {
    for (const a of acl) {
      for (const m of strArr(a, 'memberDocIds')) expect(memberDocIds).toContain(m);
      for (const d of strArr(a, 'schoolDocIds')) expect(schoolDocIds).toContain(d);
    }
  });

  it('covers the roles tests need: at least one admin and one school manager', () => {
    expect(acl.some((a) => a['isAdmin'] === true)).toBe(true);
    expect(
      acl.some((a) => strArr(a, 'schoolDocIds').some((d) => schoolDocIds.has(d))),
    ).toBe(true);
  });

  it('contains no un-anonymized PII in school owner/manager emails', () => {
    for (const s of schools) {
      for (const e of [...strArr(s, 'ownerEmails'), ...strArr(s, 'managerEmails')]) {
        expect(e.endsWith('@example.com')).toBe(true);
      }
    }
  });
});
