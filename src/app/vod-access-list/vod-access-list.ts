/* vod-access-list.ts
 *
 * Embeddable administrator panel listing who has purchased, been gifted, or
 * been granted access to a single video or to a whole video series, with
 * search/filter, revoke, and an entry point to grant/gift further access.
 *
 * Used as the "Who has access" tab on the dedicated admin pages for a video
 * (/manage-vod/video/:videoId) and for a series (/manage-vod/series/:seriesId).
 */

import {
  Component,
  input,
  signal,
  computed,
  effect,
  inject,
  ChangeDetectionStrategy,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VideoItem, VideoSeries, VideoGrant, VideoGrantKind } from '../../../functions/src/data-model/vod';
import { Member } from '../../../functions/src/data-model/members';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

export interface VodGrantRecipient {
  recipientKey: string;
  memberDocId?: string;
  memberId?: string;
  memberName: string;
  memberEmail: string;
  member?: Member;
  hasFullSeries: boolean;
  /** True when access comes from a grant on the whole series (vs. individual videos). */
  viaSeriesGrant: boolean;
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
  selector: 'app-vod-access-list',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './vod-access-list.html',
  styleUrl: './vod-access-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VodAccessListComponent {
  private dataService = inject(DataManagerService);
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  readonly Views = Views;
  readonly VideoGrantKind = VideoGrantKind;

  /** Provide exactly one of `series` or `video`. */
  series = input<VideoSeries | null>(null);
  video = input<VideoItem | null>(null);
  /**
   * In video mode, the series containing the video as resolved by the page
   * (covers series grouped by title pattern that have no explicit seriesId).
   */
  parentSeries = input<VideoSeries | null>(null);

  /** True when listing access for a single video rather than a whole series. */
  isVideoMode = computed(() => !this.series() && Boolean(this.video()));

  /**
   * The series-shaped target whose grants are listed. A single video is
   * modelled as a one-episode series keyed by its parent series id (if any),
   * so that whole-series grants are correctly counted as access to the video.
   */
  target = computed<VideoSeries | null>(() => {
    const s = this.series();
    if (s) return s;
    const v = this.video();
    if (!v) return null;
    return {
      seriesId: this.parentSeries()?.seriesId || v.seriesId || v.forVodPageId || '',
      title: v.title,
      description: v.description,
      tags: v.tags || [],
      videoCount: 1,
      totalDurationSeconds: v.durationSeconds || 0,
      videos: [v],
    };
  });

  /** Ids whose grants confer access to the whole series (vs. individual episodes). */
  seriesTargetIds = computed<Set<string>>(() => {
    const ids = new Set<string>();
    const t = this.target();
    if (!t) return ids;
    if (t.seriesId) ids.add(t.seriesId);
    for (const v of t.videos || []) {
      if (v.seriesId) ids.add(v.seriesId);
      if (v.forVodPageId) ids.add(v.forVodPageId);
    }
    return ids;
  });

  /** All grant target ids to fetch; the stable key that drives (re)loading. */
  private grantTargetIds = computed<string[]>(() => {
    const t = this.target();
    if (!t) return [];
    const ids = new Set<string>(this.seriesTargetIds());
    for (const v of t.videos || []) ids.add(v.docId);
    return Array.from(ids).filter(Boolean).sort();
  }, { equal: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) });

  /** Incremented per load so that out-of-order responses are discarded. */
  private loadToken = 0;

  /** Title of whatever is being listed (series or video). */
  targetTitle = computed(() => this.series()?.title || this.video()?.title || '');


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
  revokeConfirmRecipient = signal<VodGrantRecipient | null>(null);
  isRevoking = signal<boolean>(false);

  constructor() {
    // Only refetch when the set of target ids changes, not whenever the parent
    // hands us a new (but equivalent) series/video object after a catalog update.
    effect(() => {
      const ids = this.grantTargetIds();
      untracked(() => this.loadGrants(ids));
    });
  }

  async loadGrants(targetIds: string[] = this.grantTargetIds()): Promise<void> {
    const token = ++this.loadToken;
    if (targetIds.length === 0) {
      this.rawGrants.set([]);
      this.isLoading.set(false);
      return;
    }
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const grants = await this.dataService.getSeriesGrants(targetIds);
      if (token === this.loadToken) this.rawGrants.set(grants);
    } catch (err: unknown) {
      if (token === this.loadToken) {
        this.errorMessage.set(err instanceof Error ? err.message : 'Failed to load access records.');
      }
    } finally {
      if (token === this.loadToken) this.isLoading.set(false);
    }
  }

  /**
   * Transforms raw grants into aggregated recipient records.
   */
  recipients = computed<VodGrantRecipient[]>(() => {
    const s = this.target();
    const grants = this.rawGrants();
    if (!s || grants.length === 0) return [];

    const constituentVideos = s.videos || [];
    const constituentVideoMap = new Map(constituentVideos.map((v) => [v.docId, v]));
    const totalVideoCount = Math.max(s.videoCount || 0, constituentVideos.length, 1);

    const directSeriesTargetIds = this.seriesTargetIds();

    // Group grants by recipient
    const bucketMap = new Map<string, VideoGrant[]>();
    for (const grant of grants) {
      const key = (grant.memberDocId || grant.memberEmail || '').toLowerCase().trim();
      if (!key) continue;
      const list = bucketMap.get(key) || [];
      list.push(grant);
      bucketMap.set(key, list);
    }

    const result: VodGrantRecipient[] = [];

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
        (g) => g.grantKind === VideoGrantKind.GiftPurchase,
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
        viaSeriesGrant: hasDirectSeriesGrant,
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
  filteredRecipients = computed<VodGrantRecipient[]>(() => {
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
      // Legacy "complimentary" grants are admin grants too.
      const kinds = kind === VideoGrantKind.AdminGrant ? [kind, VideoGrantKind.Complimentary] : [kind];
      list = list.filter((r) => r.grantKinds.some((k) => kinds.includes(k)));
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

      const countsAsScope = this.isVideoMode() ? r.viaSeriesGrant : r.hasFullSeries;
      if (countsAsScope) {
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

  /** The grant page for whatever this list shows. */
  grantHref(): string {
    const s = this.series();
    if (s) return this.routingService.hrefForView(Views.ManageVodSeriesGrant, { seriesId: s.seriesId });
    return this.routingService.hrefForView(Views.ManageVodVideoGrant, { videoId: this.video()?.docId || '' });
  }

  /**
   * Grants that revoking from this list removes. On a single video's list,
   * whole-series grants are left alone (they would remove access to every
   * episode); those must be revoked from the series page.
   */
  revocableGrants(recipient: VodGrantRecipient): VideoGrant[] {
    if (!this.isVideoMode()) return recipient.grants;
    const seriesIds = this.seriesTargetIds();
    return recipient.grants.filter((g) => !seriesIds.has(g.videoId));
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.grantKindFilter.set('all');
    this.accessScopeFilter.set('all');
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

  promptRevoke(recipient: VodGrantRecipient): void {
    this.revokeConfirmRecipient.set(recipient);
  }

  cancelRevoke(): void {
    this.revokeConfirmRecipient.set(null);
  }

  async confirmRevoke(recipient: VodGrantRecipient): Promise<void> {
    this.isRevoking.set(true);
    try {
      const toRevoke = this.revocableGrants(recipient);
      for (const g of toRevoke) {
        await this.dataService.revokeVideoGrant(g);
      }
      // Remove revoked grants from rawGrants signal
      const revokedGrantsSet = new Set(toRevoke);
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
      case VideoGrantKind.Complimentary: // legacy admin grant type
        return 'Admin Grant';
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
