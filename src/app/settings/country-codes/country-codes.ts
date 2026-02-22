import { Component, inject, signal, OnInit } from '@angular/core';
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
export class CountryCodes implements OnInit {
  dataManager = inject(DataManagerService);

  countryCodes = signal<CountryCode[]>([]);
  isLoading = signal(false);
  isSaving = signal(false);
  statusMessage = signal('');

  ngOnInit() {
    this.loadCountryCodes();
  }

  loadCountryCodes() {
    // dataManager.countries is a SearchableSet populated via sync loop.
    const currentCodes = this.dataManager.countries.entries();
    if (currentCodes && currentCodes.length > 0) {
      this.countryCodes.set(currentCodes.map(c => ({ ...c })));
    } else {
      // Wait a moment for dataManager sync to populate
      this.isLoading.set(true);
      const checkInterval = setInterval(() => {
        const codes = this.dataManager.countries.entries();
        if (codes.length > 0) {
          this.countryCodes.set(codes.map(c => ({ ...c })));
          this.isLoading.set(false);
          clearInterval(checkInterval);
        }
      }, 200);
    }
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
      const docData: CountryCodesDoc = { codes: this.countryCodes() };
      await this.dataManager.saveStaticDoc('country-codes', docData);
      this.statusMessage.set('Saved successfully.');
    } catch (err: any) {
      this.statusMessage.set(`Error: ${err.message}`);
    } finally {
      this.isSaving.set(false);
    }
  }
}
