import { Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';

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

  public closeMenu = output<void>();
  public currentView = this.routingService.matchedPatternId;
  public Views = Views;

  public user = this.firebaseService.user;

  get todayDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  viewIdToTitle(viewId: Views | ''): string {
    switch (viewId) {
      case Views.ManageMembers: return 'Manage Members';
      case Views.FindAnInstructor: return 'Find an Instructor';
      case Views.ManageSchools: return 'Manage Schools';
      case Views.FindSchool: return 'Find a School';
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
      case Views.MySchools: return 'My Schools';
      case Views.ActiveMembers: return 'Members Area';
      case Views.ActiveInstructors: return 'Instructors Area';
      case Views.ManageGradings: return 'Manage Gradings';
      case Views.MemberGradings: return 'Gradings';
      case Views.Settings: return 'Settings';
      case Views.ClassVideoLibrary: return 'Class Video Library';
      case Views.ManageOrders: return 'Manage Orders';
      case Views.OrderView:
        const orderId = this.routingService.signals[viewId].pathVars.orderId();
        return `Order ${orderId}`;
      default: return 'Unknown View';
    }
  }

  onSelect(view: Views) {
    this.currentView.set(view);
    this.closeMenu.emit();
  }
}
