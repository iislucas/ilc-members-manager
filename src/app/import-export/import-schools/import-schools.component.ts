import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { DataManagerService } from '../../data-manager.service';
import { School, initSchool } from '../../../../functions/src/data-model';
import * as Papa from 'papaparse';
import {
  ParsedRow,
  ImportStage,
  FilterStatus,
  ImportDelta,
  getDifferences,
  ProposedChange
} from '../import-export-utils';

@Component({
  selector: 'app-import-schools',
  standalone: true,
  imports: [CommonModule, SpinnerComponent],
  templateUrl: './import-schools.component.html',
  styleUrl: '../import-export.scss',
})
export class ImportSchoolsComponent {
  public membersService = inject(DataManagerService);

  // State
  public stage = signal<ImportStage>('SELECT');
  public importProgress = signal({ current: 0, total: 0 });

  // Data
  public parsedData = signal<ParsedRow[]>([]);
  public headers = signal<string[]>([]);
  public mapping = signal<Record<string, string>>({});

  // Analysis / Preview
  public proposedChanges = signal<ImportDelta<School>>({
    issues: [],
    updates: [],
    unchanged: [],
    new: new Map(),
    seenIds: new Set(),
  });
  public selectedStatusFilter = signal<FilterStatus>('ISSUE');
  public filteredProposedChanges = computed(() => {
    const delta = this.proposedChanges();
    const filter = this.selectedStatusFilter();

    switch (filter) {
      case 'NEW':
        return Array.from(delta.new.values());
      case 'UPDATE':
        return delta.updates;
      case 'ISSUE':
        return delta.issues;
      case 'UNCHANGED':
        return delta.unchanged;
    }
  });

  public counterUpdateResult = signal<{
    success: boolean;
    updates?: {
      schoolIdCounter?: number;
    };
    error?: string;
  } | null>(null);

  public previewIndex = signal(0);
  public currentPreviewChange = computed(
    () => this.filteredProposedChanges()[this.previewIndex()],
  );

  // Example Viewer (Mapping Stage)
  public currentExampleIndex = signal(0);
  public currentExampleRow = computed(() => {
    const data = this.parsedData();
    const index = this.currentExampleIndex();
    return data[index] || {};
  });

  private schoolFields = Object.keys(initSchool()) as Array<keyof School>;

  public fieldsToMap = computed(() => {
    return this.schoolFields;
  });

  reset() {
    this.stage.set('SELECT');
    this.parsedData.set([]);
    this.headers.set([]);
    this.mapping.set({});
    this.proposedChanges.set({
      issues: [],
      updates: [],
      unchanged: [],
      new: new Map(),
      seenIds: new Set(),
    });
    this.selectedStatusFilter.set('ISSUE');
    this.previewIndex.set(0);
    this.importProgress.set({ current: 0, total: 0 });
    this.counterUpdateResult.set(null);
  }

  onFileChange(event: Event) {
    this.parsedData.set([]);
    this.headers.set([]);
    this.mapping.set({});
    this.currentExampleIndex.set(0);
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) {
      return;
    }

    const onUploadComplete = (
      headers: string[],
      data: ParsedRow[],
      mapping: Record<string, string>,
    ) => {
      this.headers.set(headers);
      this.parsedData.set(data);
      this.mapping.set(mapping);
      this.stage.set('MAPPING');
    };

    if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
      Papa.parse<ParsedRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          onUploadComplete(
            result.meta.fields ?? [],
            result.data,
            this.getDefaultMapping(result.meta.fields ?? []),
          );
        },
      });
    } else if (
      file.type === 'application/jsonl' ||
      file.name.endsWith('.jsonl')
    ) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) return;
        const lines = text.split('\n').filter((line) => line.trim() !== '');
        const data: ParsedRow[] = [];
        let firstObjectHeaders: string[] = [];

        lines.forEach((line, index) => {
          try {
            const parsed = JSON.parse(line);
            if (typeof parsed === 'object' && parsed !== null) {
              if (index === 0) {
                firstObjectHeaders = Object.keys(parsed);
              }
              const stringifiedRow: ParsedRow = {};
              for (const key in parsed) {
                stringifiedRow[key] = String(parsed[key]);
              }
              data.push(stringifiedRow);
            }
          } catch (error: unknown) {
            console.error('Error parsing JSONL line:', line, error);
          }
        });
        onUploadComplete(
          firstObjectHeaders,
          data,
          this.getDefaultMapping(firstObjectHeaders),
        );
      };
      reader.readAsText(file);
    }
  }

  getDefaultMapping(headers: string[]) {
    const fields = this.fieldsToMap();
    const mapping: Record<string, string> = {};
    fields.forEach((field) => {
      if (headers.includes(field)) {
        mapping[field] = field;
      }
    });
    return mapping;
  }

  setOneMappingValue(field: string, event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const csvHeader = selectElement.value;
    this.mapping.update((m) => {
      if (csvHeader) {
        return { ...m, [field]: csvHeader };
      } else {
        const { [field]: removed, ...rest } = m;
        return rest;
      }
    });
  }

  nextExample() {
    this.currentExampleIndex.update((i) =>
      Math.min(i + 1, this.parsedData().length - 1),
    );
  }

  prevExample() {
    this.currentExampleIndex.update((i) => Math.max(i - 1, 0));
  }

  async analyzeData() {
    this.stage.set('ANALYZING');
    this.selectedStatusFilter.set('ISSUE');
    this.previewIndex.set(0);

    // Give UI a moment to update to 'ANALYZING'
    await new Promise((resolve) => setTimeout(resolve, 100));

    const delta = this.analyzeSchools();

    this.proposedChanges.set(delta);
    this.stage.set('PREVIEW');
  }

  private analyzeSchools(): ImportDelta<School> {
    const delta: ImportDelta<School> = {
      issues: [],
      updates: [],
      unchanged: [],
      new: new Map(),
      seenIds: new Set(),
    };
    const data = this.parsedData();

    for (let i = 0; i < data.length; i++) {
      this.analyzeSchoolRow(data[i], i, delta);
    }
    return delta;
  }

  private analyzeSchoolRow(
    row: ParsedRow,
    index: number,
    delta: ImportDelta<School>,
  ): void {
    const school = this.mapRowToSchool(row, this.mapping());

    // Skip if all mapped fields are empty
    const mappedValues = Object.values(this.mapping()).map((header) =>
      row[header]?.trim(),
    );
    if (mappedValues.every((v) => !v)) {
      return;
    }

    if (!school.schoolId) return; // Skip if no schoolId

    if (delta.seenIds.has(school.schoolId)) {
      delta.issues.push({
        status: 'ISSUE',
        key: school.schoolId,
        newItem: school as School,
        diffs: [],
        issues: ['Duplicate ID in import file'],
      });
      return;
    }
    delta.seenIds.add(school.schoolId);

    const existing = this.membersService.schools
      .entriesMap()
      .get(school.schoolId);

    if (existing) {
      const diffs = getDifferences(school, existing);
      if (diffs.length > 0) {
        delta.updates.push({
          status: 'UPDATE',
          key: school.schoolId,
          newItem: school as School,
          oldItem: existing,
          diffs,
        });
      } else {
        delta.unchanged.push({
          status: 'UNCHANGED',
          key: school.schoolId,
          newItem: school as School,
          oldItem: existing,
          diffs: [],
        });
      }
    } else {
      delta.new.set(school.schoolId, {
        status: 'NEW',
        key: school.schoolId,
        newItem: school as School,
        diffs: [],
      });
    }
  }

  async executeImportSchools() {
    this.stage.set('IMPORTING');
    const delta = this.proposedChanges();
    const newSchools = Array.from(delta.new.values());
    const updates = delta.updates;
    const total = newSchools.length + updates.length;
    let currentProcessed = 0;

    this.importProgress.set({ current: 0, total });

    for (const change of newSchools) {
      try {
        await this.membersService.setSchool(change.newItem);
      } catch (err) {
        console.error('Failed to import new school', change.key, err);
      }
      currentProcessed++;
      this.importProgress.set({ current: currentProcessed, total });
    }

    for (const change of updates) {
      try {
        await this.membersService.setSchool(change.newItem);
      } catch (err) {
        console.error('Failed to update school', change.key, err);
      }
      currentProcessed++;
      this.importProgress.set({ current: currentProcessed, total });
    }

    this.stage.set('COMPLETED');

    try {
      await this.updateCountersFromSchools();
    } catch (err) {
      console.error('Failed to update school counters', err);
      this.counterUpdateResult.set({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async updateCountersFromSchools() {
    const delta = this.proposedChanges();
    const allSchools = [
      ...Array.from(delta.new.values()).map((c) => c.newItem),
      ...delta.updates.map((c) => c.newItem),
      ...delta.unchanged.map((c) => c.newItem),
    ];

    const currentCounters = this.membersService.counters();
    let schoolIdCounter = currentCounters?.schoolIdCounter || 0;

    for (const school of allSchools) {
      if (school.schoolId) {
        const match = school.schoolId.match(/^SCH-(\d+)$/);
        if (match) {
          const number = parseInt(match[1], 10);
          if (number > schoolIdCounter) {
            schoolIdCounter = number;
          }
        }
      }
    }

    if (schoolIdCounter > 0) {
      const updates = {
        schoolIdCounter,
      };
      await this.membersService.updateCounters(updates);
      this.counterUpdateResult.set({
        success: true,
        updates,
      });
    } else {
      this.counterUpdateResult.set({
        success: true,
        updates: { schoolIdCounter: 0 },
      });
    }
  }

  private mapRowToSchool(
    row: ParsedRow,
    mapping: Record<string, string>,
  ): Partial<School> {
    const school: Partial<School> = {};
    for (const partialKey in mapping) {
      const key = partialKey as keyof School;
      const csvHeader = mapping[key];
      let value = row[csvHeader];

      if (value === undefined || value === null) continue;
      value = value.trim();
      if (value === '') continue;

      switch (key) {
        case 'managers':
          school[key] = value.split(',').map((s) => s.trim());
          break;
        case 'ownerEmail':
          school[key] = value.toLowerCase();
          break;
        case 'managerEmails':
          school[key] = value
            .split(/[,\s\n]+/)
            .map((s) => s.trim().toLowerCase())
            .filter((e) => !!e);
          break;
        default:
          (school as any)[key] = value;
          break;
      }
    }
    return school;
  }

  nextPreview() {
    this.previewIndex.update((i) =>
      Math.min(i + 1, this.filteredProposedChanges().length - 1),
    );
  }

  prevPreview() {
    this.previewIndex.update((i) => Math.max(i - 1, 0));
  }

  setFilter(status: FilterStatus) {
    if (this.selectedStatusFilter() === status) {
      this.selectedStatusFilter.set('ISSUE');
    } else {
      this.selectedStatusFilter.set(status);
    }
    this.previewIndex.set(0);
  }
}
