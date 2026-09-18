/* offline-banner.component.ts
 *
 * Warning area banner displayed below header when offline, reconnecting,
 * or when offline queued actions or sync conflicts require attention.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { NetworkStateService } from '../network-state.service';
import { ActionQueueService } from '../action-queue.service';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-offline-banner',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './offline-banner.component.html',
  styleUrl: './offline-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfflineBannerComponent {
  networkState = inject(NetworkStateService);
  actionQueue = inject(ActionQueueService);
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  queueHref = computed(() => this.routingService.hrefForView(Views.OfflineActionQueue));

  isChecking = signal<boolean>(false);

  isOffline = this.networkState.isOffline;
  isReconnecting = this.networkState.isReconnecting;
  isSyncing = this.actionQueue.isSyncing;
  pendingCount = this.actionQueue.pendingCount;
  conflictCount = this.actionQueue.conflictCount;
  hasPending = this.actionQueue.hasPending;

  isVisible = computed(() => {
    return (
      this.isOffline() ||
      this.isReconnecting() ||
      this.isSyncing() ||
      this.conflictCount() > 0
    );
  });

  statusMessage = computed(() => {
    if (this.conflictCount() > 0) {
      const count = this.conflictCount();
      return `Sync conflict detected in ${count} edit${count === 1 ? '' : 's'}. Review to choose which changes to keep.`;
    }
    if (this.isSyncing()) {
      return 'Synchronizing offline queued edits...';
    }
    if (this.isReconnecting()) {
      return this.networkState.statusMessage() || 'Logging back in and reconnecting...';
    }
    return 'You are currently offline. Edits are saved locally and some data may be out of date.';
  });

  async checkConnection(): Promise<void> {
    if (this.isChecking()) return;
    this.isChecking.set(true);
    try {
      await this.networkState.checkConnection();
    } finally {
      this.isChecking.set(false);
    }
  }

  viewQueue(): void {
    this.actionQueue.openDialog();
  }

  syncNow(): void {
    if (this.isOffline() || this.isSyncing()) return;
    this.actionQueue.syncQueue();
  }
}
