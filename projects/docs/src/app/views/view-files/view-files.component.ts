import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { DocsDataService } from '../../services/docs-data.service';
import { CodeFileEntry } from '../../../../../../docs/lib/src';

@Component({
  selector: 'doc-view-files',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './view-files.component.html',
  styleUrl: './view-files.component.scss',
})
export class ViewFilesComponent {
  protected docs = inject(DocsDataService);

  readonly selectedLayer = signal<string>('all');
  readonly fileFilterQuery = signal<string>('');

  readonly layerOptions = computed(() => {
    return Object.keys(this.docs.filesSummary.layers).sort();
  });

  readonly filteredFiles = computed<CodeFileEntry[]>(() => {
    const layer = this.selectedLayer();
    const query = this.fileFilterQuery().toLowerCase().trim();

    return this.docs.filesCatalog.filter((f) => {
      const matchLayer = layer === 'all' || f.layer === layer;
      const matchQuery = !query || f.path.toLowerCase().includes(query) || f.responsibility.toLowerCase().includes(query);
      return matchLayer && matchQuery;
    });
  });
}
