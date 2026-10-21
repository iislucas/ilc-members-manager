import { parseDate, ensureHigherStudentLevel, ensureHigherApplicationLevel } from './import-export-utils';
import { StudentLevel, ApplicationLevel } from '../../../functions/src/data-model/curriculum';

describe('parseDate', () => {
    it('should parse YYYY-MM-DD', () => {
        expect(parseDate('2023-12-31')).toEqual({ success: true, value: '2023-12-31' });
    });

    it('should parse dd/MM/yyyy', () => {
        expect(parseDate('31/12/2023')).toEqual({ success: true, value: '2023-12-31' });
    });

    it('should parse dd-MMM-yyyy', () => {
        expect(parseDate('23-Feb-1953')).toEqual({ success: true, value: '1953-02-23' });
    });

    it('should parse single digit day/month d/M/yyyy', () => {
        expect(parseDate('1/2/2023')).toEqual({ success: true, value: '2023-02-01' });
    });

    // New requirement tests
    it('should parse dd-MMM-yy and assume 20yy', () => {
        expect(parseDate('23-Feb-23')).toEqual({ success: true, value: '2023-02-23' });
        expect(parseDate('01-Jan-99')).toEqual({ success: true, value: '2099-01-01' });
        // If standard behavior, 99 might be 1999. We want 2099.
    });

    it('should parse d-MMM-yy and assume 20yy', () => {
        expect(parseDate('1-Feb-23')).toEqual({ success: true, value: '2023-02-01' });
    });

    it('should parse dd-MMMM-yyyy (full month name)', () => {
        expect(parseDate('21-April-1973')).toEqual({ success: true, value: '1973-04-21' });
    });

    it('should parse MMMM dd, yyyy', () => {
        expect(parseDate('April 21, 1973')).toEqual({ success: true, value: '1973-04-21' });
    });

    it('should parse dd MMMM yyyy', () => {
        expect(parseDate('21 April 1973')).toEqual({ success: true, value: '1973-04-21' });
    });

    it('should parse dd-Sept-yyyy (handling Sept as Sep)', () => {
        expect(parseDate('04-Sept-1998')).toEqual({ success: true, value: '1998-09-04' });
    });
});

describe('ensureHigherStudentLevel / ensureHigherApplicationLevel', () => {
    it('keeps the higher level and returns it in canonical form, whatever the spelling', () => {
        expect(ensureHigherStudentLevel('Student 2', '3')).toBe(StudentLevel.Level3);
        expect(ensureHigherStudentLevel('Student Level 5', '3')).toBe(StudentLevel.Level5);
        expect(ensureHigherStudentLevel('', 'Entry Level')).toBe(StudentLevel.Entry);
        expect(ensureHigherStudentLevel('Entry', '1')).toBe(StudentLevel.Level1);
        expect(ensureHigherStudentLevel('', '')).toBeUndefined();
        expect(ensureHigherApplicationLevel('Application 1', '2')).toBe(ApplicationLevel.Level2);
        expect(ensureHigherApplicationLevel('Application Level 3', '2')).toBe(ApplicationLevel.Level3);
        expect(ensureHigherApplicationLevel(undefined, '')).toBeUndefined();
    });
});
