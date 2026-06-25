/*
  Full notifications history view. Unlike the home feed (app-notifications-list)
  which only shows unread (dismissed === false) notifications, this view lists the
  member's entire notification history and lets them:
    - mark a notification read / unread (toggles `dismissed`)
    - permanently delete a notification
  It also cross-links with the Notification Settings page.

  Usage (routed):
    <app-notifications-view></app-notifications-view>
*/

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  signal,
  OnDestroy,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  MemberNotification,
  NotificationStyle,
  notificationStyle,
} from '../../../functions/src/data-model';
import { NotificationService } from '../notification.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { MarkdownViewer } from '../markdown-editor/markdown-viewer';

type NotificationFilter = 'all' | 'unread';
const VALID_FILTERS: NotificationFilter[] = ['all', 'unread'];
const DEFAULT_FILTER: NotificationFilter = 'all';

@Component({
  selector: 'app-notifications-view',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, IconComponent, MarkdownViewer],
  templateUrl: './notifications-view.html',
  styleUrl: './notifications-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsViewComponent implements OnDestroy {
  private notificationService = inject(NotificationService);
  private routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  // Id of the notification awaiting delete confirmation (inline two-step).
  protected confirmingDeleteId = signal<string | null>(null);

  // Set of notification IDs currently undergoing the delete collapse animation.
  protected deletingIds = signal<Set<string>>(new Set());

  constructor() {
    this.notificationService.subscribeToAllNotifications();
  }

  ngOnDestroy() {
    this.notificationService.unsubscribeFromAllNotifications();
  }

  // The active All / Unread filter, derived from the `filter` URL param.
  activeFilter = computed<NotificationFilter>(() => {
    const param = this.routingService.signals[Views.Notifications].urlParams.filter();
    if (param && VALID_FILTERS.includes(param as NotificationFilter)) {
      return param as NotificationFilter;
    }
    return DEFAULT_FILTER;
  });

  allNotifications = this.notificationService.allNotifications;

  unreadCount = computed(
    () => this.allNotifications().filter((n) => !n.dismissed).length,
  );

  // Read-state filter (All / Unread).
  visibleNotifications = computed(() => {
    const list = this.allNotifications();
    if (this.activeFilter() === 'unread') {
      return list.filter((n) => !n.dismissed);
    }
    return list;
  });

  // Style filter (All / To do / FYI), a local toggle at the top of the list.
  // Notifications are shown newest-first (already date-ordered by the service);
  // this only narrows by presentation style rather than grouping into sections.
  protected styleFilter = signal<'all' | 'action' | 'info'>('all');

  actionCount = computed(
    () => this.visibleNotifications().filter((n) => this.styleOf(n) === 'action').length,
  );
  infoCount = computed(
    () => this.visibleNotifications().filter((n) => this.styleOf(n) === 'info').length,
  );

  filteredNotifications = computed(() => {
    const style = this.styleFilter();
    const list = this.visibleNotifications();
    if (style === 'all') return list;
    return list.filter((n) => this.styleOf(n) === style);
  });

  setStyleFilter(style: 'all' | 'action' | 'info') {
    this.styleFilter.set(style);
  }

  styleOf(n: MemberNotification): NotificationStyle {
    return notificationStyle(n.kind);
  }

  setFilter(filter: NotificationFilter) {
    this.routingService.signals[Views.Notifications].urlParams.filter.set(filter);
  }

  // A notification relates to a grading whenever its data carries a
  // gradingDocId. We detect by that field rather than an allow-list of kinds so
  // every grading-related notification (current or future) links correctly.
  private gradingDocIdOf(n: MemberNotification): string | null {
    const data = n.data as { gradingDocId?: string } | undefined;
    return data?.gradingDocId || null;
  }

  isGradingNotification(n: MemberNotification): boolean {
    return this.gradingDocIdOf(n) !== null;
  }

  // Href to the grading detail view for grading notifications, else null.
  gradingHref(n: MemberNotification): string | null {
    const gradingDocId = this.gradingDocIdOf(n);
    if (!gradingDocId) {
      return null;
    }
    return this.routingService.hrefForView(Views.GradingView, {
      gradingId: gradingDocId,
    });
  }

  async onMarkRead(id: string) {
    try {
      await this.notificationService.dismissNotification(id);
    } catch (e) {
      console.error('Failed to mark notification read', e);
    }
  }

  async onMarkUnread(id: string) {
    try {
      await this.notificationService.markUnread(id);
    } catch (e) {
      console.error('Failed to mark notification unread', e);
    }
  }

  async onMarkAllRead() {
    try {
      await this.notificationService.dismissAll();
    } catch (e) {
      console.error('Failed to mark all notifications read', e);
    }
  }

  requestDelete(id: string) {
    this.confirmingDeleteId.set(id);
  }

  cancelDelete() {
    this.confirmingDeleteId.set(null);
  }

  async confirmDelete(id: string) {
    try {
      // Add to the deleting set to trigger CSS collapse/shrink animation
      this.deletingIds.update((set) => {
        const newSet = new Set(set);
        newSet.add(id);
        return newSet;
      });

      // Wait 300ms for the animation to complete before removal
      await new Promise((resolve) => setTimeout(resolve, 300));

      await this.notificationService.deleteNotification(id);
    } catch (e) {
      console.error('Failed to delete notification', e);
    } finally {
      this.deletingIds.update((set) => {
        const newSet = new Set(set);
        newSet.delete(id);
        return newSet;
      });
      this.confirmingDeleteId.set(null);
    }
  }
}
