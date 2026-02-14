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
  public mapping = input.required<Record<string, string>>();

  // Output events
  public mappingChange = output<Record<string, string>>();
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

  setOneMappingValue(field: string, event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    const currentMapping = { ...this.mapping() };
    if (value) {
      currentMapping[field] = value;
    } else {
      delete currentMapping[field];
    }
    this.mappingChange.emit(currentMapping);
  }
}
