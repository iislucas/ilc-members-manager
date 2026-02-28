import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { initMember, Member } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { MemberDetailsComponent } from '../member-details/member-details';
import { MemberRowHeaderComponent } from '../member-row-header/member-row-header';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

@Component({
  selector: 'app-member-list',
  standalone: true,
  imports: [CommonModule, MemberRowHeaderComponent, MemberDetailsComponent, IconComponent, SpinnerComponent],
  templateUrl: './member-list.html',
  styleUrl: './member-list.scss',
})
export class MemberListComponent {
  routingService = inject(RoutingService<AppPathPatterns>);
  firebaseStateService = inject(FirebaseStateService);
  user = this.firebaseStateService.user;
  canMakeNewMembers = computed(() => {
    const user = this.user();
    if (!user) {
      console.warn('Got to members list without a valid user.');
      return false;
    }
    return user.isAdmin || user.schoolsManaged.length > 0;
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

  isAddingMember = signal(false);
  newMember = signal<Member>(initMember());

  // Expose signals from the service to the template
  limit = signal(50);
  members = computed(() => {
    const all = this.memberSet().search(this.searchTerm());
    return all.slice(0, this.limit());
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

  gotoMemberSubview(member: Member) {
    if (!member) return;

    const base = this.basePath();
    if (base) {
      const hasDups = this.duplicateMemberIdEntries().some(m => m.memberId === member.memberId);
      const isMissing = !member.memberId;
      const idToRoute = (hasDups || isMissing) ? member.docId : member.memberId;

      this.routingService.navigateToParts([base, idToRoute]);
    } else {
      console.warn('gotoMemberSubview called but no basePath was provided to member-list component.');
    }
  }

  onNewMember() {
    this.newMember.set(initMember());
    this.isAddingMember.set(true);
  }

  onNewMemberClose() {
    this.isAddingMember.set(false);
  }
}
