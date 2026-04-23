import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { GradingListComponent } from '../grading-list/grading-list';
import { IconComponent } from '../icons/icon.component';
import { gradingProgression, GradingStatus } from '../../../functions/src/data-model';

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

  user = this.firebaseStateService.user;

  isInstructor = computed(() => {
    const u = this.user();
    return !!(u && u.member.instructorId);
  });

  activeTab = signal<'examined' | 'students' | 'mine'>('mine');

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

  // Build a set of all progression levels the member has already achieved,
  // derived from their current studentLevel and applicationLevel.
  private achievedLevels = computed(() => {
    const u = this.user();
    if (!u) return new Set<string>();
    const achieved = new Set<string>();
    const sl = u.member.studentLevel;
    const al = u.member.applicationLevel;
    // Walk the progression and mark everything up to and including
    // the member's current student level and current application level.
    for (const level of gradingProgression) {
      if (level.startsWith('Student ')) {
        const value = level.substring('Student '.length);
        // The member has achieved this student level if it's at or below their current.
        if (sl && this.isAtOrBelow('Student', value, sl)) {
          achieved.add(level);
        }
      } else if (level.startsWith('Application ')) {
        const value = level.substring('Application '.length);
        if (al && this.isAtOrBelow('Application', value, al)) {
          achieved.add(level);
        }
      }
    }
    return achieved;
  });

  // The next grading level from the canonical progression that the member
  // hasn't yet achieved.
  nextGrading = computed(() => {
    const achieved = this.achievedLevels();
    for (const level of gradingProgression) {
      if (!achieved.has(level)) return level;
    }
    // All levels achieved.
    return '';
  });

  // Whether a grading for the next level has already been purchased
  // (ignoring gradings the student didn't pass).
  nextGradingPurchased = computed(() => {
    const next = this.nextGrading();
    if (!next) return false;
    return this.dataService.myGradings
      .entries()
      .some((g) => g.level === next && g.status !== GradingStatus.NotPassed);
  });

  setActiveTab(tab: 'examined' | 'students' | 'mine') {
    this.activeTab.set(tab);
  }

  // Returns true if `levelValue` is at or below `currentValue` within
  // the given track. E.g. isAtOrBelow('Student', '3', '6') → true.
  private isAtOrBelow(
    track: 'Student' | 'Application',
    levelValue: string,
    currentValue: string,
  ): boolean {
    // Handle the special "Entry" student level.
    if (track === 'Student') {
      if (levelValue === 'Entry') return true; // Entry is always below any current level.
      if (currentValue === 'Entry') return levelValue === 'Entry';
    }
    const levelNum = parseInt(levelValue, 10);
    const currentNum = parseInt(currentValue, 10);
    if (isNaN(levelNum) || isNaN(currentNum)) return false;
    return levelNum <= currentNum;
  }
}
