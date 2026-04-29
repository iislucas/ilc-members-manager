import { Component, computed, inject } from '@angular/core';
import { ImportMembersComponent } from './import-members/import-members.component';
import { ImportSchoolsComponent } from './import-schools/import-schools.component';
import { ImportOrdersComponent } from './import-orders/import-orders.component';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

type Tab = 'members' | 'schools' | 'orders';
const VALID_TABS: Tab[] = ['members', 'schools', 'orders'];
const DEFAULT_TAB: Tab = 'members';

@Component({
  selector: 'app-import-export',
  standalone: true,
  imports: [ImportMembersComponent, ImportSchoolsComponent, ImportOrdersComponent],
  templateUrl: './import-export.html',
  styleUrl: './import-export.scss',
})
export class ImportExportComponent {
  private routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  private viewSignals = this.routingService.signals[Views.ImportExport];

  // Derive the active tab from the URL `tab` parameter.
  activeTab = computed<Tab>(() => {
    const urlTab = this.viewSignals.urlParams.tab();
    if (urlTab && VALID_TABS.includes(urlTab as Tab)) {
      return urlTab as Tab;
    }
    return DEFAULT_TAB;
  });

  setActiveTab(tab: Tab) {
    this.viewSignals.urlParams.tab.set(tab);
  }
}
