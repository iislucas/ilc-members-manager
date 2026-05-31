/*
  This component displays a list of active member notifications at the top of the homepage.
  It manages its own data stream from NotificationService, filters by homepage visibility
  preferences, and handles dismissals and route transitions directly.

  Usage:
    <app-notifications-list></app-notifications-list>
*/

import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MemberNotification } from '../../../functions/src/data-model';
import { FirebaseStateService } from '../firebase-state.service';
import { NotificationService } from '../notification.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { MarkdownViewer } from '../markdown-editor/markdown-viewer';

@Component({
  selector: 'app-notifications-list',
  standalone: true,
  imports: [DatePipe, IconComponent, MarkdownViewer],
  templateUrl: './notifications-list.html',
  styleUrl: './notifications-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsListComponent {
  private firebaseService = inject(FirebaseStateService);
  private notificationService = inject(NotificationService);
  private routingService = inject(RoutingService);

  protected user = this.firebaseService.user;

  // Duration of the fold-up collapse animation; kept in sync with the
  // transition timing in notifications-list.scss.
  private static readonly COLLAPSE_MS = 280;

  // Ids of notifications currently playing their collapse animation. Kept
  // separate from the data so the card stays in the DOM long enough to fold
  // up before the underlying doc is dismissed and removed from the stream.
  protected collapsingIds = signal<ReadonlySet<string>>(new Set());

  notifications = computed(() => {
    const list = this.notificationService.notifications();
    const settings = this.user()?.member?.notificationSettings;
    return list.filter((n) => settings?.homeEnabled?.[n.kind] !== false);
  });

  private markCollapsing(...ids: string[]) {
    this.collapsingIds.update((s) => new Set([...s, ...ids]));
  }

  private clearCollapsing(...ids: string[]) {
    this.collapsingIds.update((s) => {
      const next = new Set(s);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  async onDismiss(id: string) {
    this.markCollapsing(id);
    await this.wait(NotificationsListComponent.COLLAPSE_MS);
    try {
      await this.notificationService.dismissNotification(id);
    } catch (e) {
      console.error('Failed to dismiss notification', e);
    } finally {
      this.clearCollapsing(id);
    }
  }

  async onDismissAll() {
    const ids = this.notifications().map((n) => n.docId);
    this.markCollapsing(...ids);
    await this.wait(NotificationsListComponent.COLLAPSE_MS);
    try {
      await this.notificationService.dismissAll();
    } catch (e) {
      console.error('Failed to dismiss all notifications', e);
    } finally {
      this.clearCollapsing(...ids);
    }
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

  // Returns an href to the grading detail view for grading notifications, or
  // null for non-grading notifications.
  gradingHref(n: MemberNotification): string | null {
    const gradingDocId = this.gradingDocIdOf(n);
    if (!gradingDocId) {
      return null;
    }
    return this.routingService.hrefForView(Views.GradingView, {
      gradingId: gradingDocId,
    });
  }
}
