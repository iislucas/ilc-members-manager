import { Component, computed, inject, linkedSignal } from '@angular/core';
import { environment } from '../../environments/environment';
import { CommonModule } from '@angular/common';
import { RoutingService } from '../routing.service';
import { FirebaseStateService } from '../firebase-state.service';
import { NotificationsListComponent } from '../notifications-list/notifications-list';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { ExpiryStatus } from '../../../functions/src/data-model';
import { getMemberExpiryStatus, getInstructorExpiryStatus } from '../member-tags';

export type HomeTab = 'learn' | 'practice' | 'me' | 'admin';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, IconComponent, NotificationsListComponent],
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

  public sessionId = computed(() => {
    return this.routingService.signals[Views.Home].urlParams.session_id();
  });

  public welcomeParam = computed(() => {
    return this.routingService.signals[Views.Home].urlParams.welcome();
  });

  public showWelcomeBanner = linkedSignal(() => {
    return !!(this.welcomeParam() || (this.sessionId() && this.welcomeParam() === 'membership'));
  });

  public dismissWelcomeBanner(): void {
    this.showWelcomeBanner.set(false);
  }

  private tabFromUrl = computed<HomeTab>(() => {
    const tab = this.routingService.signals[Views.Home].urlParams.tab();
    if (tab === 'practice' || tab === 'me') {
      return tab;
    }
    if (tab === 'admin' && this.user()?.isAdmin) {
      return 'admin';
    }
    return 'learn';
  });

  public activeTab = linkedSignal<HomeTab>(() => this.tabFromUrl());

  public setActiveTab(tab: HomeTab) {
    this.activeTab.set(tab);
    this.routingService.signals[Views.Home].urlParams.tab.set(tab === 'learn' ? '' : tab);
  }

  // Mobile swipe gesture support
  private touchStartX = 0;
  private touchStartY = 0;

  public onTouchStart(event: TouchEvent) {
    if (event.touches.length === 1) {
      this.touchStartX = event.touches[0].clientX;
      this.touchStartY = event.touches[0].clientY;
    }
  }

  public onTouchEnd(event: TouchEvent) {
    if (event.changedTouches.length === 1) {
      const deltaX = event.changedTouches[0].clientX - this.touchStartX;
      const deltaY = event.changedTouches[0].clientY - this.touchStartY;
      // Require swipe of at least 50px and predominantly horizontal (x > 1.5 * y)
      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        const tabs: HomeTab[] = this.user()?.isAdmin
          ? ['learn', 'practice', 'me', 'admin']
          : ['learn', 'practice', 'me'];
        const currentIndex = tabs.indexOf(this.activeTab());
        if (deltaX < 0 && currentIndex < tabs.length - 1) {
          // Swipe left -> Next tab
          this.setActiveTab(tabs[currentIndex + 1]);
        } else if (deltaX > 0 && currentIndex > 0) {
          // Swipe right -> Previous tab
          this.setActiveTab(tabs[currentIndex - 1]);
        }
      }
    }
  }

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
