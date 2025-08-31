import {
  Component,
  input,
  output,
  signal,
  computed,
  linkedSignal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SearchableSet } from '../searchable-set';

export interface AutocompleteItem {
  chipId: string;
  name: string;
}

export type DisplayFns<T> = {
  toChipId: (e: T) => string;
  toName: (e: T) => string;
};

@Component({
  selector: 'app-autocomplete',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './autocomplete.html',
  styleUrl: './autocomplete.scss',
})
export class AutocompleteComponent<T extends { id: string }> {
  searchableSet = input.required<SearchableSet<T>>();
  displayFns = input.required<DisplayFns<T>>();
  name = input<string>('');
  placeholder = input<string>('');
  disabled = input<boolean>(false);
  inputBoxIsChip = input<boolean>(true);
  initSearchTerm = input<string>('');

  itemSelected = output<T>();
  textUpdated = output<string>();
  searchTerm = linkedSignal(() => this.initSearchTerm());
  showResults = signal(false);

  filteredItems = computed(() => {
    return this.searchableSet().search(this.searchTerm());
  });

  onSearchTermChange(event: Event) {
    const updatedText = (event.target as HTMLInputElement).value;
    this.textUpdated.emit(updatedText);
    this.searchTerm.set(updatedText);
    console.log('autocomplete updated:', updatedText);
  }

  selectItem(item: T) {
    this.itemSelected.emit(item);
    const newText = this.inputBoxIsChip()
      ? this.displayFns().toChipId(item)
      : this.displayFns().toName(item);
    this.searchTerm.set(newText);
    this.textUpdated.emit(newText);
    this.showResults.set(false);
  }

  onFocus() {
    this.showResults.set(true);
  }

  chip(x: T): string {
    return this.displayFns().toChipId(x);
  }

  display(x: T): string {
    return this.displayFns().toName(x);
  }

  onBlur() {
    setTimeout(() => this.showResults.set(false), 200);
  }
}
