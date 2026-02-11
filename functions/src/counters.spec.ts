import { extractCountersFromMember, calculateNextCounterValue } from './counters';
import { initMember } from './data-model';

describe('Counters', () => {
    describe('extractCountersFromMember', () => {
        it('should parse standard US ID', () => {
            const result = extractCountersFromMember({ ...initMember(), memberId: 'US100' });
            expect(result).toEqual({ memberIdCountryCode: 'US', memberIdNumber: 100, instructorIdNumber: undefined });
        });

        it('should parse UK ID (mixed case)', () => {
            const result = extractCountersFromMember({ ...initMember(), memberId: 'uk50' });
            expect(result).toEqual({ memberIdCountryCode: 'UK', memberIdNumber: 50, instructorIdNumber: undefined });
        });

        it('should parse Instructor ID', () => {
            const result = extractCountersFromMember({ ...initMember(), instructorId: '200' });
            expect(result).toEqual({ memberIdCountryCode: undefined, memberIdNumber: undefined, instructorIdNumber: 200 });
        });

        it('should parse Both', () => {
            const result = extractCountersFromMember({ ...initMember(), memberId: 'DE99', instructorId: '300' });
            expect(result).toEqual({ memberIdCountryCode: 'DE', memberIdNumber: 99, instructorIdNumber: 300 });
        });

        it('should ignore invalid Member ID', () => {
            const result = extractCountersFromMember({ ...initMember(), memberId: 'INVALID' });
            expect(result).toEqual({ memberIdCountryCode: undefined, memberIdNumber: undefined, instructorIdNumber: undefined });
        });

        it('should ignore invalid Instructor ID', () => {
            const result = extractCountersFromMember({ ...initMember(), instructorId: 'ABC' });
            expect(result).toEqual({ memberIdCountryCode: undefined, memberIdNumber: undefined, instructorIdNumber: undefined });
        });

        it('should handle empty', () => {
            const result = extractCountersFromMember(initMember());
            expect(result).toEqual({ memberIdCountryCode: undefined, memberIdNumber: undefined, instructorIdNumber: undefined });
        });
    });

    describe('calculateNextCounterValue', () => {
        const MIN = 100;
        
        it('should handle lastSeen < currentCounter < MIN', () => {
            expect(calculateNextCounterValue(50, 80, MIN)).toBe(100);
        });

        it('should handle currentCounter < lastSeen < MIN', () => {
            expect(calculateNextCounterValue(90, 80, MIN)).toBe(100);
        });

        it('should handle lastSeen+1 > currentCounter (both > MIN)', () => {
            expect(calculateNextCounterValue(150, 120, MIN)).toBe(151);
        });

        it('should handle lastSeen+1 < currentCounter (both > MIN)', () => {
            expect(calculateNextCounterValue(110, 150, MIN)).toBe(150);
        });

        it('should handle lastSeen exactly at currentCounter', () => {
            expect(calculateNextCounterValue(150, 150, MIN)).toBe(151);
        });
    });
});
