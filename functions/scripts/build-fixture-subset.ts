/*
 * Build Fixture Subset Script
 *
 * Reads the anonymized full export in <repo-root>/tmp/seed-data/ (produced by
 * export-anonymized-data.ts) and writes a small, referentially-consistent slice
 * to <repo-root>/tests/fixtures/seed/. The slice is committed and used as the
 * default dataset for the emulator-driven tests in tests/.
 *
 * Output uses the same on-disk format as the full export, so the same loader
 * (tests/helpers/load-seed-fixtures.ts) and seed-emulator.ts can read either:
 *   - top-level collections:  {collection}.json            (arrays keyed by `id`)
 *   - subcollections:         subcollections/{parent}__{parentId}__{sub}.json
 *
 * Recreate from live data:
 *   cd functions
 *   pnpm exec ts-node scripts/export-anonymized-data.ts --project <prod>   # live -> tmp/seed-data
 *   pnpm exec ts-node scripts/build-fixture-subset.ts                      # tmp -> tests/fixtures/seed
 *
 * Usage:
 *   pnpm build:fixtures [-- --max-members 100 --src /abs/path/to/seed-data]
 *
 * Selection (graph-walk; see tests/fixtures/seed/README.md):
 *   roots = schools that have an ACL manager (acl.schoolDocIds) + the first admin
 *   -> instructors owning/managing those schools
 *   -> members linked to those instructors/schools (capped at --max-members)
 *   -> gradings of those members
 *   -> close edges: pull in every school/instructor still referenced, and blank
 *      any reference that cannot be resolved, so the slice is self-contained.
 *
 * The script is READ-ONLY w.r.t. Firestore — it only reads/writes local JSON.
 */
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// CLI args
// ============================================================
const args = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 && args.length > i + 1 ? args[i + 1] : undefined;
}

const repoRoot = path.resolve(__dirname, '../..');
const srcDir = path.resolve(argValue('--src') ?? path.join(repoRoot, 'tmp/seed-data'));
const outDir = path.resolve(argValue('--out') ?? path.join(repoRoot, 'tests/fixtures/seed'));
const maxMembers = Number(argValue('--max-members') ?? '100');

// ============================================================
// Helpers
// ============================================================
type RawDoc = Record<string, unknown> & { id?: string };

function readCollection(file: string): RawDoc[] {
  const p = path.join(srcDir, file);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as RawDoc[];
}

function str(doc: RawDoc, key: string): string {
  const v = doc[key];
  return typeof v === 'string' ? v : '';
}

function strArr(doc: RawDoc, key: string): string[] {
  const v = doc[key];
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
}

if (!fs.existsSync(srcDir)) {
  console.error(`Source seed directory not found: ${srcDir}`);
  console.error('Run export-anonymized-data.ts first, or pass --src <dir>.');
  process.exit(1);
}

// ============================================================
// Load source collections
// ============================================================
const allMembers = readCollection('members.json').filter((m) => str(m, 'id') !== '');
const allSchools = readCollection('schools.json');
const allInstructors = readCollection('instructors.json');
const allGradings = readCollection('gradings.json');
const allAcl = readCollection('acl.json');

const membersById = new Map(allMembers.map((m) => [str(m, 'id'), m]));
const schoolsByDocId = new Map(allSchools.map((s) => [str(s, 'id'), s]));
const schoolsBySchoolId = new Map(allSchools.map((s) => [str(s, 'schoolId'), s]));
const instructorsByInstructorId = new Map(
  allInstructors.map((i) => [str(i, 'instructorId'), i]),
);

// ============================================================
// 1. Root schools: those with ACL manager coverage, sorted, first 3.
//    Guarantees the school-manager access path is exercisable.
// ============================================================
const aclSchoolDocIds = new Set<string>();
for (const a of allAcl) for (const d of strArr(a, 'schoolDocIds')) aclSchoolDocIds.add(d);
const rootSchoolDocIds = [...aclSchoolDocIds]
  .filter((d) => schoolsByDocId.has(d))
  .sort()
  .slice(0, 3);
const rootSchoolIds = new Set(
  rootSchoolDocIds.map((d) => str(schoolsByDocId.get(d)!, 'schoolId')),
);

// Instructors who own/manage the root schools (by instructorId).
const rootInstructorIds = new Set<string>();
for (const d of rootSchoolDocIds) {
  const s = schoolsByDocId.get(d)!;
  const owner = str(s, 'ownerInstructorId');
  if (owner) rootInstructorIds.add(owner);
  for (const m of strArr(s, 'managerInstructorIds')) rootInstructorIds.add(m);
}

// ============================================================
// 2. Members: linked to root instructors/schools, capped at maxMembers.
//    Always include managers (acl.schoolDocIds) and the first admin.
// ============================================================
const selectedMemberIds = new Set<string>();
function addMember(id: string): void {
  if (id && membersById.has(id)) selectedMemberIds.add(id);
}

// Mandatory: members behind ACLs that manage a root school, and the first admin.
const sortedAcl = [...allAcl].sort((a, b) => str(a, 'id').localeCompare(str(b, 'id')));
for (const a of sortedAcl) {
  if (strArr(a, 'schoolDocIds').some((d) => rootSchoolDocIds.includes(d))) {
    for (const m of strArr(a, 'memberDocIds')) addMember(m);
  }
}
const firstAdmin = sortedAcl.find((a) => a['isAdmin'] === true);
if (firstAdmin) for (const m of strArr(firstAdmin, 'memberDocIds')) addMember(m);

// Members linked to the root schools/instructors.
const sortedMembers = [...allMembers].sort((a, b) =>
  str(a, 'memberId').localeCompare(str(b, 'memberId')),
);
for (const m of sortedMembers) {
  if (selectedMemberIds.size >= maxMembers) break;
  const linked =
    rootInstructorIds.has(str(m, 'primaryInstructorId')) ||
    rootSchoolIds.has(str(m, 'primarySchoolId'));
  if (linked) addMember(str(m, 'id'));
}
// Top up to maxMembers with additional members (by instructor) so the sample is
// representative even if the root schools are small.
for (const m of sortedMembers) {
  if (selectedMemberIds.size >= maxMembers) break;
  if (str(m, 'primaryInstructorId')) addMember(str(m, 'id'));
}

// ============================================================
// 3. Gradings of the selected members.
// ============================================================
const selectedGradings = allGradings.filter((g) =>
  selectedMemberIds.has(str(g, 'studentMemberDocId')),
);

// ============================================================
// 4. Close edges: collect every school/instructor still referenced.
// ============================================================
const selectedSchoolDocIds = new Set<string>(rootSchoolDocIds);
const selectedInstructorIds = new Set<string>(rootInstructorIds);

for (const id of selectedMemberIds) {
  const m = membersById.get(id)!;
  const sd = str(m, 'primarySchoolDocId');
  if (sd && schoolsByDocId.has(sd)) selectedSchoolDocIds.add(sd);
  const sid = str(m, 'primarySchoolId');
  if (sid && schoolsBySchoolId.has(sid)) selectedSchoolDocIds.add(str(schoolsBySchoolId.get(sid)!, 'id'));
  const inst = str(m, 'primaryInstructorId');
  if (inst && instructorsByInstructorId.has(inst)) selectedInstructorIds.add(inst);
}
for (const g of selectedGradings) {
  const gi = str(g, 'gradingInstructorId');
  if (gi && instructorsByInstructorId.has(gi)) selectedInstructorIds.add(gi);
  for (const ai of strArr(g, 'gradingManagerIds')) {
    if (instructorsByInstructorId.has(ai)) selectedInstructorIds.add(ai);
  }
  const sid = str(g, 'schoolId');
  if (sid && schoolsBySchoolId.has(sid)) selectedSchoolDocIds.add(str(schoolsBySchoolId.get(sid)!, 'id'));
}
// School owners must resolve to a seeded instructor.
for (const d of selectedSchoolDocIds) {
  const owner = str(schoolsByDocId.get(d)!, 'ownerInstructorId');
  if (owner && instructorsByInstructorId.has(owner)) selectedInstructorIds.add(owner);
}

const selectedInstructorDocIds = new Set<string>();
for (const inst of selectedInstructorIds) {
  const i = instructorsByInstructorId.get(inst);
  if (i) selectedInstructorDocIds.add(str(i, 'id'));
}

// ============================================================
// 5. Scrub + blank dangling refs so the slice is self-contained and PII-free.
// ============================================================
const seededSchoolIds = new Set<string>();
for (const d of selectedSchoolDocIds) seededSchoolIds.add(str(schoolsByDocId.get(d)!, 'schoolId'));

function emitMember(m: RawDoc): RawDoc {
  const out: RawDoc = { ...m };
  const inst = str(m, 'primaryInstructorId');
  if (inst && !selectedInstructorIds.has(inst)) out['primaryInstructorId'] = '';
  const sid = str(m, 'primarySchoolId');
  if (sid && !seededSchoolIds.has(sid)) out['primarySchoolId'] = '';
  const sd = str(m, 'primarySchoolDocId');
  if (sd && !selectedSchoolDocIds.has(sd)) out['primarySchoolDocId'] = '';
  return out;
}

function emitSchool(s: RawDoc): RawDoc {
  // ownerEmails / managerEmails are NOT anonymized by export-anonymized-data, so
  // replace them with synthetic instructor addresses to avoid committing PII.
  const owner = str(s, 'ownerInstructorId');
  return {
    ...s,
    ownerEmails: owner ? [`instructor-${owner}@example.com`] : [],
    managerEmails: strArr(s, 'managerInstructorIds').map((id) => `instructor-${id}@example.com`),
  };
}

function emitGrading(g: RawDoc): RawDoc {
  const out: RawDoc = { ...g };
  // Free-text name fields can carry PII; blank them.
  for (const k of ['acceptedByName', 'statusChangedByName', 'notes']) out[k] = '';
  const gi = str(g, 'gradingInstructorId');
  if (gi && !selectedInstructorIds.has(gi)) out['gradingInstructorId'] = '';
  out['gradingManagerIds'] = strArr(g, 'gradingManagerIds').filter((id) =>
    selectedInstructorIds.has(id),
  );
  // Default `paymentStatus` for sources predating the field (matches the
  // backfill): order-sourced gradings (orderId set) are paid-by-squarespace, the
  // rest paid-other. `studentLevelAtAcceptance`/`applicationLevelAtAcceptance`
  // pass through via the `{ ...g }` spread above when present on the source.
  if (g['paymentStatus'] === undefined) {
    out['paymentStatus'] = str(g, 'orderId') ? 'paid-by-squarespace' : 'paid-other';
    if (g['paymentNote'] === undefined) out['paymentNote'] = '';
  }
  const sid = str(g, 'schoolId');
  if (sid && !seededSchoolIds.has(sid)) out['schoolId'] = '';
  return out;
}

// ACL: keep entries that reference a seeded member; intersect their refs with the slice.
function emitAcl(a: RawDoc): RawDoc | null {
  const memberDocIds = strArr(a, 'memberDocIds').filter((id) => selectedMemberIds.has(id));
  if (memberDocIds.length === 0 && a['isAdmin'] !== true) return null;
  if (memberDocIds.length === 0) return null; // admin without a seeded member: skip
  return {
    ...a,
    memberDocIds,
    schoolDocIds: strArr(a, 'schoolDocIds').filter((d) => selectedSchoolDocIds.has(d)),
  };
}

// ============================================================
// 6. Subcollections: instructors/{docId}/members, filtered to seeded members.
//    Source subcollection docs have an empty `id` and the real id in `docId`;
//    remap `id = docId` so the seeder (which keys by `id`) does not skip them.
// ============================================================
const subDir = path.join(srcDir, 'subcollections');
const subFiles = fs.existsSync(subDir)
  ? fs.readdirSync(subDir).filter((f) => f.startsWith('instructors__') && f.endsWith('__members.json'))
  : [];

const emittedSub: { file: string; docs: RawDoc[] }[] = [];
for (const file of subFiles) {
  const parentDocId = file.split('__')[1];
  if (!selectedInstructorDocIds.has(parentDocId)) continue;
  const docs = (JSON.parse(fs.readFileSync(path.join(subDir, file), 'utf-8')) as RawDoc[])
    .map((d) => ({ ...d, id: str(d, 'docId') }))
    .filter((d) => selectedMemberIds.has(str(d, 'id')))
    .map((d) => emitMember(d));
  if (docs.length > 0) emittedSub.push({ file, docs });
}

// ============================================================
// Write output
// ============================================================
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'subcollections'), { recursive: true });

function write(file: string, docs: RawDoc[]): void {
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(docs, null, 2), 'utf-8');
  console.log(`  ${file}: ${docs.length}`);
}

const members = [...selectedMemberIds].map((id) => emitMember(membersById.get(id)!));
const schools = [...selectedSchoolDocIds].map((d) => emitSchool(schoolsByDocId.get(d)!));
const instructors = [...selectedInstructorDocIds].map(
  (d) => allInstructors.find((i) => str(i, 'id') === d)!,
);
const gradings = selectedGradings.map(emitGrading);
const acl = allAcl.map(emitAcl).filter((a): a is RawDoc => a !== null);

console.log(`Building fixture subset from ${srcDir}\n  -> ${outDir}\n`);
write('schools.json', schools);
write('instructors.json', instructors);
write('members.json', members);
write('gradings.json', gradings);
write('acl.json', acl);
for (const { file, docs } of emittedSub) {
  fs.writeFileSync(
    path.join(outDir, 'subcollections', file),
    JSON.stringify(docs, null, 2),
    'utf-8',
  );
}
console.log(`  subcollections: ${emittedSub.length} file(s)`);

console.log(
  `\nDone. ${members.length} members, ${schools.length} schools, ` +
    `${instructors.length} instructors, ${gradings.length} gradings, ${acl.length} acl, ` +
    `${emittedSub.reduce((n, s) => n + s.docs.length, 0)} cached sub-members.`,
);
