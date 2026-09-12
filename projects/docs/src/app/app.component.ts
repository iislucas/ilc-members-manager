/* app.component.ts
 *
 * Root shell component for the ILC Documentation Application.
 */

import { Component, ChangeDetectionStrategy, inject, HostListener } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { DocsDataService, DocsViewId } from './services/docs-data.service';
import { SearchModalComponent } from './components/search-modal/search-modal.component';
import { ViewSetupComponent } from './views/view-setup/view-setup.component';
import { ViewUserJourneysComponent } from './views/view-user-journeys/view-user-journeys.component';
import { ViewDataTypesComponent } from './views/view-data-types/view-data-types.component';
import { ViewArchitectureComponent } from './views/view-architecture/view-architecture.component';
import { ViewPatternsComponent } from './views/view-patterns/view-patterns.component';
import { ViewFilesComponent } from './views/view-files/view-files.component';

@Component({
  selector: 'doc-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    KeyValuePipe,
    SearchModalComponent,
    ViewSetupComponent,
    ViewUserJourneysComponent,
    ViewDataTypesComponent,
    ViewArchitectureComponent,
    ViewPatternsComponent,
    ViewFilesComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppDocsRootComponent {
  protected docs = inject(DocsDataService);

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.docs.openSearch();
    } else if (event.key === 'Escape' && this.docs.searchOpen()) {
      this.docs.closeSearch();
    }
  }

  onViewClick(view: DocsViewId) {
    this.docs.switchView(view);
  }
}
