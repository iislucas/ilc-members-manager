/* manage-vod-grant-page.ts
 *
 * Admin page to grant access to a video (/manage-vod/video/:videoId/grant) or
 * a series (/manage-vod/series/:seriesId/grant). Hosts GrantVodFormComponent
 * and shows a confirmation once access has been granted.
 */

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { AppPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { GrantVodFormComponent, GrantVodResult } from '../grant-vod-form/grant-vod-form';
import { VideoItem, VideoSeries, findSeriesForVideo } from '../../../functions/src/data-model/vod';

@Component({
  selector: 'app-manage-vod-grant-page',
  standalone: true,
  imports: [IconComponent, SpinnerComponent, GrantVodFormComponent],
  templateUrl: './manage-vod-grant-page.html',
  styleUrl: './manage-vod-grant-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageVodGrantPageComponent {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected dataService = inject(DataManagerService);

  readonly Views = Views;

  isSeriesPage = computed(() => this.routingService.matchedPatternId() === Views.ManageVodSeriesGrant);
  videoId = computed(() => this.routingService.signals[Views.ManageVodVideoGrant].pathVars.videoId() || '');
  seriesId = computed(() => this.routingService.signals[Views.ManageVodSeriesGrant].pathVars.seriesId() || '');

  // A video may not be in the cached catalog on a cold deep link.
  private fetchedVideo = signal<VideoItem | null>(null);
  fetchFailed = signal<boolean>(false);

  video = computed<VideoItem | null>(() => {
    if (this.isSeriesPage()) return null;
    const id = this.videoId();
    if (!id) return null;
    const fetched = this.fetchedVideo();
    return this.dataService.videos.get(id) ?? (fetched?.docId === id ? fetched : null);
  });

  series = computed<VideoSeries | null>(() => {
    if (!this.isSeriesPage()) return null;
    const id = this.seriesId();
    return this.dataService.getVideoSeriesList().find((s) => s.seriesId === id) ?? null;
  });

  parentSeries = computed<VideoSeries | null>(() => {
    const v = this.video();
    return v ? findSeriesForVideo(this.dataService.getVideoSeriesList(), v) : null;
  });

  /** Set after a successful grant; cleared to grant to someone else. */
  result = signal<GrantVodResult | null>(null);

  constructor() {
    effect(() => {
      if (this.isSeriesPage()) return;
      const id = this.videoId();
      if (!id || this.dataService.videos.get(id) || this.fetchedVideo()?.docId === id) return;
      this.fetchFailed.set(false);
      this.dataService
        .getVideoById(id)
        .then((v) => {
          if (v) this.fetchedVideo.set(v);
          else if (this.videoId() === id) this.fetchFailed.set(true);
        })
        .catch((err: unknown) => {
          console.error('Failed to load video:', err);
          if (this.videoId() === id) this.fetchFailed.set(true);
        });
    });
  }

  /** The "Who has access" tab of the page this grant belongs to. */
  accessHref(): string {
    return this.isSeriesPage()
      ? this.routingService.hrefForView(Views.ManageVodSeries, { seriesId: this.seriesId() }, { tab: 'access' })
      : this.routingService.hrefForView(Views.ManageVodVideo, { videoId: this.videoId() }, { tab: 'access' });
  }

  /** After granting, link to the access list of what was actually granted (video or its series). */
  grantedAccessHref(r: GrantVodResult): string {
    return r.targetType === 'series'
      ? this.routingService.hrefForView(Views.ManageVodSeries, { seriesId: r.targetId }, { tab: 'access' })
      : this.routingService.hrefForView(Views.ManageVodVideo, { videoId: r.targetId }, { tab: 'access' });
  }

  onGranted(r: GrantVodResult): void {
    this.result.set(r);
  }

  grantAnother(): void {
    this.result.set(null);
  }
}
