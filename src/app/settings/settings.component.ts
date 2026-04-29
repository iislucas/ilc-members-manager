import { Component, computed, effect, inject, ChangeDetectionStrategy } from '@angular/core';
import { CountersComponent } from './counters/counters';
import { CountryCodesComponent } from './country-codes/country-codes';
import { Backups } from './backups/backups';
import { ContentCacheComponent } from './content-cache/content-cache';
import { ResourcesComponent } from './resources/resources';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

// Valid tab identifiers for the settings page.
type SettingsTab = 'counters' | 'country-codes' | 'backups' | 'content-cache' | 'resources';
const VALID_TABS: SettingsTab[] = ['counters', 'country-codes', 'backups', 'content-cache', 'resources'];
const DEFAULT_TAB: SettingsTab = 'counters';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CountersComponent, CountryCodesComponent, Backups, ContentCacheComponent, ResourcesComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  private routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  private viewSignals = this.routingService.signals[Views.Settings];

  // Derive the active tab from the URL `tab` parameter.
  activeTab = computed<SettingsTab>(() => {
    const urlTab = this.viewSignals.urlParams.tab();
    if (urlTab && VALID_TABS.includes(urlTab as SettingsTab)) {
      return urlTab as SettingsTab;
    }
    return DEFAULT_TAB;
  });

  setActiveTab(tab: SettingsTab) {
    this.viewSignals.urlParams.tab.set(tab);
  }
}
