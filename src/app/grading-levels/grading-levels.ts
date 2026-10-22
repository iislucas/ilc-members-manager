/* grading-levels.ts
 *
 * A member's gradings laid out level by level along the grading progression
 * (Student Entry → … → Application 6), so it is clear at a glance which levels
 * they hold, which gradings they have purchased or requested, which they
 * passed, and which level they need to grade next.
 *
 * Each level is one row. The main grading for the level (the open one, else the
 * passed one, else the most recent) is shown under the level and links to the
 * grading's page; any other attempts at the same level are in an unfoldable
 * area under it. The leading run of achieved levels is folded into one summary
 * row. Gradings for something outside the syllabus are listed at the end.
 *
 * Usage:
 *   <app-grading-levels [member]="member" [gradings]="gradings" />
 *
 * The row model is built by the pure `buildGradingLevelRows`, which is where
 * the per-level rules live (and what the spec tests).
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import {
  GradingLevel,
  achievedGradingLevels,
  applicationLevelLabel,
  gradingProgression,
  nextGradingLevel,
  studentLevelLabel,
  toGradingLevel,
} from '../../../functions/src/data-model/curriculum';
import {
  Grading,
  GradingStatus,
  freeRetakeLevel,
  isGradingPaid,
  levelsIncludingPassedGradings,
  nextGradingPayment,
} from '../../../functions/src/data-model/gradings';
import { Member, hasActiveMembership } from '../../../functions/src/data-model/members';
import { AppPathPatterns, Views } from '../app.config';
import { GradingRowHeaderComponent } from '../grading-row-header/grading-row-header';
import { IconComponent } from '../icons/icon.component';
import { RoutingService } from '../routing.service';

// Where a member stands on one level of the progression.
export enum LevelRowState {
  // The member holds this level (on their record, or by a passed & paid grading).
  Achieved = 'achieved',
  // Passed, but the grading fee is still owed, so the level isn't awarded yet.
  PassedUnpaid = 'passed-unpaid',
  // A paid grading for this level is in progress.
  Purchased = 'purchased',
  // An unpaid grading for this level is in progress (requested, fee owed).
  Requested = 'requested',
  // The last attempt was not passed and nothing is open for the level.
  NotPassed = 'not-passed',
  // No grading for this level yet.
  NotStarted = 'not-started',
}

// One level of the progression, with the member's gradings for it.
export type GradingLevelRow = {
  level: GradingLevel;
  state: LevelRowState;
  // The first level of the progression the member does not yet hold.
  isNext: boolean;
  // The level the purchase page offers first (buy it, or pay a requested one).
  isNextPayment: boolean;
  // The member may retake this level for free (a paid attempt was not passed).
  isFreeRetake: boolean;
  // The grading shown for the level: the open one, else the passed one, else
  // the most recent. null when there are no gradings for the level.
  mainGrading: Grading | null;
  // The other gradings for the level, most recent first.
  otherGradings: Grading[];
};

// Everything the levels view shows.
export type GradingLevelRows = {
  rows: GradingLevelRow[];
  // How many rows at the start of `rows` are achieved; these are folded into a
  // single summary row.
  leadingAchievedCount: number;
  // Gradings whose level is not in the syllabus, most recent first.
  nonSyllabusGradings: Grading[];
};

// The date used to order gradings: when it takes place, else when it was bought.
function gradingSortDate(g: Grading): string {
  return g.gradingEventDate || g.gradingPurchaseDate || g.lastUpdated || '';
}

function mostRecentFirst(gradings: Grading[]): Grading[] {
  return [...gradings].sort((a, b) => gradingSortDate(b).localeCompare(gradingSortDate(a)));
}

function isOpen(g: Grading): boolean {
  return g.status !== GradingStatus.Passed && g.status !== GradingStatus.NotPassed;
}

// Builds one row per level of `gradingProgression` from the member's levels and
// their gradings. A level counts as achieved when the member record says so or
// a passed & paid grading awards it (the record is updated by a trigger, so it
// can lag a moment behind).
export function buildGradingLevelRows(
  studentLevel: string,
  applicationLevel: string,
  gradings: Grading[],
): GradingLevelRows {
  const held = levelsIncludingPassedGradings(studentLevel, applicationLevel, gradings);
  const achieved = achievedGradingLevels(held.studentLevel, held.applicationLevel);
  const next = nextGradingLevel(held.studentLevel, held.applicationLevel);
  const retake = freeRetakeLevel(studentLevel, applicationLevel, gradings);
  const payment = nextGradingPayment(studentLevel, applicationLevel, gradings, retake).level;

  const byLevel = new Map<GradingLevel, Grading[]>();
  const nonSyllabusGradings: Grading[] = [];
  for (const g of gradings) {
    const level = toGradingLevel(g.level);
    if (!level) {
      nonSyllabusGradings.push(g);
      continue;
    }
    byLevel.set(level, [...(byLevel.get(level) ?? []), g]);
  }

  const rows = gradingProgression.map((level): GradingLevelRow => {
    const here = mostRecentFirst(byLevel.get(level) ?? []);
    const open = here.find(isOpen);
    const passed = here.find((g) => g.status === GradingStatus.Passed);
    const mainGrading = open ?? passed ?? here[0] ?? null;

    let state = LevelRowState.NotStarted;
    if (achieved.has(level)) state = LevelRowState.Achieved;
    else if (open) state = isGradingPaid(open) ? LevelRowState.Purchased : LevelRowState.Requested;
    else if (passed) state = LevelRowState.PassedUnpaid;
    else if (here.length > 0) state = LevelRowState.NotPassed;

    return {
      level,
      state,
      isNext: level === next,
      isNextPayment: level === payment,
      isFreeRetake: level === retake,
      mainGrading,
      otherGradings: here.filter((g) => g !== mainGrading),
    };
  });

  const firstNotAchieved = rows.findIndex((r) => r.state !== LevelRowState.Achieved);
  return {
    rows,
    leadingAchievedCount: firstNotAchieved === -1 ? rows.length : firstNotAchieved,
    nonSyllabusGradings: mostRecentFirst(nonSyllabusGradings),
  };
}

@Component({
  selector: 'app-grading-levels',
  imports: [GradingRowHeaderComponent, IconComponent],
  templateUrl: './grading-levels.html',
  styleUrl: './grading-levels.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GradingLevelsComponent {
  private routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  member = input.required<Member>();
  gradings = input.required<Grading[]>();

  LevelRowState = LevelRowState;

  // Whether the folded run of achieved levels is shown.
  showAchieved = signal(false);

  // The levels whose other attempts are unfolded.
  unfoldedLevels = signal<ReadonlySet<GradingLevel>>(new Set());

  private model = computed(() =>
    buildGradingLevelRows(
      this.member().studentLevel,
      this.member().applicationLevel,
      this.gradings(),
    ),
  );

  // The leading run of achieved levels, folded into one summary row.
  achievedRows = computed(() => this.model().rows.slice(0, this.model().leadingAchievedCount));

  // The level rows shown: every level when the achieved run is unfolded,
  // otherwise the levels after it.
  visibleRows = computed(() =>
    this.showAchieved()
      ? this.model().rows
      : this.model().rows.slice(this.model().leadingAchievedCount),
  );

  nonSyllabusGradings = computed(() => this.model().nonSyllabusGradings);

  // The member's current levels for display, e.g. 'Student 6, Application 3',
  // or 'None' when they have no level yet.
  currentLevelDisplay = computed(() => {
    const m = this.member();
    const parts = [studentLevelLabel(m.studentLevel), applicationLevelLabel(m.applicationLevel)]
      .filter((p) => !!p);
    return parts.length > 0 ? parts.join(', ') : 'None';
  });

  // Whether the member's membership is currently active (required to grade).
  isActiveMember = computed(() =>
    hasActiveMembership(this.member(), new Date().toISOString().split('T')[0]),
  );

  nextGradingPurchaseLink = computed(() => this.routingService.hrefForView(Views.NextGrading));
  membershipLink = computed(() => this.routingService.hrefForView(Views.BecomeAMember));

  // Link to a grading's page, tagged so its breadcrumb returns to My Gradings.
  gradingLink(grading: Grading): string {
    const href = this.routingService.hrefForView(Views.GradingView, { gradingId: grading.docId });
    const sep = href.includes('?') ? '&' : '?';
    return `${href}${sep}from=my-gradings`;
  }

  isUnfolded(level: GradingLevel): boolean {
    return this.unfoldedLevels().has(level);
  }

  toggleUnfolded(level: GradingLevel) {
    this.unfoldedLevels.update((current) => {
      const updated = new Set(current);
      if (updated.has(level)) updated.delete(level);
      else updated.add(level);
      return updated;
    });
  }

  toggleShowAchieved() {
    this.showAchieved.update((v) => !v);
  }
}
