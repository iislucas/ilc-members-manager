/* series-grants-modal.ts
 *
 * Administrator modal dialog to inspect who has purchased, been gifted,
 * or been granted access to a video series.
 */

import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VideoSeries, VideoGrant, VideoGrantKind } from '../../../functions/src/data-model/vod';
import { Member } from '../../../functions/src/data-model/members';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

export interface SeriesGrantRecipient {
  recipientKey: string;
  memberDocId?: string;
  memberId?: string;
  memberName: string;
  memberEmail: string;
  member?: Member;
  hasFullSeries: boolean;
  grantedVideoCount: number;
  totalSeriesVideoCount: number;
  grantedVideoTitles: string[];
  primaryGrantKind: VideoGrantKind;
  grantKinds: VideoGrantKind[];
  latestGrantedAt: string;
  amountPaidCents?: number;
  orderDocId?: string;
  isGift: boolean;
  giftedByName?: string;
  giftedByEmail?: string;
  giftedByMemberDocId?: string;
  giftMessage?: string;
  notes?: string;
  expiresAt?: string;
  grants: VideoGrant[];
}

@Component({
  selector: 'app-series-grants-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './series-grants-modal.html',
  styleUrl: './series-grants-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeriesGrantsModalComponent {
  private dataService = inject(DataManagerService);
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  readonly Views = Views;
  readonly VideoGrantKind = VideoGrantKind;

  series = input<VideoSeries | null>(null);
  closed = output<void>();
  grantRequested = output<VideoSeries>();

  // Raw fetched grants
  rawGrants = signal<VideoGrant[]>([]);
  isLoading = signal<boolean>(true);
  errorMessage = signal<string | null>(null);

  // Search & Filter signals
  searchTerm = signal<string>('');
  grantKindFilter = signal<'all' | VideoGrantKind>('all');
  accessScopeFilter = signal<'all' | 'full' | 'partial'>('all');

  // Interactive feedback
  copiedEmailsToast = signal<boolean>(false);
  revokeConfirmRecipient = signal<SeriesGrantRecipient | null>(null);
  isRevoking = signal<boolean>(false);

  constructor() {
    effect(() => {
      const s = this.series();
      if (!s) {
        this.rawGrants.set([]);
        this.isLoading.set(false);
        return;
      }
      this.loadGrantsForSeries(s);
    });
  }

  async loadGrantsForSeries(s: VideoSeries): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    const targetIds = Array.from(
      new Set(
        [
          s.seriesId,
          ...(s.videos || []).map((v) => v.docId),
          ...(s.videos || []).map((v) => v.forVodPageId),
        ].filter(Boolean),
      ),
    ) as string[];

    try {
      const grants = await this.dataService.getSeriesGrants(targetIds);
      this.rawGrants.set(grants);
    } catch (err: unknown) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to load video grants for this series.',
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Transforms raw grants into aggregated recipient records.
   */
  recipients = computed<SeriesGrantRecipient[]>(() => {
    const s = this.series();
    const grants = this.rawGrants();
    if (!s || grants.length === 0) return [];

    const constituentVideos = s.videos || [];
    const constituentVideoMap = new Map(constituentVideos.map((v) => [v.docId, v]));
    const totalVideoCount = Math.max(s.videoCount || 0, constituentVideos.length, 1);

    const directSeriesTargetIds = new Set<string>([s.seriesId]);
    for (const v of constituentVideos) {
      if (v.seriesId) directSeriesTargetIds.add(v.seriesId);
      if (v.forVodPageId) directSeriesTargetIds.add(v.forVodPageId);
    }

    // Group grants by recipient
    const bucketMap = new Map<string, VideoGrant[]>();
    for (const grant of grants) {
      const key = (grant.memberDocId || grant.memberEmail || '').toLowerCase().trim();
      if (!key) continue;
      const list = bucketMap.get(key) || [];
      list.push(grant);
      bucketMap.set(key, list);
    }

    const result: SeriesGrantRecipient[] = [];

    for (const [, userGrants] of bucketMap) {
      const first = userGrants[0];
      const memberDocId = userGrants.find((g) => g.memberDocId)?.memberDocId || '';

      // Lookup member details
      let member: Member | undefined = undefined;
      if (memberDocId) {
        member = this.dataService.members.get(memberDocId);
      }
      if (!member && first.memberEmail) {
        const normEmail = first.memberEmail.toLowerCase().trim();
        member = this.dataService.members
          .entries()
          .find((m) => m.emails?.some((e) => e.toLowerCase().trim() === normEmail));
      }

      const memberName = member?.name || first.memberEmail || 'Unknown';
      const memberId = member?.memberId || '';
      const memberEmail = member?.emails?.[0] || first.memberEmail || '';

      // Check full series vs individual video grants
      const hasDirectSeriesGrant = userGrants.some((g) => directSeriesTargetIds.has(g.videoId));

      const grantedVideoIds = new Set(
        userGrants
          .map((g) => g.videoId)
          .filter((id) => !directSeriesTargetIds.has(id)),
      );

      const grantedVideoTitles: string[] = [];
      for (const vId of grantedVideoIds) {
        const item = constituentVideoMap.get(vId);
        grantedVideoTitles.push(item?.title || vId);
      }

      const grantedCount = hasDirectSeriesGrant
        ? totalVideoCount
        : constituentVideos.filter((v) => grantedVideoIds.has(v.docId)).length;

      const hasFullSeries =
        hasDirectSeriesGrant || (totalVideoCount > 0 && grantedCount >= totalVideoCount);

      // Determine primary grant kind
      const allKinds = userGrants.map((g) => g.grantKind);
      let primaryKind: VideoGrantKind = VideoGrantKind.AdminGrant;
      if (allKinds.includes(VideoGrantKind.StripePurchase)) {
        primaryKind = VideoGrantKind.StripePurchase;
      } else if (allKinds.includes(VideoGrantKind.GiftPurchase)) {
        primaryKind = VideoGrantKind.GiftPurchase;
      } else if (allKinds.includes(VideoGrantKind.EventAttendance)) {
        primaryKind = VideoGrantKind.EventAttendance;
      } else if (allKinds.includes(VideoGrantKind.Complimentary)) {
        primaryKind = VideoGrantKind.Complimentary;
      } else {
        primaryKind = allKinds[0] || VideoGrantKind.AdminGrant;
      }

      // Gift info
      const giftGrant = userGrants.find(
        (g) => g.grantKind === VideoGrantKind.GiftPurchase || Boolean(g.giftedByName),
      );
      const isGift = Boolean(giftGrant);

      // Latest granted date
      const allDates = userGrants.map((g) => g.grantedAt).filter(Boolean);
      allDates.sort();
      const latestGrantedAt = allDates[allDates.length - 1] || '';

      // Amount paid (if any) - deduplicate by orderDocId / stripeSessionId so bundled video grants aren't summed multiple times
      const orderAmounts = new Map<string, number>();
      let standaloneAmount = 0;
      for (const g of userGrants) {
        const cents = typeof g.amountPaidCents === 'number' ? g.amountPaidCents : 0;
        const orderKey = g.orderDocId || g.stripeSessionId;
        if (orderKey) {
          const current = orderAmounts.get(orderKey) ?? 0;
          orderAmounts.set(orderKey, Math.max(current, cents));
        } else {
          standaloneAmount += cents;
        }
      }
      let amountPaid = standaloneAmount;
      for (const cents of orderAmounts.values()) {
        amountPaid += cents;
      }

      // Order Doc ID
      const orderDocId = userGrants.find((g) => g.orderDocId)?.orderDocId;

      // Notes
      const notes = userGrants.find((g) => g.notes)?.notes;

      // Expiration
      const expiresAt = userGrants.find((g) => g.expiresAt)?.expiresAt;

      result.push({
        recipientKey: memberDocId || memberEmail,
        memberDocId: memberDocId || member?.docId,
        memberId,
        memberName,
        memberEmail,
        member,
        hasFullSeries,
        grantedVideoCount: grantedCount,
        totalSeriesVideoCount: totalVideoCount,
        grantedVideoTitles,
        primaryGrantKind: primaryKind,
        grantKinds: Array.from(new Set(allKinds)),
        latestGrantedAt,
        amountPaidCents: amountPaid > 0 ? amountPaid : undefined,
        orderDocId,
        isGift,
        giftedByName: giftGrant?.giftedByName,
        giftedByEmail: giftGrant?.giftedByEmail,
        giftedByMemberDocId: giftGrant?.giftedByMemberDocId,
        giftMessage: giftGrant?.giftMessage,
        notes,
        expiresAt,
        grants: userGrants,
      });
    }

    // Sort by latest granted date descending
    result.sort((a, b) => b.latestGrantedAt.localeCompare(a.latestGrantedAt));
    return result;
  });

  /**
   * Filtered list based on search term, grant kind filter, and scope filter.
   */
  filteredRecipients = computed<SeriesGrantRecipient[]>(() => {
    let list = this.recipients();
    const term = this.searchTerm().toLowerCase().trim();
    if (term) {
      list = list.filter((r) => {
        return (
          r.memberName.toLowerCase().includes(term) ||
          (r.memberId && r.memberId.toLowerCase().includes(term)) ||
          r.memberEmail.toLowerCase().includes(term) ||
          (r.giftedByName && r.giftedByName.toLowerCase().includes(term)) ||
          (r.giftedByEmail && r.giftedByEmail.toLowerCase().includes(term)) ||
          (r.notes && r.notes.toLowerCase().includes(term))
        );
      });
    }

    const kind = this.grantKindFilter();
    if (kind !== 'all') {
      list = list.filter((r) => r.primaryGrantKind === kind || r.grantKinds.includes(kind));
    }

    const scope = this.accessScopeFilter();
    if (scope === 'full') {
      list = list.filter((r) => r.hasFullSeries);
    } else if (scope === 'partial') {
      list = list.filter((r) => !r.hasFullSeries);
    }

    return list;
  });

  /**
   * Summary metrics for the series access.
   */
  summaryStats = computed(() => {
    const list = this.recipients();
    const totalCount = list.length;
    let purchasedCount = 0;
    let giftedCount = 0;
    let adminGrantedCount = 0;
    let fullSeriesCount = 0;
    let partialCount = 0;
    let totalRevenueCents = 0;

    for (const r of list) {
      if (r.primaryGrantKind === VideoGrantKind.StripePurchase) {
        purchasedCount++;
      } else if (r.primaryGrantKind === VideoGrantKind.GiftPurchase) {
        giftedCount++;
      } else {
        adminGrantedCount++;
      }

      if (r.hasFullSeries) {
        fullSeriesCount++;
      } else {
        partialCount++;
      }

      if (r.amountPaidCents) {
        totalRevenueCents += r.amountPaidCents;
      }
    }

    return {
      totalCount,
      purchasedCount,
      giftedCount,
      adminGrantedCount,
      fullSeriesCount,
      partialCount,
      totalRevenueDollars: (totalRevenueCents / 100).toFixed(2),
    };
  });

  close(): void {
    this.closed.emit();
  }

  openGrantModal(): void {
    const s = this.series();
    if (s) {
      this.grantRequested.emit(s);
    }
  }

  async copyAllEmails(): Promise<void> {
    const emails = Array.from(
      new Set(
        this.filteredRecipients()
          .map((r) => r.memberEmail)
          .filter(Boolean),
      ),
    );
    if (emails.length === 0) return;

    try {
      await navigator.clipboard.writeText(emails.join(', '));
      this.copiedEmailsToast.set(true);
      setTimeout(() => {
        this.copiedEmailsToast.set(false);
      }, 3000);
    } catch (err) {
      console.warn('Could not copy emails to clipboard:', err);
    }
  }

  promptRevoke(recipient: SeriesGrantRecipient): void {
    this.revokeConfirmRecipient.set(recipient);
  }

  cancelRevoke(): void {
    this.revokeConfirmRecipient.set(null);
  }

  async confirmRevoke(recipient: SeriesGrantRecipient): Promise<void> {
    this.isRevoking.set(true);
    try {
      for (const g of recipient.grants) {
        await this.dataService.revokeVideoGrant(g);
      }
      // Remove revoked grants from rawGrants signal
      const revokedGrantsSet = new Set(recipient.grants);
      this.rawGrants.update((list) => list.filter((g) => !revokedGrantsSet.has(g)));
      this.revokeConfirmRecipient.set(null);
    } catch (err: unknown) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to revoke video grant.',
      );
    } finally {
      this.isRevoking.set(false);
    }
  }

  formatDate(isoDate: string): string {
    if (!isoDate) return '—';
    try {
      const d = new Date(isoDate);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return isoDate;
    }
  }

  getGrantKindLabel(kind: VideoGrantKind): string {
    switch (kind) {
      case VideoGrantKind.StripePurchase:
        return 'Purchased';
      case VideoGrantKind.GiftPurchase:
        return 'Gifted';
      case VideoGrantKind.AdminGrant:
        return 'Admin Grant';
      case VideoGrantKind.Complimentary:
        return 'Complimentary';
      case VideoGrantKind.EventAttendance:
        return 'Event Attendee';
      default:
        return kind;
    }
  }

  getGrantKindBadgeClass(kind: VideoGrantKind): string {
    switch (kind) {
      case VideoGrantKind.StripePurchase:
        return 'badge-purchase';
      case VideoGrantKind.GiftPurchase:
        return 'badge-gift';
      case VideoGrantKind.AdminGrant:
        return 'badge-admin';
      case VideoGrantKind.Complimentary:
        return 'badge-complimentary';
      case VideoGrantKind.EventAttendance:
        return 'badge-event';
      default:
        return 'badge-default';
    }
  }
}
