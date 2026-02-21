import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../../data-manager.service';

@Component({
  selector: 'app-counters',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './counters.html',
  styleUrl: './counters.scss',
})
export class Counters {
  dataManager = inject(DataManagerService);

  countersDataRaw = signal<string>('');
  isSavingCounters = signal(false);
  countersMessage = signal('');

  constructor() {
    this.initCountersData();
  }

  initCountersData() {
    const counters = this.dataManager.counters();
    if (counters) {
      this.countersDataRaw.set(JSON.stringify(counters, null, 2));
    }
  }

  async saveCounters() {
    this.isSavingCounters.set(true);
    this.countersMessage.set('');
    try {
      const parsed = JSON.parse(this.countersDataRaw());
      await this.dataManager.saveCountersRaw(parsed);
      this.countersMessage.set('Counters saved successfully.');
    } catch (err: any) {
      this.countersMessage.set(`Error saving counters: ${err.message}`);
    } finally {
      this.isSavingCounters.set(false);
    }
  }
}
