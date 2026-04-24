import { Component, signal, WritableSignal, ChangeDetectionStrategy } from '@angular/core';
import { CountersComponent } from './counters/counters';
import { CountryCodesComponent } from './country-codes/country-codes';
import { Backups } from './backups/backups';
import { ContentCacheComponent } from './content-cache/content-cache';
import { ResourcesComponent } from './resources/resources';

type SettingsTab = 'counters' | 'country-codes' | 'backups' | 'content-cache' | 'resources';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CountersComponent, CountryCodesComponent, Backups, ContentCacheComponent, ResourcesComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  activeTab: WritableSignal<SettingsTab> = signal('counters');

  setActiveTab(tab: SettingsTab) {
    this.activeTab.set(tab);
  }
}
