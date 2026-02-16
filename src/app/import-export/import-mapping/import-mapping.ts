import { Component, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-import-mapping',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './import-mapping.html',
  styleUrl: './import-mapping.scss',
})
export class ImportMappingComponent {
  // Inputs
  public headers = input.required<string[]>();
  public fieldsToMap = input.required<string[]>();
  public parsedData = input.required<any[]>();
  public mapping = input.required<Record<string, string[]>>();
  public separators = input<Record<string, string>>({});

  // Output events
  public mappingChange = output<Record<string, string[]>>();
  public analyze = output<void>();

  // Internal state
  public currentExampleIndex = signal(0);

  public currentExampleRow = computed(() => {
    const data = this.parsedData();
    if (!data || data.length === 0) return {};
    return data[this.currentExampleIndex()];
  });

  nextExample() {
    this.currentExampleIndex.update((i) => Math.min(i + 1, this.parsedData().length - 1));
  }

  prevExample() {
    this.currentExampleIndex.update((i) => Math.max(i - 1, 0));
  }

  addHeader(field: string, event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (!value) return;
    const currentMapping = structuredClone(this.mapping());
    if (!currentMapping[field]) {
      currentMapping[field] = [];
    }
    if (!currentMapping[field].includes(value)) {
      currentMapping[field].push(value);
    }
    this.mappingChange.emit(currentMapping);
    // Reset the select back to placeholder
    (event.target as HTMLSelectElement).value = '';
  }

  removeHeader(field: string, header: string) {
    const currentMapping = structuredClone(this.mapping());
    if (!currentMapping[field]) return;
    currentMapping[field] = currentMapping[field].filter(h => h !== header);
    if (currentMapping[field].length === 0) {
      delete currentMapping[field];
    }
    this.mappingChange.emit(currentMapping);
  }

  getExampleValue(field: string): string {
    const headers = this.mapping()[field];
    if (!headers || headers.length === 0) return '';
    const row = this.currentExampleRow();
    const sep = this.separators()[field] ?? ' ';
    return headers.map(h => row[h] ?? '').filter(v => v !== '').join(sep);
  }
}
