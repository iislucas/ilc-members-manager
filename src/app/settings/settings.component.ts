import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Counters } from './counters/counters';
import { CountryCodes } from './country-codes/country-codes';
import { Backups } from './backups/backups';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, Counters, CountryCodes, Backups],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent {
  activeTab: WritableSignal<'counters' | 'static' | 'backups'> = signal('counters');

  setActiveTab(tab: 'counters' | 'static' | 'backups') {
    this.activeTab.set(tab);
  }
}
