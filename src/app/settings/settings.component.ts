import { Component, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { AdminsSettingsComponent } from './admins/admins.component';
import { CountersComponent } from './counters/counters';
import { CountryCodesComponent } from './country-codes/country-codes';
import { Backups } from './backups/backups';
import { ContentCacheComponent } from './content-cache/content-cache';
import { ResourcesComponent } from './resources/resources';
import { LocalCacheSettingsComponent } from './local-cache/local-cache';
import { AppVersionSettingsComponent } from './app-version/app-version';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

// Valid tab identifiers for the settings page.
type SettingsTab = 'admins' | 'counters' | 'country-codes' | 'backups' | 'content-cache' | 'resources' | 'local-cache' | 'app-version';
const VALID_TABS: SettingsTab[] = ['admins', 'counters', 'country-codes', 'backups', 'content-cache', 'resources', 'local-cache', 'app-version'];
const DEFAULT_TAB: SettingsTab = 'admins';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    AdminsSettingsComponent,
    CountersComponent,
    CountryCodesComponent,
    Backups,
    ContentCacheComponent,
    ResourcesComponent,
    LocalCacheSettingsComponent,
    AppVersionSettingsComponent,
  ],
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
    if (urlTab === 'email-templates' || urlTab === 'notifications') {
      this.routingService.navigateToParts(['app-notifications']);
      return DEFAULT_TAB;
    }
    if (urlTab && VALID_TABS.includes(urlTab as SettingsTab)) {
      return urlTab as SettingsTab;
    }
    return DEFAULT_TAB;
  });

  setActiveTab(tab: SettingsTab) {
    this.viewSignals.urlParams.tab.set(tab);
  }
}
