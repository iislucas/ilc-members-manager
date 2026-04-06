import { Component, inject, signal, linkedSignal, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { AutocompleteComponent } from '../autocomplete/autocomplete';

@Component({
  selector: 'app-complete-profile',
  imports: [CommonModule, FormsModule, AutocompleteComponent],
  templateUrl: './complete-profile.html',
  styleUrl: './complete-profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompleteProfileComponent {
  public dataService = inject(DataManagerService);
  private firebaseService = inject(FirebaseStateService);

  public fillName = linkedSignal({
    source: () => this.firebaseService.user()?.member?.name,
    computation: (newName: string | undefined, previous: { value: string, source: string | undefined } | undefined) => {
      if (!previous) return newName || localStorage.getItem('completeProfile_name') || '';
      if (previous.value === previous.source) return newName || localStorage.getItem('completeProfile_name') || '';
      return previous.value;
    }
  });

  public fillDOB = linkedSignal({
    source: () => this.firebaseService.user()?.member?.dateOfBirth,
    computation: (newDOB: string | undefined, previous: { value: string, source: string | undefined } | undefined) => {
      if (!previous) return newDOB || localStorage.getItem('completeProfile_dob') || '';
      if (previous.value === previous.source) return newDOB || localStorage.getItem('completeProfile_dob') || '';
      return previous.value;
    }
  });

  public fillCountry = linkedSignal({
    source: () => this.firebaseService.user()?.member?.country,
    computation: (newCountry: string | undefined, previous: { value: string, source: string | undefined } | undefined) => {
      if (!previous) return newCountry || localStorage.getItem('completeProfile_country') || '';
      if (previous.value === previous.source) return newCountry || localStorage.getItem('completeProfile_country') || '';
      return previous.value;
    }
  });

  public fillingProfile = signal(false);
  public saveError = signal<string | null>(null);

  countryDisplayFns = {
    toChipId: (c: { id: string; name: string }) => c.id,
    toName: (c: { id: string; name: string }) => c.name,
  };

  updateCountry(value: string) {
    this.fillCountry.set(value);
  }

  countryWithCode = computed(() => {
    const countryName = this.fillCountry();
    return (
      this.dataService.countries
        .entries()
        .find((c) => c.name === countryName) || null
    );
  });

  public async submitProfileEnrichment() {
    const user = this.firebaseService.user();
    if (!user) return;
    const name = this.fillName().trim();
    const dob = this.fillDOB().trim();
    const country = this.fillCountry().trim();
    if (!name || !dob || !country) return;

    this.fillingProfile.set(true);
    this.saveError.set(null);
    try {
      await this.dataService.updateMember(user.member.docId, {
        ...user.member,
        name,
        dateOfBirth: dob,
        country,
      }, user.member);
    } catch (error: unknown) {
      console.error('Failed to update profile enrichment:', error);
      this.saveError.set(
        `Failed to save your profile: ${(error as Error).message}.`,
      );
    } finally {
      this.fillingProfile.set(false);
    }
  }
}
