/* object-diff.spec.ts
 *
 * Tests for generic computeObjectDiff and domain field label/summary formatting.
 */

import { describe, expect, it } from 'vitest';
import {
  computeObjectDiff,
  formatFieldLabel,
  formatFieldSummary,
  DOMAIN_FIELD_LABELS,
} from './object-diff';
import { Member, initMember } from '../../functions/src/data-model/members';
import { School, initSchool } from '../../functions/src/data-model/schools';
import { IlcEvent, initEvent, EventStatus } from '../../functions/src/data-model/events';
import { Grading, initGrading } from '../../functions/src/data-model/gradings';

describe('computeObjectDiff', () => {
  it('returns empty diff when objects are deeply equal', () => {
    const original: Member = {
      ...initMember(),
      docId: 'mem_1',
      name: 'John Doe',
      phone: '123456789',
    };
    const updated: Member = {
      ...original,
    };

    const diff = computeObjectDiff<Member>(original, updated, {
      ignoreKeys: ['docId', 'lastUpdated'],
    });

    expect(diff.changedKeys).toEqual([]);
    expect(diff.changedOldState).toEqual({});
    expect(diff.changedNewState).toEqual({});
  });

  it('detects primitive and nested field changes', () => {
    const original: Member = {
      ...initMember(),
      docId: 'mem_1',
      name: 'John Doe',
      phone: '123456789',
      roles: ['student'],
    };
    const updated: Member = {
      ...original,
      phone: '987654321',
      roles: ['student', 'instructor'],
    };

    const diff = computeObjectDiff<Member>(original, updated, {
      ignoreKeys: ['docId', 'lastUpdated'],
    });

    expect(diff.changedKeys).toEqual(['phone', 'roles']);
    expect(diff.changedOldState).toEqual({
      phone: '123456789',
      roles: ['student'],
    });
    expect(diff.changedNewState).toEqual({
      phone: '987654321',
      roles: ['student', 'instructor'],
    });
  });

  it('ignores specified keys even when they differ', () => {
    const original: School = {
      ...initSchool(),
      docId: 'school_1',
      schoolId: 'SCH-1',
      schoolName: 'Old School Name',
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const updated: School = {
      ...original,
      docId: 'school_2',
      schoolName: 'New School Name',
      lastUpdated: '2026-09-18T00:00:00.000Z',
    };

    const diff = computeObjectDiff<School>(original, updated, {
      ignoreKeys: ['docId', 'lastUpdated'],
    });

    expect(diff.changedKeys).toEqual(['schoolName']);
    expect(diff.changedOldState).toEqual({ schoolName: 'Old School Name' });
    expect(diff.changedNewState).toEqual({ schoolName: 'New School Name' });
  });

  it('treats all updated fields as new when original is null or undefined', () => {
    const updated: Partial<IlcEvent> = {
      title: 'Workshop',
      status: EventStatus.Listed,
      location: 'Paris, France',
    };

    const diff = computeObjectDiff<IlcEvent>(undefined, updated);

    expect(diff.changedKeys).toEqual(['title', 'status', 'location']);
    expect(diff.changedOldState).toEqual({});
    expect(diff.changedNewState).toEqual({
      title: 'Workshop',
      status: EventStatus.Listed,
      location: 'Paris, France',
    });
  });

  it('works with Partial types on both original and updated', () => {
    const original: Partial<Grading> = {
      notes: 'Initial notes',
      studentName: 'Alice',
    };
    const updated: Partial<Grading> = {
      notes: 'Updated notes',
      studentName: 'Alice',
    };

    const diff = computeObjectDiff<Grading>(original, updated);

    expect(diff.changedKeys).toEqual(['notes']);
    expect(diff.changedOldState).toEqual({ notes: 'Initial notes' });
    expect(diff.changedNewState).toEqual({ notes: 'Updated notes' });
  });
});

describe('formatFieldLabel', () => {
  it('returns human-friendly label for known domain fields', () => {
    expect(formatFieldLabel('notes')).toBe('Notes');
    expect(formatFieldLabel('publicBioMarkdown')).toBe('Public Bio');
    expect(formatFieldLabel('isInstructor')).toBe('Instructor Status');
    expect(formatFieldLabel('schoolName')).toBe('School Name');
    expect(formatFieldLabel('gradingInstructorId')).toBe('Grading Instructor');
    expect(formatFieldLabel('onlineJoiningLink')).toBe('Online Joining Link');
  });

  it('humanizes unknown camelCase and snake_case keys as fallback', () => {
    expect(formatFieldLabel('customPropertyField')).toBe('Custom Property Field');
    expect(formatFieldLabel('custom_snake_case_key')).toBe('Custom Snake Case Key');
  });

  it('supports strongly typed key arguments', () => {
    expect(formatFieldLabel<Member>('phone')).toBe('Phone Number');
    expect(formatFieldLabel<IlcEvent>('location')).toBe('Location');
  });
});

describe('formatFieldSummary', () => {
  it('formats non-empty changed keys as comma-separated string', () => {
    const summary = formatFieldSummary(['phone', 'address'], 'member profile');
    expect(summary).toBe('Updated Phone Number, Address');
  });

  it('returns fallback entity description when no keys changed', () => {
    const summary = formatFieldSummary([], 'profile for Lucas Dixon');
    expect(summary).toBe('Updated profile for Lucas Dixon');
  });
});
