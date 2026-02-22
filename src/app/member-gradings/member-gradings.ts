import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { GradingListComponent } from '../grading-list/grading-list';
import { StudentLevel } from '../../../functions/src/data-model';

@Component({
  selector: 'app-member-gradings',
  standalone: true,
  imports: [CommonModule, GradingListComponent],
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

  currentLevel = computed(() => {
    const u = this.user();
    if (!u) return StudentLevel.None;
    return u.member.studentLevel || StudentLevel.None;
  });

  nextLevel = computed(() => {
    const level = this.currentLevel();
    if (level === StudentLevel.None) return StudentLevel.Entry;
    if (level === StudentLevel.Entry) return StudentLevel.Level1;
    // Basic mapping for next level (assumes levels 1-11)
    const levelMatch = level.match(/(\d+)/);
    if (levelMatch) {
      const num = parseInt(levelMatch[1], 10);
      if (num < 11) {
        return `Level ${num + 1}`;
      }
    }
    return '';
  });

  setActiveTab(tab: 'examined' | 'students' | 'mine') {
    this.activeTab.set(tab);
  }
}
