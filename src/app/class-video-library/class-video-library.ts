/* class-video-library.ts
 *
 * Dedicated Class Video Library view for browsing Saturday class archives
 * and masterclasses, powered by VideosCatalogComponent in class_library mode.
 */

import { Component, ChangeDetectionStrategy } from '@angular/core';
import { VideosCatalogComponent } from '../videos-catalog/videos-catalog';

@Component({
  selector: 'app-class-video-library',
  standalone: true,
  imports: [VideosCatalogComponent],
  templateUrl: './class-video-library.html',
  styleUrl: './class-video-library.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassVideoLibraryComponent {}
