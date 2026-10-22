import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { GradingListComponent } from '../grading-list/grading-list';
import { GradingLevelsComponent } from '../grading-levels/grading-levels';
import { SpinnerComponent } from '../spinner/spinner.component';

import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { environment } from '../../environments/environment';

type GradingTab = 'examined' | 'students' | 'mine';
const VALID_TABS: GradingTab[] = ['examined', 'students', 'mine'];
const DEFAULT_TAB: GradingTab = 'mine';

@Component({
  selector: 'app-member-gradings',
  standalone: true,
  imports: [CommonModule, GradingListComponent, GradingLevelsComponent, SpinnerComponent],
  templateUrl: './member-gradings.html',
  styleUrl: './member-gradings.scss',
})
export class MemberGradingsComponent {
  firebaseStateService = inject(FirebaseStateService);
  dataService = inject(DataManagerService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  Views = Views;
  user = this.firebaseStateService.user;

  isInstructor = computed(() => {
    const u = this.user();
    return !!(u && u.member.instructorId);
  });

  isRequesting = signal(false);
  requestError = signal<string>('');

  async requestGrading() {
    const u = this.user();
    if (!u || this.isRequesting()) return;
    this.isRequesting.set(true);
    this.requestError.set('');
    try {
      const gradingId = await this.dataService.requestGrading(u.member.docId);
      this.routingService.navigateTo(`gradings/${gradingId}?from=my-gradings`);
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

  setActiveTab(tab: GradingTab) {
    this.viewSignals().urlParams.tab.set(tab);
  }
}
