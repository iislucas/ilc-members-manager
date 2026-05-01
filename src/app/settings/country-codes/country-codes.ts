import { Component, inject, signal, linkedSignal } from '@angular/core';
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

  countryCodes = linkedSignal<CountryCode[]>(() =>
    [...this.dataManager.countries.entries()].sort((a, b) => a.id.localeCompare(b.id))
  );
  isSaving = signal(false);
  statusMessage = signal('');

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
