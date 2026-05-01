import { Component, inject, signal, linkedSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../../data-manager.service';
import { IconComponent } from '../../icons/icon.component';
import { Counters } from '../../../../functions/src/data-model';

@Component({
  selector: 'app-counters',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './counters.html',
  styleUrl: './counters.scss',
})
export class CountersComponent {
  dataManager = inject(DataManagerService);

  memberIdCounters = linkedSignal<{ countryCode: string, countryName: string, value: number }[]>(() => {
    const counters = this.dataManager.counters();
    if (!counters) return [];
    return Object.entries(counters.memberIdCounters || {})
      .map(([countryCode, value]) => ({
        countryCode,
        countryName: this.dataManager.countries.get(countryCode)?.name || '',
        value,
      }))
      .sort((a, b) => a.countryCode.localeCompare(b.countryCode));
  });

  instructorIdCounter = linkedSignal<number>(() => this.dataManager.counters()?.instructorIdCounter || 0);
  schoolIdCounter = linkedSignal<number>(() => this.dataManager.counters()?.schoolIdCounter || 0);

  isSavingCounters = signal(false);
  countersMessage = signal('');

  addMemberIdCounter() {
    this.memberIdCounters.update(counters => [...counters, { countryCode: '', countryName: '', value: 0 }]);
  }

  removeMemberIdCounter(index: number) {
    this.memberIdCounters.update(counters => {
      const newCounters = [...counters];
      newCounters.splice(index, 1);
      return newCounters;
    });
  }

  async saveCounters() {
    this.isSavingCounters.set(true);
    this.countersMessage.set('');
    try {
      const memberIdMap: Record<string, number> = {};
      for (const counter of this.memberIdCounters()) {
        if (counter.countryCode.trim()) {
          memberIdMap[counter.countryCode.trim()] = Number(counter.value);
        }
      }

      const countersToSave = {
        memberIdCounters: memberIdMap,
        instructorIdCounter: Number(this.instructorIdCounter()),
        schoolIdCounter: Number(this.schoolIdCounter())
      } as Counters;

      await this.dataManager.saveCounters(countersToSave);
      this.countersMessage.set('Counters saved successfully.');
    } catch (err: any) {
      this.countersMessage.set(`Error saving counters: ${err.message}`);
    } finally {
      this.isSavingCounters.set(false);
    }
  }
}
