import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CountersComponent } from './counters/counters';
import { CountryCodesComponent } from './country-codes/country-codes';
import { Backups } from './backups/backups';
import { ContentCacheComponent } from './content-cache/content-cache';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, CountersComponent, CountryCodesComponent, Backups, ContentCacheComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent {
  activeTab: WritableSignal<'counters' | 'country-codes' | 'backups' | 'content-cache'> = signal('counters');

  setActiveTab(tab: 'counters' | 'country-codes' | 'backups' | 'content-cache') {
    this.activeTab.set(tab);
  }
}
