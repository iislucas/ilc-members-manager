/* manage-vod-video-page.ts
 *
 * Dedicated admin page for a single VOD video at /manage-vod/video/:videoId,
 * with URL-synced pill tabs:
 *   - overview: summary of the video (status, access, series membership)
 *   - access:   who has access (purchases, gifts, grants) + grant/gift/revoke
 *   - details:  editable metadata, thumbnail, access & pricing form
 */

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { VodAccessListComponent } from '../vod-access-list/vod-access-list';
import { ManageVodEditVideoComponent } from '../manage-vod-edit-video/manage-vod-edit-video';
import {
  VideoItem,
  VideoSeries,
  VodAccessTier,
  VodStatus,
  findSeriesForVideo,
  getVodFreeAccessLabel,
  getVodFreeAccessTier,
  hasClassVideoSubscriberAccess,
} from '../../../functions/src/data-model/vod';
import { VOD_ADMIN_TABS, VodAdminTab, formatVodDuration, parseVodAdminTab } from '../vod-admin-tabs';

@Component({
  selector: 'app-manage-vod-video-page',
  standalone: true,
  imports: [IconComponent, SpinnerComponent, VodAccessListComponent, ManageVodEditVideoComponent],
  templateUrl: './manage-vod-video-page.html',
  styleUrl: './manage-vod-video-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageVodVideoPageComponent {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected dataService = inject(DataManagerService);

  readonly Views = Views;
  readonly VodStatus = VodStatus;
  readonly formatDuration = formatVodDuration;
  readonly tabs = VOD_ADMIN_TABS;

  private viewSignals = this.routingService.signals[Views.ManageVodVideo];

  videoId = computed(() => this.viewSignals.pathVars.videoId() || '');
  activeTab = computed<VodAdminTab>(() => parseVodAdminTab(this.viewSignals.urlParams.tab()));

  // Fallback for videos not (yet) in the cached catalog, e.g. on a cold deep link.
  private fetchedVideo = signal<VideoItem | null>(null);
  fetchFailed = signal<boolean>(false);

  video = computed<VideoItem | null>(() => {
    const id = this.videoId();
    if (!id) return null;
    const fetched = this.fetchedVideo();
    return this.dataService.videos.get(id) ?? (fetched?.docId === id ? fetched : null);
  });

  series = computed<VideoSeries | null>(() => {
    const v = this.video();
    return v ? findSeriesForVideo(this.dataService.getVideoSeriesList(), v) : null;
  });

  partNumber = computed<number>(() => {
    const s = this.series();
    const v = this.video();
    if (!s || !v) return 0;
    const idx = s.videos.findIndex((item) => item.docId === v.docId);
    return idx >= 0 ? idx + 1 : v.seriesPartIndex || 0;
  });

  /** Access settings are series-wide for episodes, so read them from the series when present. */
  accessSource = computed<{ accessTiers?: VodAccessTier[]; accessTier?: VodAccessTier } | null>(
    () => this.series() ?? this.video(),
  );
  freeAccessLabel = computed(() => {
    const src = this.accessSource();
    return src ? getVodFreeAccessLabel(getVodFreeAccessTier(src)) : '';
  });
  hasClassSub = computed(() => {
    const src = this.accessSource();
    return src ? hasClassVideoSubscriberAccess(src) : false;
  });
  priceCents = computed<number>(() => {
    const s = this.series();
    if (s) return s.priceCents || 0;
    return this.video()?.priceCents || 0;
  });

  constructor() {
    effect(() => {
      const id = this.videoId();
      if (!id || this.dataService.videos.get(id) || this.fetchedVideo()?.docId === id) return;
      this.fetchFailed.set(false);
      this.dataService
        .getVideoById(id)
        .then((v) => {
          if (v) {
            this.fetchedVideo.set(v);
          } else if (this.videoId() === id) {
            this.fetchFailed.set(true);
          }
        })
        .catch((err: unknown) => {
          console.error('Failed to load video:', err);
          if (this.videoId() === id) this.fetchFailed.set(true);
        });
    });
  }

  setTab(tab: VodAdminTab): void {
    this.viewSignals.urlParams.tab.set(tab);
  }

  tabHref(tab: VodAdminTab): string {
    return this.routingService.hrefForView(Views.ManageVodVideo, { videoId: this.videoId() }, { tab });
  }

  watchHref(): string {
    return this.routingService.hrefForView(Views.VideoView, { videoId: this.videoId() });
  }

  seriesHref(series: VideoSeries): string {
    return this.routingService.hrefForView(Views.ManageVodSeries, { seriesId: series.seriesId }, { tab: 'overview' });
  }
}
