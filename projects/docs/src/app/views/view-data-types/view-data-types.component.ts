import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { DocsDataService } from '../../services/docs-data.service';

@Component({
  selector: 'doc-view-data-types',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './view-data-types.component.html',
  styleUrl: './view-data-types.component.scss',
})
export class ViewDataTypesComponent {
  protected docs = inject(DocsDataService);

  // Map of dataTypeId -> detail level (1 | 2 | 3)
  readonly activeLevels = signal<Record<string, number>>({});
  readonly copiedInterfaceId = signal<string | null>(null);

  getLevel(dataTypeId: string): number {
    return this.activeLevels()[dataTypeId] || 1;
  }

  setLevel(dataTypeId: string, level: number): void {
    this.activeLevels.update((prev) => ({
      ...prev,
      [dataTypeId]: level,
    }));
  }

  async copyInterface(tsInterface: string, id: string): Promise<void> {
    const ok = await this.docs.copyToClipboard(tsInterface);
    if (ok) {
      this.copiedInterfaceId.set(id);
      setTimeout(() => {
        this.copiedInterfaceId.set(null);
      }, 2000);
    }
  }
}
