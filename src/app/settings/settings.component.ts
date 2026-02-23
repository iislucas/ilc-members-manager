import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CountersComponent } from './counters/counters';
import { CountryCodesComponent } from './country-codes/country-codes';
import { Backups } from './backups/backups';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, CountersComponent, CountryCodesComponent, Backups],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent {
  activeTab: WritableSignal<'counters' | 'country-codes' | 'backups'> = signal('counters');

  setActiveTab(tab: 'counters' | 'country-codes' | 'backups') {
    this.activeTab.set(tab);
  }
}
