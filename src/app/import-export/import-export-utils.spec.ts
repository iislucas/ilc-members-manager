import { parseDate } from './import-export-utils';

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
});
