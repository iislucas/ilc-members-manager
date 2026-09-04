import { Component, computed, inject, linkedSignal, output } from '@angular/core';
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

  public currentArea = computed<'learn' | 'practice' | 'me' | 'admin'>(() => {
    const view = this.currentView();
    if (view === Views.Home || !view) {
      const tab = this.routingService.signals[Views.Home].urlParams.tab();
      if (tab === 'practice') return 'practice';
      if (tab === 'me') return 'me';
      if (tab === 'admin') return 'admin';
      return 'learn';
    }
    // Learn views:
    if (
      view === Views.MembersArea ||
      view === Views.MembersAreaCategory ||
      view === Views.MembersAreaPost ||
      view === Views.InstructorsArea ||
      view === Views.InstructorsAreaCategory ||
      view === Views.InstructorsAreaPost ||
      view === Views.Articles ||
      view === Views.ArticlesCategory ||
      view === Views.ArticlesPost ||
      view === Views.ClassVideoLibrary
    ) {
      return 'learn';
    }
    // Practice views:
    if (
      view === Views.EventsCalendar ||
      view === Views.EventView ||
      view === Views.EventEdit ||
      view === Views.FindSchool ||
      view === Views.SchoolView ||
      view === Views.SchoolCalendarView ||
      view === Views.FindAnInstructor ||
      view === Views.InstructorView ||
      view === Views.ClassCalendarView
    ) {
      return 'practice';
    }
    // Me views:
    if (
      view === Views.MyProfile ||
      view === Views.MemberGradings ||
      view === Views.MyEvents ||
      view === Views.MyEventView ||
      view === Views.MyEventEdit ||
      view === Views.ProposeEvent ||
      view === Views.MyMaterials ||
      view === Views.MyStudents ||
      view === Views.MyStudentView ||
      view === Views.MySchools ||
      view === Views.MySchoolEdit ||
      view === Views.Notifications ||
      view === Views.NotificationSettings
    ) {
      return 'me';
    }
    // Admin views:
    return 'admin';
  });

  public selectedArea = linkedSignal<'learn' | 'practice' | 'me' | 'admin'>(() => this.currentArea());

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
      case Views.ManageMembers: return 'Members';
      case Views.FindAnInstructor: return 'Instructors';
      case Views.ManageSchools: return 'Schools';
      case Views.FindSchool: return 'Schools';
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
      case Views.MyProfile: return 'Profile';
      case Views.Notifications: return 'Notifications';
      case Views.MyStudents: return 'Students';
      case Views.MyEvents: return 'Events';
      case Views.MySchools: return 'Schools';
      case Views.MembersArea: return 'Members Area';
      case Views.InstructorsArea: return 'Instructors Area';
      case Views.Articles: return 'Articles & Guides';
      case Views.ManageGradings: return 'Gradings';
      case Views.MemberGradings: return 'Gradings';
      case Views.Settings: return 'Settings';
      case Views.ClassVideoLibrary: return 'Class Video Library';
      case Views.ManageOrders: return 'Orders';
      case Views.Statistics: return 'Statistics';
      case Views.EventsCalendar: return 'Events & Workshops';
      case Views.OrderView:
        const orderId = this.routingService.signals[viewId].pathVars.orderId();
        return `Order ${orderId}`;
      case Views.ProposeEvent: return 'Organise or List an Event';
      case Views.ManageEvents: return 'Events';
      case Views.EventView:
      case Views.MyEventView:
      case Views.ManageEventView:
        return 'Event Details';
      case Views.EventEdit:
      case Views.MyEventEdit:
      case Views.ManageEventEdit:
        return 'Edit Event';
      case Views.MyMaterials: return 'Uploads';
      case Views.ManageMaterials: return 'Materials';
      default: return 'Unknown View';
    }
  }

  onSelect(view: Views) {
    this.currentView.set(view);
    this.closeMenu.emit();
  }

  onSelectArea(tab: 'learn' | 'practice' | 'me' | 'admin') {
    if (this.selectedArea() === tab) {
      this.onSelectHomeTab(tab);
    } else {
      this.selectedArea.set(tab);
    }
  }

  onSelectHomeTab(tab: 'learn' | 'practice' | 'me' | 'admin') {
    if (this.routingService.matchedPatternId() === Views.Home) {
      this.routingService.signals[Views.Home].urlParams.tab.set(tab === 'learn' ? '' : tab);
    } else {
      this.routingService.navigateTo(tab === 'learn' ? '' : `?tab=${tab}`);
    }
    this.closeMenu.emit();
  }
}
