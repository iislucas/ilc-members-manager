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

export enum ApplicationLevel {
  None = '',
  Level1 = '1',
  Level2 = '2',
  Level3 = '3',
  Level4 = '4',
  Level5 = '5',
  Level6 = '6',
}

export const gradingProgression = [
  'Student Entry',
  'Student 1',
  'Student 2',
  'Student 3',
  'Application 1',
  'Student 4',
  'Application 2',
  'Student 5',
  'Student 6',
  'Application 3',
  'Student 7',
  'Student 8',
  'Application 4',
  'Student 9',
  'Student 10',
  'Application 5',
  'Student 11',
  'Application 6',
];

export const levelToCanAssessGrading: Record<string, string> = {
  'Application 1': 'Student 2',
  'Application 2': 'Student 3',
  'Application 3': 'Student 5',
  'Application 4': 'Student 6',
  'Application 5': 'Student 7',
  'Application 6': 'Student 8',
};

export enum LevelTrack {
  Student = 'Student',
  Application = 'Application',
}

// True when `levelValue` is at or below `currentValue` within one track. E.g.
// isAtOrBelow(LevelTrack.Student, '3', '6') → true. "Entry" is always the lowest student
// level. Non-numeric/unset values that aren't "Entry" compare as not-achieved.
function isLevelAtOrBelow(
  track: LevelTrack,
  levelValue: string,
  currentValue: string,
): boolean {
  if (track === LevelTrack.Student) {
    if (levelValue === 'Entry') return true;
    if (currentValue === 'Entry') return levelValue === 'Entry';
  }
  const levelNum = parseInt(levelValue, 10);
  const currentNum = parseInt(currentValue, 10);
  if (isNaN(levelNum) || isNaN(currentNum)) return false;
  return levelNum <= currentNum;
}

// The set of `gradingProgression` entries a student with the given current
// student/application levels has already achieved.
export function achievedGradingLevels(
  studentLevel: string,
  applicationLevel: string,
): Set<string> {
  const achieved = new Set<string>();
  for (const level of gradingProgression) {
    if (level.startsWith('Student ')) {
      const value = level.substring('Student '.length);
      if (studentLevel && isLevelAtOrBelow(LevelTrack.Student, value, studentLevel)) {
        achieved.add(level);
      }
    } else if (level.startsWith('Application ')) {
      const value = level.substring('Application '.length);
      if (applicationLevel && isLevelAtOrBelow(LevelTrack.Application, value, applicationLevel)) {
        achieved.add(level);
      }
    }
  }
  return achieved;
}

// The next grading a student should take: the first entry in
// `gradingProgression` they have not yet achieved, given their current levels.
// Returns '' if every level has been achieved.
export function nextGradingLevel(
  studentLevel: string,
  applicationLevel: string,
): string {
  const achieved = achievedGradingLevels(studentLevel, applicationLevel);
  for (const level of gradingProgression) {
    if (!achieved.has(level)) return level;
  }
  return '';
}

// Normalise a stored grading level to its canonical `gradingProgression` form.
// Levels are usually stored as 'Student X' / 'Application X', but some legacy
// data stores a bare number or 'Entry' (implicitly a student level).
export function normalizeGradingLevel(level: string): string {
  if (!level) return '';
  if (level.startsWith('Student ') || level.startsWith('Application ')) return level;
  if (level === 'Entry' || !isNaN(Number(level))) return 'Student ' + level;
  return level;
}

// The grading level immediately before `level` in the canonical progression —
// i.e. the level a student holds just before grading for `level`. Note this is
// the preceding entry across the interleaved Student/Application progression
// (e.g. the level before 'Application 3' is 'Student 6'), not the previous level
// within the same track. Returns '' when `level` is the first entry or unknown.
export function previousGradingLevel(level: string): string {
  const idx = gradingProgression.indexOf(normalizeGradingLevel(level));
  if (idx <= 0) return '';
  return gradingProgression[idx - 1];
}

// The grading level immediately after `level` in the canonical progression.
// Returns '' when `level` is the last entry, not found, or empty.
export function levelAfter(level: string): string {
  const idx = gradingProgression.indexOf(normalizeGradingLevel(level));
  if (idx < 0 || idx >= gradingProgression.length - 1) return '';
  return gradingProgression[idx + 1];
}

// Whether an instructor with the given student level is qualified to assess a
// grading at `gradingLevel`. Only Application gradings have a minimum assessor
// level (see `levelToCanAssessGrading`); for all other levels any instructor is
// considered qualified.
export function instructorCanAssessLevel(
  instructorStudentLevel: string,
  gradingLevel: string,
): boolean {
  const required = levelToCanAssessGrading[gradingLevel];
  if (!required) return true;
  const requiredNum = parseInt(required.replace('Student ', ''), 10);
  if (isNaN(requiredNum)) return true;
  // "Entry" or unset student levels are below any numeric requirement.
  const instrNum = parseInt(instructorStudentLevel, 10);
  if (isNaN(instrNum)) return false;
  return instrNum >= requiredNum;
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
