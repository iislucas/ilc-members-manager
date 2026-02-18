import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  InstructorPublicData,
  Member,
} from '../../../functions/src/data-model';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-instructor-card',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './instructor-card.html',
  styleUrl: './instructor-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstructorCardComponent {
  instructor = input.required<InstructorPublicData>();

  ensureUrl(url: string | undefined): string {
    if (!url) {
      return '';
    }
    if (url.startsWith('http')) {
      return url;
    }
    return 'https://' + url;
  }

  getSearchUrl(): string {
    const query = encodeURIComponent(`${this.instructor().name} "I Liq Chuan"`);
    return `https://www.google.com/search?q=${query}`;
  }

  getMapsUrl(): string | undefined {
    const i = this.instructor();
    // Use the map only if we have more specific location info than just the country.
    if (!i.publicRegionOrCity && !i.publicCountyOrState) {
      return undefined;
    }

    const parts = [
      i.publicRegionOrCity,
      i.publicCountyOrState,
      i.country,
    ].filter((p) => !!p);

    if (parts.length === 0) {
      return undefined;
    }

    const query = encodeURIComponent(parts.join(', '));
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }
}
