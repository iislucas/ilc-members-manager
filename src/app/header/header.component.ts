import { Component, input, model, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';
import { NavigationMenuComponent } from '../navigation-menu/navigation-menu.component';
import { ProfileMenuComponent } from '../profile-menu/profile-menu';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';

import { NavigationTreeService } from '../navigation-tree';
import { FirebaseStateService } from '../firebase-state.service';
import { NetworkStateService } from '../network-state.service';
import { ActionQueueService } from '../action-queue.service';
import { OfflineBannerComponent } from '../offline-banner/offline-banner.component';
import { Views } from '../app.config';

export interface Breadcrumb {
  label: string;
  shortLabel?: string;
  url?: string;
  isRoute?: boolean; // If true, treats url as a hash route, or standard href
  isLoading?: boolean;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    NavigationMenuComponent,
    ProfileMenuComponent,
    OfflineBannerComponent,
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent {
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  navTree = inject(NavigationTreeService);
  firebaseService = inject(FirebaseStateService);
  networkState = inject(NetworkStateService);
  actionQueue = inject(ActionQueueService);

  breadcrumbs = input<Breadcrumb[]>([]);
  abbreviateParents = input<boolean>(true);
  isLoggedIn = input<boolean>(false);
  isPublicPage = input<boolean>(false);
  menuOpen = model<boolean>(false);

  isHome = this.navTree.isHome;
  upNode = this.navTree.upNode;

  hasParentCrumbs = computed(() => this.breadcrumbs().length > 1);
  displayParentCrumbs = signal<Breadcrumb[]>([]);

  queueHref = computed(() => this.routingService.hrefForView(Views.OfflineActionQueue));

  constructor() {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    effect(() => {
      const crumbs = this.breadcrumbs();
      if (crumbs.length > 1) {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        this.displayParentCrumbs.set(crumbs.slice(0, -1));
      } else {
        // Retain previous parent crumbs in DOM while accordion collapses (250ms)
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          this.displayParentCrumbs.set([]);
          timeoutId = null;
        }, 260);
      }
    });
  }

  hasTopTabs = computed(() => {
    const view = this.routingService.matchedPatternId();
    if (view === Views.Home) return true;
    if (view === Views.MembersArea || view === Views.MembersAreaCategory) return true;
    if (view === Views.InstructorsArea || view === Views.InstructorsAreaCategory) return true;
    if (view === Views.Articles || view === Views.ArticlesCategory) return true;
    if (view === Views.MemberGradings) {
      return !!this.firebaseService.user()?.member?.instructorId;
    }
    if (view === Views.Notifications) return true;
    if (view === Views.Videos) return true;
    if (view === Views.EmailNotifications) return true;
    return false;
  });

  badgeTooltip = computed(() => {
    if (this.actionQueue.conflictCount() > 0) {
      return 'Conflicts detected with server changes. Click to review.';
    }
    if (this.networkState.isReconnecting() || this.actionQueue.isSyncing()) {
      return 'Reconnecting to network and synchronizing edits...';
    }
    if (this.networkState.isOffline()) {
      const count = this.actionQueue.pendingCount();
      return `You are currently offline.${count > 0 ? ` ${count} edit(s) queued.` : ''} Click to view action queue.`;
    }
    return `${this.actionQueue.pendingCount()} edit(s) queued for sync. Click to view.`;
  });

  openActionQueue(): void {
    this.actionQueue.openDialog();
  }

  // Encodes the current URL (path + query params, without the leading slash)
  // for use as a returnUrl parameter on the login page.
  encodeCurrentUrl(): string {
    let path = window.location.pathname + window.location.search;
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    return encodeURIComponent(path);
  }
}
