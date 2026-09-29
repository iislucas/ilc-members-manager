/* vod-preview.ts
 *
 * Standalone component that renders a rich visual preview card for a VOD item
 * (single video, multi-part series, or external recording link).
 *
 * Features:
 * - Thumbnail image with 16:9 aspect ratio and duration pill
 * - Series vs. Single Video badge
 * - Total duration and recorded date
 * - Clickable title and "View Video / Series" link leading to /videos/:id
 * - Direct ID chip display
 * - Optional "Unlink" action button for edit forms
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { VideoItem, VideoSeries } from '../../../functions/src/data-model/vod';

export interface VodPreviewDetails {
  id: string;
  kind: 'series' | 'video' | 'external' | 'unknown';
  title: string;
  thumbnailUrl: string;
  durationText: string;
  formattedDate: string;
  videoCount?: number;
  watchHref: string;
}

@Component({
  selector: 'app-vod-preview',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './vod-preview.html',
  styleUrl: './vod-preview.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VodPreviewComponent {
  private dataService = inject(DataManagerService);
  private routingService = inject(RoutingService);

  videoId = input.required<string>();
  showUnlink = input<boolean>(false);
  unlink = output<void>();

  details = computed<VodPreviewDetails | null>(() => {
    const rawId = (this.videoId() || '').trim();
    if (!rawId) return null;

    // Check if it's an external URL
    if (rawId.startsWith('http://') || rawId.startsWith('https://')) {
      return {
        id: rawId,
        kind: 'external',
        title: rawId,
        thumbnailUrl: '',
        durationText: '',
        formattedDate: '',
        watchHref: rawId,
      };
    }

    const seriesList = typeof this.dataService.getVideoSeriesList === 'function'
      ? this.dataService.getVideoSeriesList()
      : [];
    const allVideos = this.dataService.videos?.entries
      ? (this.dataService.videos.entries() || [])
      : [];

    // 1. Check if rawId matches an existing series
    const matchedSeries = seriesList.find(
      (s) =>
        s.seriesId === rawId ||
        s.videos?.some((v) => v.seriesId === rawId || v.forVodPageId === rawId),
    );

    if (matchedSeries) {
      const firstEp = matchedSeries.videos?.[0];
      const watchVideoId = firstEp?.docId || rawId;
      return {
        id: matchedSeries.seriesId || rawId,
        kind: 'series',
        title: matchedSeries.title || `Series: ${rawId}`,
        thumbnailUrl: matchedSeries.thumbnailUrl || firstEp?.thumbnailUrl || '',
        durationText: this.formatDuration(matchedSeries.totalDurationSeconds),
        formattedDate: this.formatDate(matchedSeries.recordedDate || firstEp?.recordedDate),
        videoCount: matchedSeries.videoCount || matchedSeries.videos?.length || 1,
        watchHref: this.routingService.hrefForView(Views.VideoView, { videoId: watchVideoId }),
      };
    }

    // 2. Check if rawId matches an individual video
    const matchedVideo =
      (typeof this.dataService.videos?.get === 'function' ? this.dataService.videos.get(rawId) : undefined) ||
      allVideos.find((v) => v.docId === rawId);

    if (matchedVideo) {
      return {
        id: matchedVideo.docId,
        kind: 'video',
        title: matchedVideo.title || `Video: ${rawId}`,
        thumbnailUrl: matchedVideo.thumbnailUrl || '',
        durationText: this.formatDuration(matchedVideo.durationSeconds || 0),
        formattedDate: this.formatDate(matchedVideo.recordedDate),
        watchHref: this.routingService.hrefForView(Views.VideoView, { videoId: matchedVideo.docId }),
      };
    }

    // 3. Fallback for unrecognized ID
    return {
      id: rawId,
      kind: 'unknown',
      title: rawId,
      thumbnailUrl: '',
      durationText: '',
      formattedDate: '',
      watchHref: this.routingService.hrefForView(Views.VideoView, { videoId: rawId }),
    };
  });

  private formatDuration(seconds?: number): string {
    if (!seconds || seconds <= 0) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes > 0 ? `${minutes}m` : ''}`.trim();
    }
    return `${minutes}m`;
  }

  private formatDate(dateStr?: string): string {
    if (!dateStr) return '';
    const clean = dateStr.split('T')[0];
    const parts = clean.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      }
    }
    return clean;
  }
}
