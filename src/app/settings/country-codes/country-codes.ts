import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../../data-manager.service';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { CountryCode, CountryCodesDoc } from '../../country-codes';

@Component({
  selector: 'app-country-codes',
  standalone: true,
  imports: [CommonModule, FormsModule, SpinnerComponent],
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

  async loadCountryCodes() {
    this.isLoading.set(true);
    try {
      const docs = await this.dataManager.getStaticDocs();
      const countryCodesDoc = docs.find((d: any) => d.id === 'country-codes');
      if (countryCodesDoc && countryCodesDoc.data) {
        this.countryCodes.set((countryCodesDoc.data as CountryCodesDoc).codes || []);
      } else {
        this.countryCodes.set([]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      this.isLoading.set(false);
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
