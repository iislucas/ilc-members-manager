import { Component, computed, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { FindInstructorsService } from '../find-instructors.service';
import { ExpiryStatus } from '../../../functions/src/data-model';
import { getMemberExpiryStatus, getInstructorExpiryStatus } from '../member-tags';

@Component({
  selector: 'app-navigation-menu',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './navigation-menu.component.html',
  styleUrl: './navigation-menu.component.scss'
})
export class NavigationMenuComponent {
  public firebaseService = inject(FirebaseStateService);
  public routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  public findInstructorsService = inject(FindInstructorsService);

  public closeMenu = output<void>();
  public currentView = this.routingService.matchedPatternId;
  public Views = Views;

  public user = this.firebaseService.user;

  private today = computed(() => new Date().toISOString().split('T')[0]);

  public membershipStatus = computed(() => {
    const m = this.user()?.member;
    if (!m) return { hasAccess: false, expired: false, date: '' };
    const status = getMemberExpiryStatus(m, this.today());
    return {
      hasAccess: status === ExpiryStatus.Valid,
      expired: status === ExpiryStatus.Expired || status === ExpiryStatus.Recent,
      date: m.currentMembershipExpires
    };
  });

  public instructorStatus = computed(() => {
    const m = this.user()?.member;
    if (!m) return { hasAccess: false, expired: false, date: '', isInstructor: false };
    const status = getInstructorExpiryStatus(m, this.today());
    return {
      hasAccess: !!m.instructorId && status === ExpiryStatus.Valid,
      expired: !!m.instructorId && (status === ExpiryStatus.Expired || status === ExpiryStatus.Recent),
      date: m.instructorLicenseExpires,
      isInstructor: !!m.instructorId
    };
  });

  public videoStatus = computed(() => {
    const m = this.user()?.member;
    if (!m) return { hasAccess: false, expired: false, date: '' };
    const today = this.today();
    const hasSubscription = m.classVideoLibrarySubscription;
    const expires = m.classVideoLibraryExpirationDate;
    const hasAccess = hasSubscription && (!expires || expires >= today);
    const expired = hasSubscription && !!expires && expires < today;
    return {
      hasAccess,
      expired,
      date: expires
    };
  });

  viewIdToTitle(viewId: Views | ''): string {
    switch (viewId) {
      case Views.ManageMembers: return 'Manage Members';
      case Views.FindAnInstructor: return 'Find an Instructor';
      case Views.ManageSchools: return 'Manage Schools';
      case Views.FindSchool: return 'Find a School';
      case Views.ClassCalendarView:
        const calId = this.routingService.signals[Views.ClassCalendarView].pathVars.instructorId();
        const calInst = calId ? this.findInstructorsService.instructors.get(calId) : undefined;
        return calInst ? `${calInst.name} (${calId})'s Class Calendar` : 'Class Calendar';
      case Views.SchoolCalendarView:
        return 'School Calendar';
      case Views.SchoolMembers:
        const schoolId = this.routingService.signals[viewId].pathVars.schoolId();
        return `School ${schoolId} Members`;
      case Views.InstructorStudents:
        const instructorId = this.routingService.signals[viewId].pathVars.instructorId();
        return `Instructor ${instructorId}'s Students`;
      case Views.ImportExport: return 'Import/Export';
      case Views.Home: return 'Home';
      case Views.MyProfile: return 'My Profile';
      case Views.MyStudents: return 'My Students';
      case Views.MyEvents: return 'My Events';
      case Views.MySchools: return 'My Schools';
      case Views.MembersArea: return 'Members Area';
      case Views.InstructorsArea: return 'Instructors Area';
      case Views.ManageGradings: return 'Manage Gradings';
      case Views.MemberGradings: return 'My Gradings';
      case Views.Settings: return 'Settings';
      case Views.ClassVideoLibrary: return 'Class Video Library';
      case Views.ManageOrders: return 'Manage Orders';
      case Views.Statistics: return 'Statistics';
      case Views.EventsCalendar: return 'Events & Workshops';
      case Views.OrderView:
        const orderId = this.routingService.signals[viewId].pathVars.orderId();
        return `Order ${orderId}`;
      case Views.ProposeEvent: return 'Organise Event';
      case Views.ManageEvents: return 'Manage Events';
      default: return 'Unknown View';
    }
  }

  onSelect(view: Views) {
    this.currentView.set(view);
    this.closeMenu.emit();
  }
}
