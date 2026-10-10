/* manage-vod-series-page.ts
 *
 * Dedicated admin page for a VOD series at /manage-vod/series/:seriesId,
 * with URL-synced pill tabs:
 *   - overview: summary of the series and its episodes (each linking to its video page)
 *   - access:   who has access (purchases, gifts, grants) + grant/gift/revoke
 *   - details:  editable series metadata, access & pricing, and episode membership/order
 */

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { VodAccessListComponent } from '../vod-access-list/vod-access-list';
import { ManageVodEditSeriesComponent } from '../manage-vod-edit-series/manage-vod-edit-series';
import {
  VideoItem,
  VideoSeries,
  VodStatus,
  getVodFreeAccessLabel,
  getVodFreeAccessTier,
  hasClassVideoSubscriberAccess,
} from '../../../functions/src/data-model/vod';
import { VOD_ADMIN_TABS, VodAdminTab, formatVodDuration, parseVodAdminTab } from '../vod-admin-tabs';

@Component({
  selector: 'app-manage-vod-series-page',
  standalone: true,
  imports: [IconComponent, SpinnerComponent, VodAccessListComponent, ManageVodEditSeriesComponent],
  templateUrl: './manage-vod-series-page.html',
  styleUrl: './manage-vod-series-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageVodSeriesPageComponent {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected dataService = inject(DataManagerService);

  readonly Views = Views;
  readonly VodStatus = VodStatus;
  readonly formatDuration = formatVodDuration;
  readonly tabs = VOD_ADMIN_TABS;

  private viewSignals = this.routingService.signals[Views.ManageVodSeries];

  seriesId = computed(() => this.viewSignals.pathVars.seriesId() || '');
  activeTab = computed<VodAdminTab>(() => parseVodAdminTab(this.viewSignals.urlParams.tab()));

  series = computed<VideoSeries | null>(() => {
    const id = this.seriesId();
    if (!id) return null;
    return this.dataService.getVideoSeriesList().find((s) => s.seriesId === id) ?? null;
  });

  freeAccessLabel = computed(() => {
    const s = this.series();
    return s ? getVodFreeAccessLabel(getVodFreeAccessTier(s)) : '';
  });
  hasClassSub = computed(() => {
    const s = this.series();
    return s ? hasClassVideoSubscriberAccess(s) : false;
  });
  /** Thumbnail of the series, falling back to the first episode's poster. */
  thumbnailUrl = computed(() => {
    const s = this.series();
    return s?.thumbnailUrl || s?.videos.find((v) => v.thumbnailUrl)?.thumbnailUrl || '';
  });

  setTab(tab: VodAdminTab): void {
    this.viewSignals.urlParams.tab.set(tab);
  }

  videoAdminHref(video: VideoItem): string {
    return this.routingService.hrefForView(Views.ManageVodVideo, { videoId: video.docId }, { tab: 'overview' });
  }

  watchFirstEpisodeHref(): string | null {
    const first = this.series()?.videos[0];
    return first ? this.routingService.hrefForView(Views.VideoView, { videoId: first.docId }) : null;
  }
}
