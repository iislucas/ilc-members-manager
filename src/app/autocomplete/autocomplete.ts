import {
  Component,
  input,
  output,
  signal,
  computed,
  linkedSignal,
  viewChild,
  ElementRef,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SearchableSet, SearchOptions } from '../searchable-set';

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
  host: {
    '(window:resize)': 'onWindowResize()',
  },
})
export class AutocompleteComponent<ID extends string, T extends { [key in ID]: string } > {
  searchableSet = input.required<SearchableSet<ID, T>>();
  displayFns = input.required<DisplayFns<T>>();
  name = input<string>('');
  placeholder = input<string>('');
  disabled = input<boolean>(false);
  inputBoxIsChip = input<boolean>(true);
  initSearchTerm = input<string>('');
  searchOptions = input<SearchOptions>({});
  idField = computed(() => this.searchableSet().idField);

  itemSelected = output<T>();
  textUpdated = output<string>();
  searchTerm = linkedSignal(() => this.initSearchTerm());
  showResults = signal(false);
  highlightedIndex = signal(-1);

  private menu = viewChild<ElementRef<HTMLUListElement>>('menu');

  constructor() {
    // Re-fit the menu to the visible area whenever it opens or its contents
    // change. The measurement must happen after the DOM updates, so defer
    // it to the next animation frame.
    effect(() => {
      this.showResults();
      this.filteredItems();
      const el = this.menu()?.nativeElement;
      if (el) {
        requestAnimationFrame(() => this.fitMenuToViewport(el));
      }
    });
  }

  onWindowResize() {
    if (this.showResults()) {
      const el = this.menu()?.nativeElement;
      if (el) {
        this.fitMenuToViewport(el);
      }
    }
  }

  private fitMenuToViewport(el: HTMLUListElement) {
    const margin = 16; // ~1em breathing room on each edge
    const vw = document.documentElement.clientWidth;

    // Reset styles so we measure the natural, left-anchored position and intrinsic width.
    el.style.left = '0px';
    el.style.maxWidth = '';

    // Determine the visible horizontal bounds from the viewport and any clipping ancestors (such as <main> with overflow-x: clip/hidden).
    let minLeft = margin;
    let maxRight = vw - margin;

    let parent = el.parentElement;
    while (parent && parent !== document.documentElement) {
      const style = window.getComputedStyle(parent);
      const overflowX = style.overflowX;
      if (
        overflowX === 'hidden' ||
        overflowX === 'clip' ||
        overflowX === 'auto' ||
        overflowX === 'scroll'
      ) {
        const parentRect = parent.getBoundingClientRect();
        minLeft = Math.max(minLeft, parentRect.left + margin);
        maxRight = Math.min(maxRight, parentRect.right - margin);
      }
      parent = parent.parentElement;
    }

    if (maxRight < minLeft + 100) {
      maxRight = Math.max(minLeft + 100, vw - margin);
    }

    const rect = el.getBoundingClientRect();
    const overflowRight = rect.right - maxRight;

    let shift = 0;
    if (overflowRight > 0) {
      // Shift left to bring the right edge inside maxRight, but never push past minLeft.
      const maxShift = Math.max(0, rect.left - minLeft);
      shift = Math.min(overflowRight, maxShift);
      el.style.left = `${-shift}px`;
    }

    // Bound the maximum width to the available visible area so that content wraps.
    const currentLeft = rect.left - shift;
    const availableWidth = Math.max(100, Math.floor(maxRight - currentLeft));
    el.style.maxWidth = `${availableWidth}px`;
  }

  filteredItems = computed(() => {
    const items = this.searchableSet().search(this.searchTerm(), this.searchOptions());
    return items.length === 1 && items[0][this.idField()].toLowerCase() === this.searchTerm().toLowerCase() ?
      this.searchableSet().uniqueEntries() : items;
  });

  onSearchTermChange(event: Event) {
    const updatedText = (event.target as HTMLInputElement).value;
    this.textUpdated.emit(updatedText);
    this.searchTerm.set(updatedText);
    this.highlightedIndex.set(-1);
  }

  onKeydown(event: KeyboardEvent) {
    const items = this.filteredItems();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.showResults()) {
          this.showResults.set(true);
        }
        if (items.length > 0) {
          this.highlightedIndex.set((this.highlightedIndex() + 1) % items.length);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (items.length > 0) {
          this.highlightedIndex.set(
            (this.highlightedIndex() - 1 + items.length) % items.length,
          );
        }
        break;
      case 'Enter': {
        const item = items[this.highlightedIndex()];
        if (this.showResults() && item) {
          event.preventDefault();
          this.selectItem(item);
        }
        break;
      }
      case 'Escape':
        this.showResults.set(false);
        this.highlightedIndex.set(-1);
        break;
    }
  }

  selectItem(item: T) {
    this.itemSelected.emit(item);
    const newText = this.inputBoxIsChip()
      ? this.displayFns().toChipId(item)
      : this.displayFns().toName(item);
    this.searchTerm.set(newText);
    this.textUpdated.emit(newText);
    this.showResults.set(false);
    this.highlightedIndex.set(-1);
  }

  onFocus() {
    this.showResults.set(true);
    requestAnimationFrame(() => {
      const el = this.menu()?.nativeElement;
      if (el) {
        this.fitMenuToViewport(el);
      }
    });
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
