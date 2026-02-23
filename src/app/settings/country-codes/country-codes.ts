import { Component, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../../data-manager.service';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { CountryCode, CountryCodesDoc } from '../../country-codes';
import { IconComponent } from '../../icons/icon.component';

@Component({
  selector: 'app-country-codes',
  standalone: true,
  imports: [CommonModule, FormsModule, SpinnerComponent, IconComponent],
  templateUrl: './country-codes.html',
  styleUrl: './country-codes.scss',
})
export class CountryCodesComponent {
  dataManager = inject(DataManagerService);

  countryCodes = signal<CountryCode[]>([]);
  isSaving = signal(false);
  statusMessage = signal('');

  constructor() {
    // Populate the country codes from the data manager once loaded.
    effect(() => {
      const loaded = !this.dataManager.countries.loading();
      const entries = this.dataManager.countries.entries();
      if (loaded) {
        untracked(() => {
          this.countryCodes.set(JSON.parse(JSON.stringify(entries)));
        });
      }
    });
  }

  addCountryCode() {
    this.countryCodes.update(codes => [...codes, { id: '', name: '' }]);
  }

  removeCountryCode(index: number) {
    this.countryCodes.update(codes => {
      const newCodes = [...codes];
      newCodes.splice(index, 1);
      return newCodes;
    });
  }

  async saveCountryCodes() {
    this.isSaving.set(true);
    this.statusMessage.set('');
    try {
      await this.dataManager.saveCountryCodes({ codes: this.countryCodes() });
      this.statusMessage.set('Saved successfully.');
    } catch (err: any) {
      this.statusMessage.set(`Error: ${err.message}`);
    } finally {
      this.isSaving.set(false);
    }
  }
}
