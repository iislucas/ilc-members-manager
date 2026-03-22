import { Component, computed, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { CommonModule } from '@angular/common';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { ExpiryStatus } from '../../../functions/src/data-model';
import { getMemberExpiryStatus, getInstructorExpiryStatus } from '../member-tags';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  private firebaseService = inject(FirebaseStateService);
  protected user = this.firebaseService.user;
  protected Views = Views;

  protected links = environment.links;

  private today = computed(() => new Date().toISOString().split('T')[0]);
  
  protected membershipStatus = computed(() => {
    const m = this.user()?.member;
    if (!m) return { hasAccess: false, expired: false, date: '' };
    const status = getMemberExpiryStatus(m, this.today());
    return {
      hasAccess: status === ExpiryStatus.Valid,
      expired: status === ExpiryStatus.Expired || status === ExpiryStatus.Recent,
      date: m.currentMembershipExpires
    };
  });

  protected instructorStatus = computed(() => {
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

  protected videoStatus = computed(() => {
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
}
