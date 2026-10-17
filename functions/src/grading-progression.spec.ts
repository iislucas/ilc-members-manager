import { describe, it, expect } from 'vitest';
import { nextGradingLevel, achievedGradingLevels, instructorCanAssessLevel, previousGradingLevel, normalizeGradingLevel, levelAfter, unachievedEarlierLevels, GradingLevel, StudentLevel, ApplicationLevel, toGradingLevel, toStudentLevel, toApplicationLevel, studentLevelOf, applicationLevelOf, gradingLevelForStudent, gradingLevelForApplication, gradingProgression } from './data-model/curriculum';
import { nextGradingPayment, upcomingGradingPayments, freeRetakeLevel, levelsBlockingResult, levelsIncludingPassedGradings, unpaidGradingsInProgressionOrder, orderDisplayNumber, gradingDisplayId, isGradingPaid, PaymentStatus, GradingStatus } from './data-model/gradings';
import { notificationStyle, NotificationKind } from './data-model/notifications';
import { memberLevelNormalization } from './data-model/members';

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
      expect(achievedGradingLevels('', '').has(GradingLevel.StudentEntry)).toBe(false);
      expect(achievedGradingLevels('1', '').has(GradingLevel.StudentEntry)).toBe(true);
    });

    it('includes everything at or below the current levels', () => {
      const achieved = achievedGradingLevels('5', '2');
      expect(achieved.has(GradingLevel.Student5)).toBe(true);
      expect(achieved.has(GradingLevel.Application2)).toBe(true);
      expect(achieved.has(GradingLevel.Student6)).toBe(false);
      expect(achieved.has(GradingLevel.Application3)).toBe(false);
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

  describe('levelAfter', () => {
    it('returns the next entry in progression', () => {
      expect(levelAfter('Student Entry')).toBe('Student 1');
      expect(levelAfter('Student 1')).toBe('Student 2');
      expect(levelAfter('Student 3')).toBe('Application 1');
      expect(levelAfter('Application 1')).toBe('Student 4');
      expect(levelAfter('Student 6')).toBe('Application 3');
      expect(levelAfter('Application 3')).toBe('Student 7');
    });

    it('returns "" for the last entry or an unknown level', () => {
      expect(levelAfter('Application 6')).toBe('');
      expect(levelAfter('')).toBe('');
      expect(levelAfter('Invalid Level')).toBe('');
    });

    it('normalises legacy bare-number / Entry levels', () => {
      expect(levelAfter('3')).toBe('Application 1');
      expect(levelAfter('Entry')).toBe('Student 1');
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

  describe('level normalisation', () => {
    it('reads every known spelling of a grading level as the enum', () => {
      const cases: Array<[string, GradingLevel | null]> = [
        ['Student Entry', GradingLevel.StudentEntry],
        ['Entry', GradingLevel.StudentEntry],
        ['Entry Level', GradingLevel.StudentEntry],
        ['entry level', GradingLevel.StudentEntry],
        ['Student 0', GradingLevel.StudentEntry],
        ['Student 3', GradingLevel.Student3],
        ['Student Level 3', GradingLevel.Student3],
        ['student level 11', GradingLevel.Student11],
        ['3', GradingLevel.Student3],
        ['Level 3', GradingLevel.Student3],
        ['Application 2', GradingLevel.Application2],
        ['Application Level 2', GradingLevel.Application2],
        ['GRADING : Application Level 6', GradingLevel.Application6],
        ['GRADING : Entry Level', GradingLevel.StudentEntry],
        ['Student 12', null],
        ['Application 7', null],
        ['Meditation & Philosophy', null],
        ['', null],
        // Strict: free text containing a level-like word never matches.
        ['Re-entry workshop', null],
        ['Student 1 year', null],
        ['Grading - Student Level 2', null],
        ['Student Teacher Level 2', null],
        ['Happ 2', null],
        ['Level 2 Membership', null],
      ];
      for (const [raw, expected] of cases) {
        expect(toGradingLevel(raw), raw).toBe(expected);
      }
    });

    it('reads member student levels in any spelling', () => {
      expect(toStudentLevel('2')).toBe(StudentLevel.Level2);
      expect(toStudentLevel('Student 2')).toBe(StudentLevel.Level2);
      expect(toStudentLevel('Student Level 2')).toBe(StudentLevel.Level2);
      expect(toStudentLevel('Level 2')).toBe(StudentLevel.Level2);
      expect(toStudentLevel('Entry')).toBe(StudentLevel.Entry);
      expect(toStudentLevel('Entry Level')).toBe(StudentLevel.Entry);
      expect(toStudentLevel('Application 2')).toBe(StudentLevel.None);
      expect(toStudentLevel('nonsense')).toBe(StudentLevel.None);
      expect(toStudentLevel(undefined)).toBe(StudentLevel.None);
    });

    it('reads member application levels in any spelling, bare numbers as application', () => {
      expect(toApplicationLevel('1')).toBe(ApplicationLevel.Level1);
      expect(toApplicationLevel('Application 1')).toBe(ApplicationLevel.Level1);
      expect(toApplicationLevel('Application Level 1')).toBe(ApplicationLevel.Level1);
      expect(toApplicationLevel('Level 1')).toBe(ApplicationLevel.Level1);
      expect(toApplicationLevel('7')).toBe(ApplicationLevel.None);
      expect(toApplicationLevel('Student 2')).toBe(ApplicationLevel.None);
      expect(toApplicationLevel('')).toBe(ApplicationLevel.None);
    });

    it('converts between grading levels and track positions both ways', () => {
      for (const level of gradingProgression) {
        const s = studentLevelOf(level);
        const a = applicationLevelOf(level);
        // Exactly one track.
        expect(s === StudentLevel.None).not.toBe(a === ApplicationLevel.None);
        const back = s !== StudentLevel.None ? gradingLevelForStudent(s) : gradingLevelForApplication(a);
        expect(back).toBe(level);
      }
      expect(gradingLevelForStudent(StudentLevel.None)).toBe(null);
      expect(gradingLevelForApplication(ApplicationLevel.None)).toBe(null);
    });

    it('treats a prefixed level as the same level when working out what is next', () => {
      // Regression: 'Student 2' used to read as "nothing achieved", so a Student 3
      // grading was flagged out of order (and its result blocked).
      expect(nextGradingLevel('Student 2', '')).toBe('Student 3');
      expect(nextGradingLevel('Student Level 3', 'Application 1')).toBe('Student 4');
      expect(unachievedEarlierLevels('Student 3', 'Student 2', '')).toEqual([]);
    });
  });

  describe('levelsBlockingResult', () => {
    const g = (level: string, status: GradingStatus, paymentStatus = PaymentStatus.PaidByStripe) => ({
      level,
      status,
      paymentStatus,
    });

    it('blocks a grading booked ahead until the earlier level is passed', () => {
      expect(levelsBlockingResult('Student 3', '1', '', [])).toEqual(['Student 2']);
    });

    it('counts an earlier grading passed and paid, before the member record catches up', () => {
      // Race: Student 2 was just passed; its trigger hasn't updated the member yet.
      expect(
        levelsBlockingResult('Student 3', '1', '', [g('Student 2', GradingStatus.Passed)]),
      ).toEqual([]);
    });

    it('does not count an earlier grading that is passed but unpaid, or not yet graded', () => {
      expect(
        levelsBlockingResult('Student 3', '1', '', [
          g('Student 2', GradingStatus.Passed, PaymentStatus.NotYetPaid),
        ]),
      ).toEqual(['Student 2']);
      expect(
        levelsBlockingResult('Student 3', '1', '', [g('Student 2', GradingStatus.AwaitingGrading)]),
      ).toEqual(['Student 2']);
    });

    it('lets an out-of-sync member grade their next level in the normal progression', () => {
      // Student 5 with no application levels: Application 1 is next and allowed;
      // Student 6 waits until Application 1 and 2 are passed.
      expect(levelsBlockingResult('Application 1', '5', '', [])).toEqual([]);
      expect(levelsBlockingResult('Student 6', '5', '', [])).toEqual([
        'Application 1',
        'Application 2',
      ]);
      expect(
        levelsBlockingResult('Application 2', '5', '', [g('Application 1', GradingStatus.Passed)]),
      ).toEqual([]);
    });
  });

  describe('levelsIncludingPassedGradings', () => {
    it('raises each track by passed and paid gradings only', () => {
      expect(
        levelsIncludingPassedGradings('1', '', [
          { level: 'Student 2', status: GradingStatus.Passed, paymentStatus: PaymentStatus.PaidByStripe },
          { level: 'Student 3', status: GradingStatus.Passed, paymentStatus: PaymentStatus.NotYetPaid },
          { level: 'Application 1', status: GradingStatus.AwaitingGrading },
        ]),
      ).toEqual({ studentLevel: '2', applicationLevel: '' });
    });

    it('never lowers a level and normalises legacy spellings', () => {
      expect(
        levelsIncludingPassedGradings('Student 5', 'Application 2', [
          { level: 'Student 2', status: GradingStatus.Passed, paymentStatus: PaymentStatus.PaidByStripe },
        ]),
      ).toEqual({ studentLevel: '5', applicationLevel: '2' });
    });
  });

  describe('freeRetakeLevel', () => {
    it('is the earliest unachieved level with a paid failed attempt and no open grading', () => {
      const failed = { level: 'Student 2', status: GradingStatus.NotPassed, paymentStatus: PaymentStatus.PaidByStripe };
      expect(freeRetakeLevel('1', '', [failed])).toBe('Student 2');
    });

    it('is empty when the failed attempt is unpaid, or a retake is already open', () => {
      expect(
        freeRetakeLevel('1', '', [
          { level: 'Student 2', status: GradingStatus.NotPassed, paymentStatus: PaymentStatus.NotYetPaid },
        ]),
      ).toBe('');
      expect(
        freeRetakeLevel('1', '', [
          { level: 'Student 2', status: GradingStatus.NotPassed, paymentStatus: PaymentStatus.PaidByStripe },
          { level: 'Student 2', status: GradingStatus.AwaitingRequest, paymentStatus: PaymentStatus.PaidOther },
        ]),
      ).toBe('');
    });
  });

  describe('unachievedEarlierLevels', () => {
    it('lists the earlier levels still to be achieved, in order', () => {
      expect(unachievedEarlierLevels('Student 3', '1', '')).toEqual(['Student 2']);
      expect(unachievedEarlierLevels('Student 4', '2', '')).toEqual([
        'Student 3',
        'Application 1',
      ]);
    });

    it('is empty when the grading is the next level', () => {
      expect(unachievedEarlierLevels('Student 2', '1', '')).toEqual([]);
      expect(unachievedEarlierLevels('Student 4', '3', '1')).toEqual([]);
    });

    it('is empty for the first level or an unknown level', () => {
      expect(unachievedEarlierLevels('Student Entry', '', '')).toEqual([]);
      expect(unachievedEarlierLevels('Bogus 9', '', '')).toEqual([]);
    });

    it('normalises legacy bare-number levels', () => {
      expect(unachievedEarlierLevels('3', '1', '')).toEqual(['Student 2']);
    });
  });

  describe('upcomingGradingPayments', () => {
    const unpaid = (level: string, status = GradingStatus.AwaitingRequest) => ({
      level,
      status,
      paymentStatus: PaymentStatus.NotYetPaid,
    });
    const paid = (level: string, status = GradingStatus.AwaitingRequest) => ({
      level,
      status,
      paymentStatus: PaymentStatus.PaidByStripe,
    });

    it('lists every remaining level in progression order', () => {
      const levels = upcomingGradingPayments('9', '4', []).map((p) => p.level);
      expect(levels).toEqual(['Student 10', 'Application 5', 'Student 11', 'Application 6']);
    });

    it('starts with nextGradingPayment', () => {
      const gradings = [paid('Application 1'), unpaid('Student 5')];
      expect(upcomingGradingPayments('3', '', gradings)[0]).toEqual(
        nextGradingPayment('3', '', gradings),
      );
    });

    it('settles unpaid gradings in place and skips levels already bought', () => {
      const s5 = unpaid('Student 5');
      const result = upcomingGradingPayments('3', '', [paid('Application 1'), s5]);
      expect(result.slice(0, 3).map((p) => p.level)).toEqual([
        'Student 4',
        'Application 2',
        'Student 5',
      ]);
      expect(result[0].grading).toBe(null);
      expect(result[2].grading).toBe(s5);
      // Student 5 appears once only, then the walk continues.
      expect(result.filter((p) => p.level === 'Student 5').length).toBe(1);
      expect(result[3].level).toBe('Student 6');
    });

    it('skips the free-retake level', () => {
      const levels = upcomingGradingPayments('3', '', [], 'Application 1').map((p) => p.level);
      expect(levels[0]).toBe('Student 4');
      expect(levels).not.toContain('Application 1');
    });

    it('is empty once the progression is complete', () => {
      expect(upcomingGradingPayments('11', '6', [])).toEqual([]);
    });
  });

  describe('nextGradingPayment', () => {
    const unpaid = (level: string, status = GradingStatus.AwaitingRequest) => ({
      level,
      status,
      paymentStatus: PaymentStatus.NotYetPaid,
    });
    const paid = (level: string, status = GradingStatus.AwaitingRequest) => ({
      level,
      status,
      paymentStatus: PaymentStatus.PaidByStripe,
    });

    it('offers the next level in the progression when nothing is owed', () => {
      // Student 3 achieved, no application levels: Application 1 comes next.
      expect(nextGradingPayment('3', '', [])).toEqual({
        level: 'Application 1',
        grading: null,
      });
    });

    it('settles an unpaid grading rather than moving past it', () => {
      const g = unpaid('Application 1');
      const result = nextGradingPayment('3', '', [g]);
      expect(result.level).toBe('Application 1');
      expect(result.grading).toBe(g);
    });

    it('takes the earliest unpaid level when several are owed', () => {
      const app1 = unpaid('Application 1');
      const result = nextGradingPayment('3', '', [unpaid('Student 4'), app1]);
      expect(result.level).toBe('Application 1');
      expect(result.grading).toBe(app1);
    });

    it('settles a grading that was conducted but never paid for', () => {
      const passedUnpaid = unpaid('Application 1', GradingStatus.Passed);
      const result = nextGradingPayment('3', '', [passedUnpaid]);
      expect(result.level).toBe('Application 1');
      expect(result.grading).toBe(passedUnpaid);
    });

    it('steps over a paid, still-open grading so a level can be bought ahead', () => {
      expect(nextGradingPayment('3', '', [paid('Application 1')])).toEqual({
        level: 'Student 4',
        grading: null,
      });
    });

    it('does not step over an out-of-order unpaid grading at a later level', () => {
      // Student 2 achieved and an unpaid Application 1 exists (only reachable by
      // an admin edit or import). Student 3 is still owed first.
      const result = nextGradingPayment('2', '', [unpaid('Application 1')]);
      expect(result.level).toBe('Student 3');
      expect(result.grading).toBe(null);
    });

    it('skips the level the caller is handling as a free retake', () => {
      const result = nextGradingPayment('3', '', [], 'Application 1');
      expect(result.level).toBe('Student 4');
    });

    it('ignores NotPassed attempts, which the free-retake flow governs', () => {
      const result = nextGradingPayment('3', '', [
        unpaid('Application 1', GradingStatus.NotPassed),
      ]);
      expect(result.grading).toBe(null);
      expect(result.level).toBe('Application 1');
    });

    it('treats a missing paymentStatus as paid', () => {
      const result = nextGradingPayment('3', '', [
        { level: 'Application 1', status: GradingStatus.AwaitingRequest },
      ]);
      expect(result.grading).toBe(null);
      expect(result.level).toBe('Student 4');
    });

    it('returns an empty level once the whole progression is achieved', () => {
      expect(nextGradingPayment('11', '6', [])).toEqual({ level: '', grading: null });
    });

    it('sorts unknown levels last rather than dropping them', () => {
      const gradings = [unpaid('Bogus 9'), unpaid('Student 2')];
      expect(unpaidGradingsInProgressionOrder(gradings).map((g) => g.level)).toEqual([
        'Student 2',
        'Bogus 9',
      ]);
    });
  });

  describe('orderDisplayNumber', () => {
    it('is the order date plus four digits from the reference', () => {
      expect(orderDisplayNumber('2026-08-13T05:35:27Z', 'cs_live_a1b2')).toMatch(
        /^20260813-\d{4}$/,
      );
    });

    it('is stable for the same reference and differs between references', () => {
      const a = orderDisplayNumber('2026-08-13', 'cs_live_a1b2');
      expect(orderDisplayNumber('2026-08-13', 'cs_live_a1b2')).toBe(a);
      expect(orderDisplayNumber('2026-08-13', 'cs_live_a1b3')).not.toBe(a);
    });

    it('takes the date from the order, not today, and keeps the day', () => {
      expect(orderDisplayNumber('2024-01-31T23:59:59Z', 'ref').slice(0, 8)).toBe(
        '20240131',
      );
      expect(orderDisplayNumber('2026-12-01', 'ref').slice(0, 8)).toBe('20261201');
      // Two orders one day apart differ even with the same reference.
      expect(orderDisplayNumber('2026-12-01', 'ref')).not.toBe(
        orderDisplayNumber('2026-12-02', 'ref'),
      );
    });

    it('accepts a plain YYYY-MM-DD date as well as a full timestamp', () => {
      expect(orderDisplayNumber('2026-08-13', 'ref')).toBe(
        orderDisplayNumber('2026-08-13T05:35:27Z', 'ref'),
      );
    });

    it('returns "" when there is no source reference (e.g. a manual grading)', () => {
      expect(orderDisplayNumber('2026-08-13', '')).toBe('');
      expect(orderDisplayNumber('2026-08-13', '   ')).toBe('');
    });

    it('falls back to a zeroed date when the date is unusable', () => {
      expect(orderDisplayNumber('', 'ref')).toMatch(/^00000000-\d{4}$/);
      expect(orderDisplayNumber('not a date', 'ref')).toMatch(/^00000000-\d{4}$/);
      // A year and month with no day is not enough for a dated reference.
      expect(orderDisplayNumber('2026-08', 'ref')).toMatch(/^00000000-\d{4}$/);
    });

    it('spreads references over the four digits without collapsing', () => {
      const numbers = new Set(
        Array.from({ length: 500 }, (_, i) =>
          orderDisplayNumber('2026-08-13', `cs_live_${i}`),
        ),
      );
      // Some collisions are expected in 10k slots; a broken hash would give one.
      expect(numbers.size).toBeGreaterThan(450);
    });
  });

  describe('gradingDisplayId', () => {
    it('is the grading event year and month plus the last four characters of the docId', () => {
      expect(
        gradingDisplayId({ docId: 'k3Bq7ZmA5b1', gradingEventDate: '2026-08-13' }),
      ).toBe('202608-A5b1');
    });

    it('works without an order, so a cash-paid grading still has a reference', () => {
      expect(
        gradingDisplayId({ docId: 'manualGradingXyz9', gradingEventDate: '2026-02-01' }),
      ).toBe('202602-Xyz9');
    });

    it('tracks the grading event date when it is changed', () => {
      expect(
        gradingDisplayId({ docId: 'abcdWXYZ', gradingEventDate: '2027-01-20' }),
      ).toBe('202701-WXYZ');
    });

    it('keeps the docId characters exactly, so the grading can be found from it', () => {
      const docId = 'SomeDocIdWith-Mix3';
      expect(gradingDisplayId({ docId, gradingEventDate: '2026-08-13' })).toBe(
        `202608-${docId.slice(-4)}`,
      );
    });

    it('returns "" until the grading event date is set', () => {
      expect(gradingDisplayId({ docId: 'abcdWXYZ' })).toBe('');
      expect(gradingDisplayId({ docId: 'abcdWXYZ', gradingEventDate: '' })).toBe('');
      expect(
        gradingDisplayId({ docId: 'abcdWXYZ', gradingEventDate: 'not a date' }),
      ).toBe('');
    });

    it('returns "" without a docId', () => {
      expect(gradingDisplayId({ docId: '', gradingEventDate: '2026-08-13' })).toBe('');
    });
  });

  describe('notificationStyle', () => {
    it('marks TODO-bearing kinds as action', () => {
      expect(notificationStyle(NotificationKind.GradingUnpaid)).toBe('action');
      expect(notificationStyle(NotificationKind.GradingRequestsYouAsInstructor)).toBe('action');
      expect(notificationStyle(NotificationKind.GradingPurchased)).toBe('action');
      expect(notificationStyle(NotificationKind.OrderNeedsAttention)).toBe('action');
    });

    it('marks informational kinds as info', () => {
      expect(notificationStyle(NotificationKind.GradingPassed)).toBe('info');
      expect(notificationStyle(NotificationKind.GradingNotPassed)).toBe('info');
      expect(notificationStyle(NotificationKind.BlogPost)).toBe('info');
      expect(notificationStyle(NotificationKind.PurchaseFulfilled)).toBe('info');
      expect(notificationStyle(NotificationKind.ManualOrderFulfilled)).toBe('info');
    });
  });

  describe('isGradingPaid', () => {
    it('treats anything but not-yet-paid (and undefined) as paid', () => {
      expect(isGradingPaid({ paymentStatus: PaymentStatus.NotYetPaid })).toBe(false);
      expect(isGradingPaid({ paymentStatus: PaymentStatus.PaidBySquarespace })).toBe(true);
      expect(isGradingPaid({ paymentStatus: PaymentStatus.PaidByCash })).toBe(true);
      expect(isGradingPaid({ paymentStatus: PaymentStatus.PaidOther })).toBe(true);
      expect(isGradingPaid({})).toBe(true);
    });
  });
});

describe('memberLevelNormalization', () => {
  it('patches recognised legacy spellings to the canonical value', () => {
    expect(
      memberLevelNormalization({ studentLevel: 'Student Level 2' as never, applicationLevel: 'Application 1' as never }),
    ).toEqual({ patch: { studentLevel: '2', applicationLevel: '1' }, unrecognised: [] });
  });

  it('leaves canonical and empty values alone', () => {
    expect(
      memberLevelNormalization({ studentLevel: '2' as never, applicationLevel: '' as never }),
    ).toEqual({ patch: {}, unrecognised: [] });
  });

  it('reports unrecognised values without changing them', () => {
    expect(
      memberLevelNormalization({ studentLevel: 'Certified Instructor' as never, applicationLevel: 'Level 9' as never }),
    ).toEqual({
      patch: {},
      unrecognised: [
        { field: 'studentLevel', value: 'Certified Instructor' },
        { field: 'applicationLevel', value: 'Level 9' },
      ],
    });
  });
});
