/* school-list.ts
 *
 * Displays a searchable list of schools with links to individual school
 * edit pages. Follows the same navigation pattern as manage-events:
 * each school row is a clickable <a> that navigates to a dedicated
 * edit page at /schools/:schoolId/edit (or /my-schools/:schoolId/edit).
 */

import { Component, computed, inject, signal, Input, ChangeDetectionStrategy } from '@angular/core';
import { DataManagerService } from '../data-manager.service';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { SearchableSet } from '../searchable-set';
import { ExpiryStatus } from '../../../functions/src/data-model/members';
import { School, initSchool } from '../../../functions/src/data-model/schools';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FirebaseStateService } from '../firebase-state.service';

@Component({
  selector: 'app-school-list',
  standalone: true,
  imports: [IconComponent, SpinnerComponent],
  templateUrl: './school-list.html',
  styleUrls: ['./school-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolListComponent {
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService<AppPathPatterns>);
  stateService = inject(FirebaseStateService);
  membersService = inject(DataManagerService);

  // Constants
  ExpiryStatus = ExpiryStatus;

  isMySchools = computed(() => this.routingService.matchedPatternId() === Views.MySchools);

  searchTerm = computed(() => {
    if (this.isMySchools()) {
      return this.routingService.signals[Views.MySchools].urlParams.q();
    }
    return this.routingService.signals[Views.ManageSchools].urlParams.q();
  });

  instructorIdParam = computed(() =>
    this.isMySchools()
      ? ''
      : this.routingService.signals[Views.ManageSchools].urlParams.instructorId(),
  );

  memberDocIdParam = computed(() =>
    this.isMySchools()
      ? ''
      : this.routingService.signals[Views.ManageSchools].urlParams.memberDocId(),
  );

  // Label for the active owner/manager filter chip when filtering /schools by a member.
  managerFilterLabel = computed(() => {
    const insId = this.instructorIdParam();
    const memDocId = this.memberDocIdParam();
    if (!insId && !memDocId) return '';
    if (insId) {
      const instructor = this.membersService.instructors.get(insId);
      return instructor
        ? `Managed by ${instructor.name} [${insId}]`
        : `Managed by Instructor [${insId}]`;
    }
    const member = this.membersService.members.get(memDocId);
    if (member) {
      return member.memberId
        ? `Managed by (${member.memberId}) ${member.name}`
        : `Managed by ${member.name}`;
    }
    return `Managed by ${memDocId}`;
  });

  clearManagerFilter() {
    if (this.isMySchools()) return;
    const urlParams = this.routingService.signals[Views.ManageSchools].urlParams;
    urlParams.instructorId.set('');
    urlParams.memberDocId.set('');
  }

  // Expose signals from the service to the template
  @Input() schoolSet: SearchableSet<'schoolId', School> | null = null;

  targetSchoolSet = computed<SearchableSet<'schoolId', School>>(() => this.schoolSet || this.membersService.schools);

  limit = signal(50);
  private filteredSchools = computed(() => {
    let list = this.targetSchoolSet().search(this.searchTerm());
    const insId = this.instructorIdParam();
    const memDocId = this.memberDocIdParam();
    if (insId || memDocId) {
      const resolvedMember = memDocId
        ? this.membersService.members.get(memDocId)
        : insId
          ? this.membersService.members
              .entries()
              .find((m) => m.instructorId === insId)
          : undefined;
      const effectiveInsId = insId || resolvedMember?.instructorId || '';
      const effectiveDocId = memDocId || resolvedMember?.docId || '';

      list = list.filter(
        (s) =>
          (!!effectiveInsId &&
            (s.ownerInstructorId === effectiveInsId ||
              s.managerInstructorIds.includes(effectiveInsId))) ||
          (!!effectiveDocId && s.ownerMemberDocId === effectiveDocId),
      );
    }
    return list;
  });

  schools = computed(() => this.filteredSchools().slice(0, this.limit()));
  totalSchools = computed(() => this.filteredSchools().length);

  duplicateEntries = computed(() => this.targetSchoolSet().duplicateEntries().sort((a, b) => a.schoolId.localeCompare(b.schoolId)));
  errorsExist = computed(() => this.duplicateEntries().length > 0);
  showErrors = signal(false);
  loading = computed(() => this.targetSchoolSet().loading());
  error = computed(() => this.targetSchoolSet().error());
  todayIsoString = signal(new Date().toISOString().split('T')[0]);

  toggleErrors() {
    this.showErrors.set(!this.showErrors());
  }

  showAll() {
    this.limit.set(Infinity);
  }

  onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    if (this.isMySchools()) {
      this.routingService.signals[Views.MySchools].urlParams.q.set(value);
    } else {
      this.routingService.signals[Views.ManageSchools].urlParams.q.set(value);
    }
    this.limit.set(50);
  }

  // Build the edit link for a school, using the correct base path.
  editLink(school: School): string {
    const id = school.docId || school.schoolId;
    if (this.isMySchools()) {
      return `/my-schools/${encodeURIComponent(id)}/edit`;
    }
    return `/schools/${encodeURIComponent(id)}/edit`;
  }


  // Ensure a URL has a protocol prefix.
  ensureHttps(url: string): string {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return 'https://' + url;
    }
    return url;
  }

  // Check school license expiry status.
  schoolLicenseStatus(school: School): ExpiryStatus {
    const expires = school.schoolLicenseExpires;
    if (!expires || expires >= this.todayIsoString()) return ExpiryStatus.Valid;

    const expireDate = new Date(expires);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return expireDate >= sixMonthsAgo ? ExpiryStatus.Recent : ExpiryStatus.Expired;
  }

  onNewSchool() {
    // Navigate to the edit page with a special 'new' placeholder ID
    if (this.isMySchools()) {
      this.routingService.navigateTo('/my-schools/new/edit');
    } else {
      this.routingService.navigateTo('/schools/new/edit');
    }
  }

  // Prevent navigation when the user is selecting text by drag.
  onCardClick(event: MouseEvent) {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      event.preventDefault();
    }
  }
}
