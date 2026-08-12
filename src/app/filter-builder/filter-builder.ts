import {
  Component,
  TemplateRef,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icons/icon.component';

export type FilterFieldType =
  | 'text'
  | 'date'
  | 'date-range'
  | 'select'
  | 'checkbox'
  | 'custom';

export interface FilterSelectOption {
  value: string;
  label: string;
}

export interface FilterConfigItem {
  id: string;
  label: string;
  type: FilterFieldType;
  placeholder?: string;
  options?: FilterSelectOption[];
  checkboxLabel?: string;
  fromDateKey?: string;
  toDateKey?: string;
}

export interface FilterChangeEvent {
  id: string;
  value: any;
}

@Component({
  selector: 'app-filter-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './filter-builder.html',
  styleUrl: './filter-builder.scss',
})
export class FilterBuilderComponent {
  config = input.required<FilterConfigItem[]>();
  values = input<Record<string, any>>({});
  customTemplates = input<Record<string, TemplateRef<any>>>({});

  filterChange = output<FilterChangeEvent>();
  filterRemove = output<string>();
  filterAdd = output<string>();
  valuesChange = output<Record<string, any>>();
  allCleared = output<void>();

  activeFilterIds = signal<string[]>([]);
  pendingNewFilter = signal<boolean>(false);
  private hasInitialized = false;

  private updateFnCache = new Map<string, (val: any) => void>();

  constructor() {
    effect(() => {
      const cfg = this.config();
      const vals = this.values();
      const currentActive = this.activeFilterIds();
      const newActive = [...currentActive];

      for (const item of cfg) {
        if (newActive.includes(item.id)) continue;

        if (item.type === 'date-range') {
          const fromKey = item.fromDateKey || `${item.id}From`;
          const toKey = item.toDateKey || `${item.id}To`;
          if (vals[fromKey] || vals[toKey]) {
            newActive.push(item.id);
          }
        } else if (item.type === 'checkbox') {
          if (vals[item.id] === true || vals[item.id] === 'true') {
            newActive.push(item.id);
          }
        } else {
          if (vals[item.id] !== undefined && vals[item.id] !== '' && vals[item.id] !== null) {
            newActive.push(item.id);
          }
        }
      }

      if (newActive.length !== currentActive.length) {
        this.activeFilterIds.set(newActive);
      }

      if (newActive.length > 0) {
        this.pendingNewFilter.set(false);
      } else if (!this.hasInitialized) {
        this.hasInitialized = true;
        this.pendingNewFilter.set(true);
      }
    });
  }

  activeFilterConfigs = computed(() => {
    const active = this.activeFilterIds();
    const configMap = new Map(this.config().map(c => [c.id, c]));
    return active.map(id => configMap.get(id)).filter((c): c is FilterConfigItem => !!c);
  });

  unusedFilters = computed(() => {
    const active = new Set(this.activeFilterIds());
    return this.config().filter(c => !active.has(c.id));
  });

  getValue(key: string): any {
    const vals = this.values();
    return vals[key] !== undefined ? vals[key] : '';
  }

  getUpdateFn(id: string): (val: any) => void {
    if (!this.updateFnCache.has(id)) {
      this.updateFnCache.set(id, (val: any) => this.updateValue(id, val));
    }
    return this.updateFnCache.get(id)!;
  }

  updateValue(key: string, value: any) {
    this.filterChange.emit({ id: key, value });
    const current = { ...this.values(), [key]: value };
    this.valuesChange.emit(current);
  }

  onTextChange(id: string, event: Event) {
    const val = (event.target as HTMLInputElement).value;
    this.updateValue(id, val);
  }

  onSelectChange(id: string, event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    this.updateValue(id, val);
  }

  onCheckboxChange(id: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.updateValue(id, checked);
  }

  onDateFromChange(filter: FilterConfigItem, event: Event) {
    const fromKey = filter.fromDateKey || `${filter.id}From`;
    const val = (event.target as HTMLInputElement).value;
    this.updateValue(fromKey, val);
  }

  onDateToChange(filter: FilterConfigItem, event: Event) {
    const toKey = filter.toDateKey || `${filter.id}To`;
    const val = (event.target as HTMLInputElement).value;
    this.updateValue(toKey, val);
  }

  startAddFilter() {
    if (this.unusedFilters().length === 0) return;
    this.pendingNewFilter.set(true);
  }

  cancelAddFilter() {
    this.pendingNewFilter.set(false);
    if (this.activeFilterIds().length === 0) {
      this.allCleared.emit();
    }
  }

  onSelectNewFilter(event: Event) {
    const select = event.target as HTMLSelectElement;
    const filterId = select.value;
    if (!filterId) return;

    if (!this.activeFilterIds().includes(filterId)) {
      this.activeFilterIds.update(ids => [...ids, filterId]);
      this.filterAdd.emit(filterId);
    }
    this.pendingNewFilter.set(false);
    select.value = '';
  }

  removeFilter(id: string) {
    const filter = this.config().find(c => c.id === id);
    this.activeFilterIds.update(ids => ids.filter(i => i !== id));

    if (filter) {
      if (filter.type === 'date-range') {
        const fromKey = filter.fromDateKey || `${filter.id}From`;
        const toKey = filter.toDateKey || `${filter.id}To`;
        this.updateValue(fromKey, '');
        this.updateValue(toKey, '');
      } else if (filter.type === 'checkbox') {
        this.updateValue(id, false);
      } else {
        this.updateValue(id, '');
      }
    }
    this.filterRemove.emit(id);

    if (this.activeFilterIds().length === 0 && !this.pendingNewFilter()) {
      this.allCleared.emit();
    }
  }
}
