import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { GradingListComponent } from '../grading-list/grading-list';
import { IconComponent } from '../icons/icon.component';
import { nextGradingLevel, GradingStatus, ExpiryStatus, isGradingPaid } from '../../../functions/src/data-model';
import { getMemberExpiryStatus } from '../member-tags';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { environment } from '../../environments/environment';

type GradingTab = 'examined' | 'students' | 'mine';
const VALID_TABS: GradingTab[] = ['examined', 'students', 'mine'];
const DEFAULT_TAB: GradingTab = 'mine';

@Component({
  selector: 'app-member-gradings',
  standalone: true,
  imports: [CommonModule, GradingListComponent, IconComponent],
  templateUrl: './member-gradings.html',
  styleUrl: './member-gradings.scss',
})
export class MemberGradingsComponent {
  firebaseStateService = inject(FirebaseStateService);
  dataService = inject(DataManagerService);
  private routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  user = this.firebaseStateService.user;

  // Link to the membership product page, shown to non-active members.
  membershipLink = environment.links.membership;

  private today = computed(() => new Date().toISOString().split('T')[0]);

  isInstructor = computed(() => {
    const u = this.user();
    return !!(u && u.member.instructorId);
  });

  // Whether the member's membership is currently active (required to grade).
  isActiveMember = computed(() => {
    const u = this.user();
    if (!u) return false;
    return getMemberExpiryStatus(u.member, this.today()) === ExpiryStatus.Valid;
  });

  // The docId of an existing open (unpaid, not-failed) grading the member can
  // continue editing, or '' if none. A member may only have one at a time.
  openUnpaidGradingId = computed(() => {
    const grading = this.dataService.myGradings
      .entries()
      .find((g) => !isGradingPaid(g) && g.status !== GradingStatus.NotPassed);
    return grading ? grading.docId : '';
  });

  // Link to continue an existing open grading request.
  openUnpaidGradingLink = computed(() => {
    const id = this.openUnpaidGradingId();
    if (!id) return '';
    return this.routingService.hrefForView(Views.GradingView, { gradingId: id });
  });

  // Whether the member can request a brand-new grading: active member, has a
  // next level to grade, and doesn't already have an open request or a purchased
  // grading for that level.
  canRequestGrading = computed(
    () =>
      this.isActiveMember() &&
      !!this.nextGrading() &&
      !this.openUnpaidGradingId() &&
      !this.nextGradingPurchased(),
  );

  isRequesting = signal(false);
  requestError = signal<string>('');

  async requestGrading() {
    const u = this.user();
    if (!u || this.isRequesting()) return;
    this.isRequesting.set(true);
    this.requestError.set('');
    try {
      const gradingId = await this.dataService.requestGrading(u.member.docId);
      this.routingService.navigateTo(`gradings/${gradingId}`);
    } catch (e: unknown) {
      this.requestError.set(
        e instanceof Error ? e.message : 'Could not request a grading. Please try again.',
      );
    } finally {
      this.isRequesting.set(false);
    }
  }

  // Derive the active tab from the URL `tab` parameter.
  // Selects the correct view signals based on which grading route matched.
  private viewSignals = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.ManageGradings) return this.routingService.signals[Views.ManageGradings];
    return this.routingService.signals[Views.MemberGradings];
  });

  activeTab = computed<GradingTab>(() => {
    const urlTab = this.viewSignals().urlParams.tab();
    if (urlTab && VALID_TABS.includes(urlTab as GradingTab)) {
      return urlTab as GradingTab;
    }
    return DEFAULT_TAB;
  });

  // Display string for the current levels, e.g. "Student 6, Application 3".
  currentLevelDisplay = computed(() => {
    const u = this.user();
    if (!u) return 'None';
    const parts: string[] = [];
    const sl = u.member.studentLevel;
    if (sl) {
      parts.push('Student ' + sl);
    }
    const al = u.member.applicationLevel;
    if (al) {
      parts.push('Application ' + al);
    }
    return parts.length > 0 ? parts.join(', ') : 'None';
  });

  // The next grading level from the canonical progression that the member
  // hasn't yet achieved (derived from their current student/application levels).
  nextGrading = computed(() => {
    const u = this.user();
    if (!u) return '';
    return nextGradingLevel(u.member.studentLevel, u.member.applicationLevel);
  });

  // Whether a grading for the next level has already been purchased
  // (ignoring gradings the student didn't pass).
  nextGradingPurchased = computed(() => !!this.nextGradingPurchasedId());

  // The docId of the purchased grading for the next level (if one exists)
  nextGradingPurchasedId = computed(() => {
    const next = this.nextGrading();
    if (!next) return '';
    const grading = this.dataService.myGradings
      .entries()
      .find((g) => g.level === next && g.status !== GradingStatus.NotPassed);
    return grading ? grading.docId : '';
  });

  // Href link to the progress view of the purchased grading
  nextGradingLink = computed(() => {
    const gradingId = this.nextGradingPurchasedId();
    if (!gradingId) return '';
    return this.routingService.hrefForView(Views.GradingView, {
      gradingId,
    });
  });


  setActiveTab(tab: GradingTab) {
    this.viewSignals().urlParams.tab.set(tab);
  }
}
