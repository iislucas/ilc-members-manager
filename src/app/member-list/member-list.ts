import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Member, StudentLevel, ApplicationLevel } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';

import { MemberRowHeaderComponent } from '../member-row-header/member-row-header';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

export enum MemberSortField {
  Id = 'id',
  Name = 'name',
  Level = 'level',
  LastUpdated = 'lastUpdated',
  MembershipExpiry = 'membershipExpiry',
  InstructorId = 'instructorId',
}

export enum SortDirection {
  Asc = 'asc',
  Desc = 'desc',
}

export const SORT_FIELD_LABELS: { value: MemberSortField; label: string }[] = [
  { value: MemberSortField.Id, label: 'Member ID' },
  { value: MemberSortField.Name, label: 'Name' },
  { value: MemberSortField.Level, label: 'Level' },
  { value: MemberSortField.LastUpdated, label: 'Last Updated' },
  { value: MemberSortField.MembershipExpiry, label: 'Membership Expiry' },
  { value: MemberSortField.InstructorId, label: 'Instructor ID' },
];

// Numeric ordering for StudentLevel (higher = more advanced).
const STUDENT_LEVEL_ORDER: Record<string, number> = {
  [StudentLevel.None]: 0,
  [StudentLevel.Entry]: 1,
  [StudentLevel.Level1]: 2,
  [StudentLevel.Level2]: 3,
  [StudentLevel.Level3]: 4,
  [StudentLevel.Level4]: 5,
  [StudentLevel.Level5]: 6,
  [StudentLevel.Level6]: 7,
  [StudentLevel.Level7]: 8,
  [StudentLevel.Level8]: 9,
  [StudentLevel.Level9]: 10,
  [StudentLevel.Level10]: 11,
  [StudentLevel.Level11]: 12,
};

// Numeric ordering for ApplicationLevel (higher = more advanced).
const APP_LEVEL_ORDER: Record<string, number> = {
  [ApplicationLevel.None]: 0,
  [ApplicationLevel.Level1]: 1,
  [ApplicationLevel.Level2]: 2,
  [ApplicationLevel.Level3]: 3,
  [ApplicationLevel.Level4]: 4,
  [ApplicationLevel.Level5]: 5,
  [ApplicationLevel.Level6]: 6,
};

function compareMembersByField(a: Member, b: Member, field: MemberSortField, dir: SortDirection): number {
  const mul = dir === SortDirection.Asc ? 1 : -1;
  switch (field) {
    case MemberSortField.Id:
      return mul * (a.memberId || '').localeCompare(b.memberId || '', undefined, { numeric: true });
    case MemberSortField.Name:
      return mul * (a.name || '').localeCompare(b.name || '');
    case MemberSortField.Level: {
      const sA = STUDENT_LEVEL_ORDER[a.studentLevel] ?? 0;
      const sB = STUDENT_LEVEL_ORDER[b.studentLevel] ?? 0;
      if (sA !== sB) return mul * (sA - sB);
      const aA = APP_LEVEL_ORDER[a.applicationLevel] ?? 0;
      const aB = APP_LEVEL_ORDER[b.applicationLevel] ?? 0;
      return mul * (aA - aB);
    }
    case MemberSortField.LastUpdated:
      return mul * (a.lastUpdated || '').localeCompare(b.lastUpdated || '');
    case MemberSortField.MembershipExpiry:
      return mul * (a.currentMembershipExpires || '').localeCompare(b.currentMembershipExpires || '');
    case MemberSortField.InstructorId:
      return mul * (a.primaryInstructorId || '').localeCompare(b.primaryInstructorId || '', undefined, { numeric: true });
    default:
      return 0;
  }
}

@Component({
  selector: 'app-member-list',
  standalone: true,
  imports: [CommonModule, FormsModule, MemberRowHeaderComponent, IconComponent, SpinnerComponent],
  templateUrl: './member-list.html',
  styleUrl: './member-list.scss',
})
export class MemberListComponent {
  readonly sortFieldOptions = SORT_FIELD_LABELS;
  routingService = inject(RoutingService<AppPathPatterns>);
  firebaseStateService = inject(FirebaseStateService);
  user = this.firebaseStateService.user;
  canMakeNewMembers = computed(() => {
    const user = this.user();
    if (!user) {
      console.warn('Got to members list without a valid user.');
      return false;
    }
    return user.isAdmin;
  });

  memberSet = input.required<SearchableSet<'memberId', Member>>();
  jumpToMember = input<string>('');
  basePath = input<string>('');

  searchTerm = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (!match) return '';
    const sigs = this.routingService.signals[match as keyof AppPathPatterns] as any;
    return sigs?.urlParams?.q ? sigs.urlParams.q() : '';
  });


  // Sort state
  SortDirection = SortDirection;

  sortField = signal<MemberSortField>(MemberSortField.LastUpdated);
  sortDirection = signal<SortDirection>(SortDirection.Asc);

  toggleSortDirection() {
    this.sortDirection.update(d => d === SortDirection.Asc ? SortDirection.Desc : SortDirection.Asc);
  }

  // Expose signals from the service to the template
  limit = signal(50);
  members = computed(() => {
    const all = this.memberSet().search(this.searchTerm());
    const field = this.sortField();
    const dir = this.sortDirection();
    const sorted = [...all].sort((a, b) => compareMembersByField(a, b, field, dir));
    return sorted.slice(0, this.limit());
  });
  totalMembers = computed(
    () => this.memberSet().search(this.searchTerm()).length,
  );

  duplicateMemberIdEntries = computed(() => {
    const dups = this.memberSet().duplicateEntries();
    // optionally ignore empty memberIds but let's just use what SearchableSet does
    return dups;
  });
  errorsExist = computed(() => this.duplicateMemberIdEntries().length > 0);
  showErrors = signal(false);

  missingMemberIdEntries = computed(() => {
    return this.memberSet().missingIdEntries();
  });
  missingMemberErrorsExist = computed(() => this.missingMemberIdEntries().length > 0);
  showMissingMemberErrors = signal(false);

  toggleMissingMemberErrors() {
    this.showMissingMemberErrors.set(!this.showMissingMemberErrors());
  }

  duplicateInstructorIdEntries = computed(() => {
    const entries = this.memberSet().entries();
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const entry of entries) {
      const id = entry.instructorId;
      if (!id) continue;
      if (seen.has(id)) {
        dups.add(id);
      }
      seen.add(id);
    }
    return entries.filter((e) => e.instructorId && dups.has(e.instructorId));
  });
  instructorErrorsExist = computed(() => this.duplicateInstructorIdEntries().length > 0);
  showInstructorErrors = signal(false);

  loading = computed(() => this.memberSet().loading());
  error = computed(() => this.memberSet().error());

  toggleErrors() {
    this.showErrors.set(!this.showErrors());
  }

  toggleInstructorErrors() {
    this.showInstructorErrors.set(!this.showInstructorErrors());
  }

  showAll() {
    this.limit.set(Infinity);
  }

  jumpToMemberRoute = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (!match) return '';
    const sigs = this.routingService.signals[match as keyof AppPathPatterns] as any;
    return sigs?.urlParams?.jumpTo ? sigs.urlParams.jumpTo() : '';
  });

  constructor() {
    effect(() => {
      // jumpToMember could come from Input or route
      const jumpTo = this.jumpToMemberRoute() || this.jumpToMember();
      if (jumpTo && jumpTo !== '') {
        // Find the element and scroll smoothly to it
        setTimeout(() => {
          const el = document.getElementById('member-' + jumpTo);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('jump-highlight');
            setTimeout(() => el.classList.remove('jump-highlight'), 2000);
          }
        }, 100);
      }
    });
  }

  onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const match = this.routingService.matchedPatternId();
    if (match) {
      const sigs = this.routingService.signals[match as keyof AppPathPatterns] as any;
      if (sigs?.urlParams?.q) {
        sigs.urlParams.q.set(value);
      }
    }
    this.limit.set(50);
  }

  memberLink(member: Member): string | null {
    if (!member) return null;

    const base = this.basePath();
    if (base) {
      const hasDups = this.duplicateMemberIdEntries().some(m => m.memberId === member.memberId);
      const isMissing = !member.memberId;
      const idToRoute = (hasDups || isMissing) ? member.docId : member.memberId;

      return `#/${base}/${idToRoute}`;
    } else {
      console.warn('memberLink called but no basePath was provided to member-list component.');
      return null;
    }
  }

  newMember() {
    const base = this.basePath();
    if (base) {
      this.routingService.navigateTo(`new-member?basePath=${encodeURIComponent(base)}`);
    } else {
      console.warn('newMember called but no basePath was provided to member-list component.');
    }
  }

}
