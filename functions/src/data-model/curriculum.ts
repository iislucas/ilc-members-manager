/* Levels in the I Liq Chuan syllabus.
 *
 * Two representations, each a TypeScript enum and each the only form written to
 * Firestore:
 *
 *  - `GradingLevel` — a grading level, i.e. one rung of the progression:
 *    'Student Entry', 'Student 1'…'Student 11', 'Application 1'…'Application 6'.
 *    Used for `Grading.level`, order metadata, `gradingProgression`, and anything
 *    that names "a level you grade for". ('Student Entry' is in effect Student 0.)
 *  - `StudentLevel` / `ApplicationLevel` — a member's position on each track, as
 *    held in `Member.studentLevel` ('', 'Entry', '1'…'11') and
 *    `Member.applicationLevel` ('', '1'…'6').
 *
 * Older and imported data uses many spellings ('Entry Level', 'Student Level 3',
 * '3', 'Level 2', 'Application Level 1', …). Never compare raw strings: read
 * through `toGradingLevel`, `toStudentLevel` and `toApplicationLevel`, which
 * accept every known spelling and return the enum, so no backfill is needed.
 * Convert between the two representations with `studentLevelOf`,
 * `applicationLevelOf`, `gradingLevelForStudent` and `gradingLevelForApplication`.
 */

// A member's position on the student track (`Member.studentLevel`). None means
// no student level yet; Entry is below Level1.
export enum StudentLevel {
  None = '',
  Entry = 'Entry',
  Level1 = '1',
  Level2 = '2',
  Level3 = '3',
  Level4 = '4',
  Level5 = '5',
  Level6 = '6',
  Level7 = '7',
  Level8 = '8',
  Level9 = '9',
  Level10 = '10',
  Level11 = '11',
}

// A member's position on the application track (`Member.applicationLevel`).
export enum ApplicationLevel {
  None = '',
  Level1 = '1',
  Level2 = '2',
  Level3 = '3',
  Level4 = '4',
  Level5 = '5',
  Level6 = '6',
}

// A grading level: one rung of the syllabus, and the canonical stored form of
// `Grading.level`. See `gradingProgression` for the order they are graded in.
export enum GradingLevel {
  StudentEntry = 'Student Entry',
  Student1 = 'Student 1',
  Student2 = 'Student 2',
  Student3 = 'Student 3',
  Student4 = 'Student 4',
  Student5 = 'Student 5',
  Student6 = 'Student 6',
  Student7 = 'Student 7',
  Student8 = 'Student 8',
  Student9 = 'Student 9',
  Student10 = 'Student 10',
  Student11 = 'Student 11',
  Application1 = 'Application 1',
  Application2 = 'Application 2',
  Application3 = 'Application 3',
  Application4 = 'Application 4',
  Application5 = 'Application 5',
  Application6 = 'Application 6',
}

export enum LevelTrack {
  Student = 'Student',
  Application = 'Application',
}

// The order levels are graded in. Student and Application levels interleave:
// Application 1 comes after Student 3, not after Student 11.
export const gradingProgression: readonly GradingLevel[] = [
  GradingLevel.StudentEntry,
  GradingLevel.Student1,
  GradingLevel.Student2,
  GradingLevel.Student3,
  GradingLevel.Application1,
  GradingLevel.Student4,
  GradingLevel.Application2,
  GradingLevel.Student5,
  GradingLevel.Student6,
  GradingLevel.Application3,
  GradingLevel.Student7,
  GradingLevel.Student8,
  GradingLevel.Application4,
  GradingLevel.Student9,
  GradingLevel.Student10,
  GradingLevel.Application5,
  GradingLevel.Student11,
  GradingLevel.Application6,
];

// The member student-track position each student grading level awards.
const STUDENT_LEVEL_OF: Partial<Record<GradingLevel, StudentLevel>> = {
  [GradingLevel.StudentEntry]: StudentLevel.Entry,
  [GradingLevel.Student1]: StudentLevel.Level1,
  [GradingLevel.Student2]: StudentLevel.Level2,
  [GradingLevel.Student3]: StudentLevel.Level3,
  [GradingLevel.Student4]: StudentLevel.Level4,
  [GradingLevel.Student5]: StudentLevel.Level5,
  [GradingLevel.Student6]: StudentLevel.Level6,
  [GradingLevel.Student7]: StudentLevel.Level7,
  [GradingLevel.Student8]: StudentLevel.Level8,
  [GradingLevel.Student9]: StudentLevel.Level9,
  [GradingLevel.Student10]: StudentLevel.Level10,
  [GradingLevel.Student11]: StudentLevel.Level11,
};

// The member application-track position each application grading level awards.
const APPLICATION_LEVEL_OF: Partial<Record<GradingLevel, ApplicationLevel>> = {
  [GradingLevel.Application1]: ApplicationLevel.Level1,
  [GradingLevel.Application2]: ApplicationLevel.Level2,
  [GradingLevel.Application3]: ApplicationLevel.Level3,
  [GradingLevel.Application4]: ApplicationLevel.Level4,
  [GradingLevel.Application5]: ApplicationLevel.Level5,
  [GradingLevel.Application6]: ApplicationLevel.Level6,
};

// Track positions lowest first, for comparing two positions on one track.
const STUDENT_LEVEL_ORDER: readonly StudentLevel[] = Object.values(StudentLevel).filter(
  (l) => l !== StudentLevel.None,
);
const APPLICATION_LEVEL_ORDER: readonly ApplicationLevel[] = Object.values(
  ApplicationLevel,
).filter((l) => l !== ApplicationLevel.None);

const GRADING_LEVEL_VALUES: readonly string[] = Object.values(GradingLevel);

// True when `value` is exactly a `GradingLevel` (no normalisation).
export function isGradingLevel(value: string): value is GradingLevel {
  return GRADING_LEVEL_VALUES.includes(value);
}

// The grading level for track + number, e.g. (Student, '3') → Student 3.
// Student 0 is Student Entry. null when there is no such level.
function gradingLevelFromParts(track: LevelTrack, num: string): GradingLevel | null {
  const n = parseInt(num, 10);
  if (track === LevelTrack.Student && n === 0) return GradingLevel.StudentEntry;
  const candidate = `${track} ${n}`;
  return isGradingLevel(candidate) ? candidate : null;
}

// Reads any known spelling of a grading level as a `GradingLevel`, or null when
// the text doesn't name a syllabus level (e.g. 'Meditation & Philosophy').
//
//   toGradingLevel('Student Level 3')     → GradingLevel.Student3
//   toGradingLevel('Entry Level')         → GradingLevel.StudentEntry
//   toGradingLevel('GRADING : Application Level 2') → GradingLevel.Application2
//   toGradingLevel('App 2')               → GradingLevel.Application2
//   toGradingLevel('3')                   → GradingLevel.Student3 (legacy: bare = student)
export function toGradingLevel(raw: string | null | undefined): GradingLevel | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (isGradingLevel(text)) return text;
  const application = /\bapp(?:lication)?\s*(?:level\s*)?(\d+)/i.exec(text);
  if (application) return gradingLevelFromParts(LevelTrack.Application, application[1]);
  const student = /student\s*(?:level\s*)?(\d+)/i.exec(text);
  if (student) return gradingLevelFromParts(LevelTrack.Student, student[1]);
  if (/\bentry\b/i.test(text)) return GradingLevel.StudentEntry;
  const bare = /^(?:level\s*)?(\d+)$/i.exec(text);
  if (bare) return gradingLevelFromParts(LevelTrack.Student, bare[1]);
  return null;
}

// A stored grading level in canonical form: the `GradingLevel` when the text
// names a syllabus level, otherwise the trimmed text unchanged (gradings for
// things outside the syllabus keep their own label).
export function normalizeGradingLevel(raw: string): string {
  return toGradingLevel(raw) ?? (raw ?? '').trim();
}

// Which track a grading level is on.
export function trackOf(level: GradingLevel): LevelTrack {
  return STUDENT_LEVEL_OF[level] !== undefined ? LevelTrack.Student : LevelTrack.Application;
}

// The student-track position a grading level awards, or None for an
// application level.
export function studentLevelOf(level: GradingLevel): StudentLevel {
  return STUDENT_LEVEL_OF[level] ?? StudentLevel.None;
}

// The application-track position a grading level awards, or None for a
// student level.
export function applicationLevelOf(level: GradingLevel): ApplicationLevel {
  return APPLICATION_LEVEL_OF[level] ?? ApplicationLevel.None;
}

// The grading level for a student-track position, or null for None.
export function gradingLevelForStudent(level: StudentLevel): GradingLevel | null {
  return (
    (Object.keys(STUDENT_LEVEL_OF) as GradingLevel[]).find(
      (g) => level !== StudentLevel.None && STUDENT_LEVEL_OF[g] === level,
    ) ?? null
  );
}

// The grading level for an application-track position, or null for None.
export function gradingLevelForApplication(level: ApplicationLevel): GradingLevel | null {
  return (
    (Object.keys(APPLICATION_LEVEL_OF) as GradingLevel[]).find(
      (g) => level !== ApplicationLevel.None && APPLICATION_LEVEL_OF[g] === level,
    ) ?? null
  );
}

// Reads any known spelling of a member's student level ('2', 'Student 2',
// 'Student Level 2', 'Entry Level', …) as a `StudentLevel`. Unrecognised or
// empty values read as None.
export function toStudentLevel(raw: string | null | undefined): StudentLevel {
  const level = toGradingLevel(raw);
  return level ? studentLevelOf(level) : StudentLevel.None;
}

// Reads any known spelling of a member's application level ('1', 'Application
// 1', 'Application Level 1', …) as an `ApplicationLevel`. A bare number is an
// application level here. Unrecognised or empty values read as None.
export function toApplicationLevel(raw: string | null | undefined): ApplicationLevel {
  const text = (raw ?? '').trim();
  const bare = /^(?:level\s*)?(\d+)$/i.exec(text);
  const level = toGradingLevel(bare ? `Application ${bare[1]}` : text);
  return level ? applicationLevelOf(level) : ApplicationLevel.None;
}

// How far along the student track a member level is: -1 for none, 0 for
// Entry, then 1…11. Accepts any spelling. Use to compare two student levels.
export function studentLevelRank(raw: string | null | undefined): number {
  return STUDENT_LEVEL_ORDER.indexOf(toStudentLevel(raw));
}

// How far along the application track a member level is: -1 for none, then
// 0…5 for Application 1…6. Accepts any spelling.
export function applicationLevelRank(raw: string | null | undefined): number {
  return APPLICATION_LEVEL_ORDER.indexOf(toApplicationLevel(raw));
}

// Display label for a member's student level: 'Student Entry', 'Student 3', or
// '' when none. Accepts any spelling.
export function studentLevelLabel(raw: string | null | undefined): string {
  return gradingLevelForStudent(toStudentLevel(raw)) ?? '';
}

// Display label for a member's application level: 'Application 2', or '' when
// none. Accepts any spelling.
export function applicationLevelLabel(raw: string | null | undefined): string {
  return gradingLevelForApplication(toApplicationLevel(raw)) ?? '';
}

// The set of grading levels a member with the given student/application levels
// has already achieved. Accepts any spelling (see `toStudentLevel`).
export function achievedGradingLevels(
  studentLevel: string,
  applicationLevel: string,
): Set<GradingLevel> {
  const studentRank = studentLevelRank(studentLevel);
  const applicationRank = applicationLevelRank(applicationLevel);
  const achieved = new Set<GradingLevel>();
  for (const level of gradingProgression) {
    const rank =
      trackOf(level) === LevelTrack.Student
        ? STUDENT_LEVEL_ORDER.indexOf(studentLevelOf(level))
        : APPLICATION_LEVEL_ORDER.indexOf(applicationLevelOf(level));
    const held = trackOf(level) === LevelTrack.Student ? studentRank : applicationRank;
    if (held >= 0 && rank <= held) achieved.add(level);
  }
  return achieved;
}

// The next grading a student should take: the first entry in
// `gradingProgression` they have not yet achieved, given their current levels.
// Returns '' if every level has been achieved.
export function nextGradingLevel(
  studentLevel: string,
  applicationLevel: string,
): GradingLevel | '' {
  const achieved = achievedGradingLevels(studentLevel, applicationLevel);
  return gradingProgression.find((level) => !achieved.has(level)) ?? '';
}

// The grading level immediately before `level` in the canonical progression —
// i.e. the level a student holds just before grading for `level`. Note this is
// the preceding entry across the interleaved Student/Application progression
// (e.g. the level before 'Application 3' is 'Student 6'), not the previous level
// within the same track. Returns '' when `level` is the first entry or unknown.
export function previousGradingLevel(level: string): GradingLevel | '' {
  const idx = progressionIndex(level);
  if (idx <= 0) return '';
  return gradingProgression[idx - 1];
}

// The levels before `level` in `gradingProgression` that a student holding the
// given student/application levels has not yet achieved, in progression order.
// A grading's result (passed / not passed) may only be recorded once this is
// empty: gradings can be bought, requested and accepted ahead, but they are
// graded in sequence. Returns [] when `level` is not in the progression.
//
//   unachievedEarlierLevels('Student 3', '1', '') → ['Student 2']
export function unachievedEarlierLevels(
  level: string,
  studentLevel: string,
  applicationLevel: string,
): GradingLevel[] {
  const idx = progressionIndex(level);
  if (idx <= 0) return [];
  const achieved = achievedGradingLevels(studentLevel, applicationLevel);
  return gradingProgression.slice(0, idx).filter((l) => !achieved.has(l));
}

// The grading level immediately after `level` in the canonical progression.
// Returns '' when `level` is the last entry, not found, or empty.
export function levelAfter(level: string): GradingLevel | '' {
  const idx = progressionIndex(level);
  if (idx < 0 || idx >= gradingProgression.length - 1) return '';
  return gradingProgression[idx + 1];
}

// Position of `level` (any spelling) in `gradingProgression`, or -1.
export function progressionIndex(level: string): number {
  const g = toGradingLevel(level);
  return g ? gradingProgression.indexOf(g) : -1;
}

// The minimum student level an instructor needs to assess each grading level.
// Levels not listed can be assessed by any instructor.
export const levelToCanAssessGrading: Partial<Record<GradingLevel, StudentLevel>> = {
  [GradingLevel.Application1]: StudentLevel.Level2,
  [GradingLevel.Application2]: StudentLevel.Level3,
  [GradingLevel.Application3]: StudentLevel.Level5,
  [GradingLevel.Application4]: StudentLevel.Level6,
  [GradingLevel.Application5]: StudentLevel.Level7,
  [GradingLevel.Application6]: StudentLevel.Level8,
};

// Whether an instructor with the given student level is qualified to assess a
// grading at `gradingLevel`. Only Application gradings have a minimum assessor
// level (see `levelToCanAssessGrading`); for all other levels any instructor is
// considered qualified. Accepts any spelling of either level.
export function instructorCanAssessLevel(
  instructorStudentLevel: string,
  gradingLevel: string,
): boolean {
  const level = toGradingLevel(gradingLevel);
  const required = level ? levelToCanAssessGrading[level] : undefined;
  if (!required) return true;
  return studentLevelRank(instructorStudentLevel) >= studentLevelRank(required);
}

export enum InstructorLicenseType {
  None = 'None',
  Annual = 'Annual',
  Life = 'Life',
}

/** Access level tiers for resource uploads, matching storage directory names. */
export enum ResourceAccessLevel {
  Public = 'public',
  Members = 'members',
  Instructors = 'instructors',
  SchoolOwners = 'school-owners',
  Admins = 'admins',
}

/** All resource access levels in order from most to least permissive. */
export const RESOURCE_ACCESS_LEVELS = Object.values(ResourceAccessLevel);

/** Human-readable labels for each access level. */
export const ACCESS_LEVEL_LABELS: Record<ResourceAccessLevel, string> = {
  [ResourceAccessLevel.Public]: 'Public',
  [ResourceAccessLevel.Members]: 'Members',
  [ResourceAccessLevel.Instructors]: 'Instructors',
  [ResourceAccessLevel.SchoolOwners]: 'School Owners',
  [ResourceAccessLevel.Admins]: 'Admins',
};

/** Short descriptions for each access level. */
export const ACCESS_LEVEL_DESCRIPTIONS: Record<ResourceAccessLevel, string> = {
  [ResourceAccessLevel.Public]: 'Anyone can view, no login required',
  [ResourceAccessLevel.Members]: 'Active members only',
  [ResourceAccessLevel.Instructors]: 'Licensed instructors and admins only',
  [ResourceAccessLevel.SchoolOwners]: 'School owners/managers and admins',
  [ResourceAccessLevel.Admins]: 'Admins only',
};

export enum MasterLevel {
  Good = 'Good Hands',
  Wonder = 'Wonder Hands',
  Mystery = 'Mystery Hands',
  Compassion = 'Compassion Hands',
}
