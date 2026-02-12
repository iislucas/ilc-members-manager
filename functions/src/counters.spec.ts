import * as admin from 'firebase-admin';
import { extractCountersFromMember, extractCountersFromSchool, ensureCountersAreAtLeast, ensureSchoolCountersAreAtLeast, calculateNextCounterValue } from './counters';
import { initMember, initSchool } from './data-model';

describe('Counters', () => {
    describe('calculateNextCounterValue', () => {
        it('should return current + 1 if current > lastSeen', () => {
             expect(calculateNextCounterValue(10, 20)).toBe(21);
        });
        it('should return lastSeen + 1 if lastSeen > current', () => {
             expect(calculateNextCounterValue(30, 20)).toBe(31);
        });
        it('should return current + 1 if equal', () => {
             expect(calculateNextCounterValue(20, 20)).toBe(21);
        });
    });

    describe('extractCountersFromMember', () => {
        it('should parse standard US ID', () => {
            const result = extractCountersFromMember({ ...initMember(), memberId: 'US100' });
            expect(result).toEqual({ memberIdCountryCode: 'US', memberIdNumber: 100, instructorIdNumber: undefined });
        });

        it('should parse UK ID (mixed case)', () => {
            const result = extractCountersFromMember({ ...initMember(), memberId: 'uk50' });
            expect(result).toEqual({ memberIdCountryCode: 'UK', memberIdNumber: 50, instructorIdNumber: undefined });
        });

        it('should parse 3-letter country code', () => {
            const result = extractCountersFromMember({ ...initMember(), memberId: 'AUS100' });
            expect(result).toEqual({ memberIdCountryCode: 'AUS', memberIdNumber: 100, instructorIdNumber: undefined });
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

    describe('extractCountersFromSchool', () => {
        it('should parse standard School ID', () => {
            const result = extractCountersFromSchool({ ...initSchool(), schoolId: 'SCH-100' });
            expect(result).toEqual({ schoolIdNumber: 100 });
        });

        it('should ignore invalid School ID', () => {
             const result = extractCountersFromSchool({ ...initSchool(), schoolId: 'INVALID' });
             expect(result).toEqual({ schoolIdNumber: undefined });
        });

        it('should ignore old numeric School ID', () => {
            const result = extractCountersFromSchool({ ...initSchool(), schoolId: '100' });
            expect(result).toEqual({ schoolIdNumber: undefined });
       });
    });

    describe('ensureCountersAreAtLeast', () => {
        let firestoreSpy: jasmine.Spy;
        let docSpy: jasmine.Spy;
        let runTransactionSpy: jasmine.Spy;
        let transactionGetSpy: jasmine.Spy;
        let transactionSetSpy: jasmine.Spy;

        beforeEach(() => {
            const mockDocRef = { path: 'counters/singleton' };
            docSpy = jasmine.createSpy('doc').and.returnValue(mockDocRef);
            
            transactionGetSpy = jasmine.createSpy('transaction.get');
            transactionSetSpy = jasmine.createSpy('transaction.set');

            const mockTransaction = {
                get: transactionGetSpy,
                set: transactionSetSpy
            };

            runTransactionSpy = jasmine.createSpy('runTransaction').and.callFake(async (callback: any) => {
                return callback(mockTransaction);
            });

            const mockFirestore = {
                doc: docSpy,
                runTransaction: runTransactionSpy
            };



            firestoreSpy = spyOnProperty(admin, 'firestore', 'get').and.returnValue((() => mockFirestore) as any);


        });

        it('should update member counter if member ID is higher', async () => {
            const existingCounters = {
                memberIdCounters: { 'US': 90 },
                instructorIdCounter: 100,
                schoolIdCounter: 100
            };
            transactionGetSpy.and.resolveTo({
                exists: true,
                data: () => existingCounters
            });

            const member = { ...initMember(), memberId: 'US100' };
            await ensureCountersAreAtLeast(member);

            expect(runTransactionSpy).toHaveBeenCalled();
            expect(transactionSetSpy).toHaveBeenCalledWith(
                jasmine.any(Object), 
                jasmine.objectContaining({
                    memberIdCounters: { 'US': 101 } // 100 + 1
                })
            );
        });

        it('should update instructor counter if instructor ID is higher', async () => {
            const existingCounters = {
                memberIdCounters: {},
                instructorIdCounter: 90,
                schoolIdCounter: 100
            };
            transactionGetSpy.and.resolveTo({
                exists: true,
                data: () => existingCounters
            });

            const member = { ...initMember(), instructorId: '100' };
            await ensureCountersAreAtLeast(member);

            expect(transactionSetSpy).toHaveBeenCalledWith(
                jasmine.any(Object), 
                jasmine.objectContaining({
                    instructorIdCounter: 101
                })
            );
        });

        it('should do nothing if IDs are missing', async () => {
            const member = { ...initMember() };
            await ensureCountersAreAtLeast(member);
            expect(runTransactionSpy).not.toHaveBeenCalled();
        });
    });

    describe('ensureSchoolCountersAreAtLeast', () => {
        let firestoreSpy: jasmine.Spy;
        let docSpy: jasmine.Spy;
        let runTransactionSpy: jasmine.Spy;
        let transactionGetSpy: jasmine.Spy;
        let transactionSetSpy: jasmine.Spy;

        beforeEach(() => {
            const mockDocRef = { path: 'counters/singleton' };
            docSpy = jasmine.createSpy('doc').and.returnValue(mockDocRef);
            
            transactionGetSpy = jasmine.createSpy('transaction.get');
            transactionSetSpy = jasmine.createSpy('transaction.set');

            const mockTransaction = {
                get: transactionGetSpy,
                set: transactionSetSpy
            };

            runTransactionSpy = jasmine.createSpy('runTransaction').and.callFake(async (callback: any) => {
                return callback(mockTransaction);
            });

            const mockFirestore = {
                doc: docSpy,
                runTransaction: runTransactionSpy
            };



            firestoreSpy = spyOnProperty(admin, 'firestore', 'get').and.returnValue((() => mockFirestore) as any);


        });

        it('should update school counter if school ID is higher', async () => {
            const existingCounters = {
                memberIdCounters: {},
                instructorIdCounter: 100,
                schoolIdCounter: 90
            };
            transactionGetSpy.and.resolveTo({
                exists: true,
                data: () => existingCounters
            });

            const school = { ...initSchool(), schoolId: 'SCH-100' };
            await ensureSchoolCountersAreAtLeast(school);

            expect(runTransactionSpy).toHaveBeenCalled();
            expect(transactionSetSpy).toHaveBeenCalledWith(
                jasmine.any(Object), 
                jasmine.objectContaining({
                    schoolIdCounter: 101 // 100 + 1
                })
            );
        });

        it('should do nothing if school ID is missing', async () => {
            const school = { ...initSchool(), schoolId: '' };
            await ensureSchoolCountersAreAtLeast(school);
            expect(runTransactionSpy).not.toHaveBeenCalled();
        });

        it('should do nothing if school ID format is invalid', async () => {
            const school = { ...initSchool(), schoolId: '100' }; // Old format, ignored by extract
            await ensureSchoolCountersAreAtLeast(school);
            expect(runTransactionSpy).not.toHaveBeenCalled();
        });
    });
});
