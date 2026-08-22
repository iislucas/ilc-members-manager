import { describe, it, expect } from 'vitest';
import {
  nextGradingLevel,
  achievedGradingLevels,
  instructorCanAssessLevel,
  previousGradingLevel,
  normalizeGradingLevel,
  levelAfter,
  nextGradingPayment,
  unpaidGradingsInProgressionOrder,
  notificationStyle,
  isGradingPaid,
  NotificationKind,
  PaymentStatus,
  GradingStatus,
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
