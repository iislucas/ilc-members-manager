import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { vi } from 'vitest';
import {
  GradingLevelsComponent,
  LevelRowState,
  buildGradingLevelRows,
} from './grading-levels';
import {
  ApplicationLevel,
  GradingLevel,
  StudentLevel,
  gradingProgression,
} from '../../../functions/src/data-model/curriculum';
import {
  Grading,
  GradingStatus,
  PaymentStatus,
  initGrading,
} from '../../../functions/src/data-model/gradings';
import { Member, MembershipType, initMember } from '../../../functions/src/data-model/members';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';

function grading(overrides: Partial<Grading>): Grading {
  return {
    ...initGrading(),
    paymentStatus: PaymentStatus.PaidByStripe,
    ...overrides,
  };
}

function rowFor(rows: ReturnType<typeof buildGradingLevelRows>, level: GradingLevel) {
  const row = rows.rows.find((r) => r.level === level);
  if (!row) throw new Error(`No row for ${level}`);
  return row;
}

describe('buildGradingLevelRows', () => {
  it('lists every level of the progression, in order', () => {
    const result = buildGradingLevelRows('', '', []);
    expect(result.rows.map((r) => r.level)).toEqual([...gradingProgression]);
    expect(result.leadingAchievedCount).toBe(0);
  });

  it('marks the first level as next and payable for a new member', () => {
    const result = buildGradingLevelRows('', '', []);
    const first = rowFor(result, GradingLevel.StudentEntry);
    expect(first.state).toBe(LevelRowState.NotStarted);
    expect(first.isNext).toBe(true);
    expect(first.isNextPayment).toBe(true);
    expect(rowFor(result, GradingLevel.Student1).isNext).toBe(false);
  });

  it('counts the leading run of achieved levels from the member record', () => {
    const result = buildGradingLevelRows(StudentLevel.Level3, ApplicationLevel.None, []);
    // Student Entry, 1, 2, 3 are achieved; Application 1 is next.
    expect(result.leadingAchievedCount).toBe(4);
    expect(rowFor(result, GradingLevel.Student3).state).toBe(LevelRowState.Achieved);
    expect(rowFor(result, GradingLevel.Application1).isNext).toBe(true);
  });

  it('treats a passed & paid grading as achieved even before the record updates', () => {
    const passed = grading({ docId: 'p', level: GradingLevel.StudentEntry, status: GradingStatus.Passed });
    const result = buildGradingLevelRows('', '', [passed]);
    expect(rowFor(result, GradingLevel.StudentEntry).state).toBe(LevelRowState.Achieved);
    expect(rowFor(result, GradingLevel.StudentEntry).mainGrading).toBe(passed);
    expect(rowFor(result, GradingLevel.Student1).isNext).toBe(true);
  });

  it('shows a paid open grading as purchased and moves the payment on', () => {
    const open = grading({ docId: 'o', level: GradingLevel.StudentEntry, status: GradingStatus.AwaitingGrading });
    const result = buildGradingLevelRows('', '', [open]);
    const entry = rowFor(result, GradingLevel.StudentEntry);
    expect(entry.state).toBe(LevelRowState.Purchased);
    expect(entry.isNext).toBe(true);
    expect(entry.isNextPayment).toBe(false);
    expect(rowFor(result, GradingLevel.Student1).isNextPayment).toBe(true);
  });

  it('shows an unpaid open grading as requested, still owing payment', () => {
    const requested = grading({
      docId: 'r',
      level: GradingLevel.StudentEntry,
      status: GradingStatus.AwaitingAcceptance,
      paymentStatus: PaymentStatus.NotYetPaid,
    });
    const result = buildGradingLevelRows('', '', [requested]);
    const entry = rowFor(result, GradingLevel.StudentEntry);
    expect(entry.state).toBe(LevelRowState.Requested);
    expect(entry.isNextPayment).toBe(true);
  });

  it('shows a passed but unpaid grading as passed with the fee owed', () => {
    const passedUnpaid = grading({
      docId: 'pu',
      level: GradingLevel.StudentEntry,
      status: GradingStatus.Passed,
      paymentStatus: PaymentStatus.NotYetPaid,
    });
    const result = buildGradingLevelRows('', '', [passedUnpaid]);
    expect(rowFor(result, GradingLevel.StudentEntry).state).toBe(LevelRowState.PassedUnpaid);
  });

  it('groups several attempts at one level: the open one is main, the rest fold away', () => {
    const failedOld = grading({
      docId: 'f1', level: GradingLevel.Student1, status: GradingStatus.NotPassed, gradingEventDate: '2025-01-01',
    });
    const failedNewer = grading({
      docId: 'f2', level: GradingLevel.Student1, status: GradingStatus.NotPassed, gradingEventDate: '2025-06-01',
    });
    const retake = grading({
      docId: 'r', level: GradingLevel.Student1, status: GradingStatus.AwaitingRequest, gradingPurchaseDate: '2025-07-01',
    });
    const result = buildGradingLevelRows(StudentLevel.Entry, ApplicationLevel.None, [failedOld, retake, failedNewer]);
    const row = rowFor(result, GradingLevel.Student1);
    expect(row.state).toBe(LevelRowState.Purchased);
    expect(row.mainGrading).toBe(retake);
    expect(row.otherGradings).toEqual([failedNewer, failedOld]);
  });

  it('flags a free retake after a paid attempt was not passed', () => {
    const failed = grading({ docId: 'f', level: GradingLevel.Student1, status: GradingStatus.NotPassed });
    const result = buildGradingLevelRows(StudentLevel.Entry, ApplicationLevel.None, [failed]);
    const row = rowFor(result, GradingLevel.Student1);
    expect(row.state).toBe(LevelRowState.NotPassed);
    expect(row.isFreeRetake).toBe(true);
    expect(row.isNext).toBe(true);
    // The retake is free, so the purchase page offers the following level.
    expect(row.isNextPayment).toBe(false);
    expect(rowFor(result, GradingLevel.Student2).isNextPayment).toBe(true);
  });

  it('collects gradings outside the syllabus separately', () => {
    const other = grading({ docId: 'x', level: 'Meditation & Philosophy' });
    const result = buildGradingLevelRows('', '', [other]);
    expect(result.nonSyllabusGradings).toEqual([other]);
    expect(result.rows.every((r) => r.mainGrading === null)).toBe(true);
  });
});

describe('GradingLevelsComponent', () => {
  let fixture: ComponentFixture<GradingLevelsComponent>;
  let componentRef: ComponentRef<GradingLevelsComponent>;

  const activeMember = (overrides: Partial<Member> = {}): Member => ({
    ...initMember(),
    membershipType: MembershipType.Life,
    ...overrides,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GradingLevelsComponent],
      providers: [
        {
          provide: DataManagerService,
          useValue: {
            memberDisplayName: () => '',
            instructorDisplayName: () => '',
          },
        },
        {
          provide: RoutingService,
          useValue: { hrefForView: vi.fn().mockReturnValue('/link') },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GradingLevelsComponent);
    componentRef = fixture.componentRef;
  });

  async function render(member: Member, gradings: Grading[]): Promise<HTMLElement> {
    componentRef.setInput('member', member);
    componentRef.setInput('gradings', gradings);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('folds achieved levels into a summary row that can be unfolded', async () => {
    const el = await render(activeMember({ studentLevel: StudentLevel.Level2 }), []);
    const summary = el.querySelector('.levels-summary');
    expect(summary?.textContent).toContain('Current level: Student 2');
    expect(summary?.textContent).toContain('3 levels achieved');
    const levelNames = () => Array.from(el.querySelectorAll('.level-row .level-name'))
      .map((n) => n.textContent?.trim());
    expect(levelNames()[0]).toBe(GradingLevel.Student3);

    (summary?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(levelNames()[0]).toBe(GradingLevel.StudentEntry);
  });

  it('highlights the next level and offers to purchase it', async () => {
    const el = await render(activeMember(), []);
    const next = el.querySelector('.level-row.next-level');
    expect(next?.querySelector('.level-name')?.textContent?.trim()).toBe(GradingLevel.StudentEntry);
    expect(next?.querySelector('a.primary-button')?.textContent).toContain('Purchase');
  });

  it('asks for membership instead of purchase when membership is not active', async () => {
    const el = await render({ ...initMember(), membershipType: MembershipType.Annual }, []);
    const next = el.querySelector('.level-row.next-level');
    expect(next?.querySelector('a.primary-button')).toBeNull();
    expect(next?.textContent).toContain('Membership required');
  });

  it('unfolds other gradings for a level', async () => {
    const gradings = [
      grading({ docId: 'a', level: GradingLevel.StudentEntry, status: GradingStatus.NotPassed, gradingEventDate: '2025-01-01' }),
      grading({ docId: 'b', level: GradingLevel.StudentEntry, status: GradingStatus.AwaitingGrading, gradingEventDate: '2025-06-01' }),
    ];
    const el = await render(activeMember(), gradings);
    const row = el.querySelector('.level-row.next-level') as HTMLElement;
    expect(row.querySelectorAll('a.attempt-link').length).toBe(1);

    const toggle = row.querySelector('.attempts-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Show 1 other grading');
    toggle.click();
    fixture.detectChanges();
    expect(row.querySelectorAll('a.attempt-link').length).toBe(2);
  });
});
