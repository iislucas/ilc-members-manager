import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { DocsDataService, SearchResultItem } from '../../services/docs-data.service';

@Component({
  selector: 'doc-search-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './search-modal.component.html',
  styleUrl: './search-modal.component.scss',
})
export class SearchModalComponent {
  protected docs = inject(DocsDataService);

  onInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.docs.searchQuery.set(val);
  }

  selectResult(result: SearchResultItem): void {
    this.docs.switchView(result.view);
    this.docs.closeSearch();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('search-modal-backdrop')) {
      this.docs.closeSearch();
    }
  }
}
