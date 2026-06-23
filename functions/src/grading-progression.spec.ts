import { describe, it, expect } from 'vitest';
import {
  nextGradingLevel,
  achievedGradingLevels,
  instructorCanAssessLevel,
  previousGradingLevel,
  normalizeGradingLevel,
} from './data-model';

describe('grading progression helpers', () => {
  describe('nextGradingLevel', () => {
    it('returns Student Entry for a brand-new student (no levels)', () => {
      // With no recorded student level, even "Student Entry" is not yet achieved.
      expect(nextGradingLevel('', '')).toBe('Student Entry');
    });

    it('returns the next student step when application is untouched', () => {
      // Student 3 achieved, no application: progression goes ... Student 3,
      // Application 1, ... so the next unachieved is Application 1.
      expect(nextGradingLevel('3', '')).toBe('Application 1');
    });

    it('advances past achieved application levels', () => {
      // Student 3 + Application 1 achieved → next is Student 4.
      expect(nextGradingLevel('3', '1')).toBe('Student 4');
    });

    it('treats Entry as the lowest achieved student level', () => {
      expect(nextGradingLevel('Entry', '')).toBe('Student 1');
    });

    it('returns "" when every level is achieved', () => {
      expect(nextGradingLevel('11', '6')).toBe('');
    });
  });

  describe('achievedGradingLevels', () => {
    it('includes Student Entry once any student level is recorded', () => {
      expect(achievedGradingLevels('', '').has('Student Entry')).toBe(false);
      expect(achievedGradingLevels('1', '').has('Student Entry')).toBe(true);
    });

    it('includes everything at or below the current levels', () => {
      const achieved = achievedGradingLevels('5', '2');
      expect(achieved.has('Student 5')).toBe(true);
      expect(achieved.has('Application 2')).toBe(true);
      expect(achieved.has('Student 6')).toBe(false);
      expect(achieved.has('Application 3')).toBe(false);
    });
  });

  describe('previousGradingLevel', () => {
    it('returns the preceding entry within a track', () => {
      expect(previousGradingLevel('Student 6')).toBe('Student 5');
      expect(previousGradingLevel('Student 1')).toBe('Student Entry');
    });

    it('crosses tracks following the interleaved progression', () => {
      // ... Student 6, Application 3, Student 7 ...
      expect(previousGradingLevel('Application 3')).toBe('Student 6');
      expect(previousGradingLevel('Student 7')).toBe('Application 3');
      expect(previousGradingLevel('Student 4')).toBe('Application 1');
    });

    it('returns "" for the first entry or an unknown level', () => {
      expect(previousGradingLevel('Student Entry')).toBe('');
      expect(previousGradingLevel('Bogus 9')).toBe('');
    });

    it('normalises legacy bare-number / Entry levels', () => {
      expect(previousGradingLevel('6')).toBe('Student 5');
      expect(previousGradingLevel('1')).toBe('Student Entry');
    });
  });

  describe('normalizeGradingLevel', () => {
    it('prefixes bare numbers and Entry with Student', () => {
      expect(normalizeGradingLevel('6')).toBe('Student 6');
      expect(normalizeGradingLevel('Entry')).toBe('Student Entry');
    });
    it('leaves already-qualified levels untouched', () => {
      expect(normalizeGradingLevel('Student 6')).toBe('Student 6');
      expect(normalizeGradingLevel('Application 2')).toBe('Application 2');
      expect(normalizeGradingLevel('')).toBe('');
    });
  });

  describe('instructorCanAssessLevel', () => {
    it('allows any instructor for student-level gradings (no requirement)', () => {
      expect(instructorCanAssessLevel('', 'Student 6')).toBe(true);
      expect(instructorCanAssessLevel('Entry', 'Student 11')).toBe(true);
    });

    it('requires the mapped minimum student level for application gradings', () => {
      // Application 3 requires Student 5.
      expect(instructorCanAssessLevel('5', 'Application 3')).toBe(true);
      expect(instructorCanAssessLevel('6', 'Application 3')).toBe(true);
      expect(instructorCanAssessLevel('4', 'Application 3')).toBe(false);
    });

    it('treats Entry/unset instructor level as unqualified for application gradings', () => {
      expect(instructorCanAssessLevel('Entry', 'Application 1')).toBe(false);
      expect(instructorCanAssessLevel('', 'Application 1')).toBe(false);
    });
  });
});
