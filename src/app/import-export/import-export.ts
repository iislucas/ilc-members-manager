import { Component, computed, inject, signal } from '@angular/core';
import { SpinnerComponent } from '../spinner/spinner.component';
import {
  Member,
  MembershipType,
  initMember,
  MasterLevel,
  School,
  initSchool,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import * as Papa from 'papaparse';
import { CommonModule } from '@angular/common';

type ParsedRow = Record<string, string>;
type ImportType = 'member' | 'school';
export type ImportStage =
  | 'SELECT'
  | 'MAPPING'
  | 'ANALYZING'
  | 'PREVIEW'
  | 'IMPORTING'
  | 'COMPLETED';

export interface ProposedChange {
  status: 'NEW' | 'UPDATE' | 'UNCHANGED';
  key: string;
  newItem: Member | School;
  oldItem?: Member | School;
  diffs: { field: string; oldVal: string; newVal: string }[];
}

@Component({
  selector: 'app-import-export',
  standalone: true,
  imports: [CommonModule, SpinnerComponent],
  templateUrl: './import-export.html',
  styleUrl: './import-export.scss',
})
export class ImportExportComponent {
  public membersService = inject(DataManagerService);

  // State
  public stage = signal<ImportStage>('SELECT');
  public importType = signal<ImportType>('member');
  public importProgress = signal({ current: 0, total: 0 });

  // Data
  public parsedData = signal<ParsedRow[]>([]);
  public headers = signal<string[]>([]);
  public mapping = signal<Record<string, string>>({});

  // Analysis / Preview
  public proposedChanges = signal<ProposedChange[]>([]);
  public previewIndex = signal(0);
  public currentPreviewChange = computed(
    () => this.proposedChanges()[this.previewIndex()],
  );
  public changesSummary = computed(() => {
    const changes = this.proposedChanges();
    return {
      new: changes.filter((c) => c.status === 'NEW').length,
      update: changes.filter((c) => c.status === 'UPDATE').length,
      unchanged: changes.filter((c) => c.status === 'UNCHANGED').length,
      total: changes.length,
    };
  });

  // Example Viewer (Mapping Stage)
  public currentExampleIndex = signal(0);
  public currentExampleRow = computed(() => {
    const data = this.parsedData();
    const index = this.currentExampleIndex();
    return data[index] || {};
  });

  private memberFields = Object.keys(initMember()) as Array<keyof Member>;
  private schoolFields = Object.keys(initSchool()) as Array<keyof School>;

  public fieldsToMap = computed(() => {
    return this.importType() === 'member'
      ? this.memberFields
      : this.schoolFields;
  });

  reset() {
    this.stage.set('SELECT');
    this.parsedData.set([]);
    this.headers.set([]);
    this.mapping.set({});
    this.proposedChanges.set([]);
    this.previewIndex.set(0);
    this.importProgress.set({ current: 0, total: 0 });
    // Reset file input if needed via ViewChild, but for now user can just click button
  }

  onFileChange(event: Event, type: ImportType) {
    this.importType.set(type);
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

  // Deprecated usage, but keeping signature for now if needed, though replaced logic above
  setDefaultMapping(headers: string[]) {
    this.mapping.set(this.getDefaultMapping(headers));
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
    this.previewIndex.set(0);

    // Give UI a moment to update to 'ANALYZING'
    await new Promise((resolve) => setTimeout(resolve, 100));

    const proposed: ProposedChange[] = [];
    const data = this.parsedData();
    const mapping = this.mapping();

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      if (this.importType() === 'member') {
        const member = this.mapRowToMember(row, mapping);
        if (!member.email) continue; // Skip if no email

        const existing = this.membersService.members
          .entries()
          .find((m) => m.email === member.email);

        if (existing) {
          const diffs = this.getDifferences(member, existing);
          proposed.push({
            status: diffs.length > 0 ? 'UPDATE' : 'UNCHANGED',
            key: member.email,
            newItem: member as Member,
            oldItem: existing,
            diffs,
          });
        } else {
          proposed.push({
            status: 'NEW',
            key: member.email,
            newItem: member as Member,
            diffs: [],
          });
        }
      } else {
        const school = this.mapRowToSchool(row, mapping);
        if (!school.schoolId) continue; // Skip if no schoolId

        const existing = this.membersService.schools
          .entries()
          .find((s) => s.schoolId === school.schoolId);

        if (existing) {
          const diffs = this.getDifferences(school, existing);
          proposed.push({
            status: diffs.length > 0 ? 'UPDATE' : 'UNCHANGED',
            key: school.schoolId,
            newItem: school as School,
            oldItem: existing,
            diffs,
          });
        } else {
          proposed.push({
            status: 'NEW',
            key: school.schoolId,
            newItem: school as School,
            diffs: [],
          });
        }
      }
    }

    this.proposedChanges.set(proposed);
    this.stage.set('PREVIEW');
  }

  async executeImport() {
    this.stage.set('IMPORTING');
    const changes = this.proposedChanges().filter(
      (c) => c.status !== 'UNCHANGED',
    );
    const total = changes.length;
    this.importProgress.set({ current: 0, total });

    for (let i = 0; i < total; i++) {
      const change = changes[i];
      try {
        if (this.importType() === 'member') {
          if (change.status === 'NEW') {
            await this.membersService.addMember(change.newItem as Member);
          } else {
            // Merge update
            await this.membersService.updateMember(
              change.key,
              change.newItem as Member,
            );
          }
        } else {
          // Schools are always upserts essentially with setSchool
          await this.membersService.setSchool(change.newItem as School);
        }
      } catch (err) {
        console.error('Failed to import', change.key, err);
      }
      this.importProgress.set({ current: i + 1, total });
    }

    this.stage.set('COMPLETED');
  }

  private mapRowToMember(
    row: ParsedRow,
    mapping: Record<string, string>,
  ): Partial<Member> {
    const member: Partial<Member> = {};
    for (const partialKey in mapping) {
      const key = partialKey as keyof Member;
      const csvHeader = mapping[key];
      const value = row[csvHeader];

      if (value === undefined || value === null || value === '') continue;

      switch (key) {
        case 'isAdmin':
          member[key] = ['true', '1', 'yes'].includes(value.toLowerCase());
          break;
        case 'membershipType':
          member[key] = value as MembershipType;
          break;
        case 'mastersLevels':
          member[key] = value.split(',').map((s) => s.trim()) as MasterLevel[];
          break;
        default:
          (member as any)[key] = value;
          break;
      }
    }
    return member;
  }

  private mapRowToSchool(
    row: ParsedRow,
    mapping: Record<string, string>,
  ): Partial<School> {
    const school: Partial<School> = {};
    for (const partialKey in mapping) {
      const key = partialKey as keyof School;
      const csvHeader = mapping[key];
      const value = row[csvHeader];

      if (value === undefined || value === null || value === '') continue;

      switch (key) {
        case 'managers':
          school[key] = value.split(',').map((s) => s.trim());
          break;
        default:
          (school as any)[key] = value;
          break;
      }
    }
    return school;
  }

  private getDifferences(
    newItem: any,
    oldItem: any,
  ): { field: string; oldVal: string; newVal: string }[] {
    const diffs: { field: string; oldVal: string; newVal: string }[] = [];
    for (const key in newItem) {
      const newVal = newItem[key];
      const oldVal = oldItem[key];

      if (newVal === undefined || newVal === null) continue;

      let isDiff = false;
      if (Array.isArray(newVal) && Array.isArray(oldVal)) {
        const newSorted = [...newVal].sort().join(',');
        const oldSorted = [...oldVal].sort().join(',');
        if (newSorted !== oldSorted) isDiff = true;
      } else if (newVal !== oldVal) {
        isDiff = true;
      }

      if (isDiff) {
        diffs.push({
          field: key,
          oldVal: String(oldVal),
          newVal: String(newVal),
        });
      }
    }
    return diffs;
  }

  nextPreview() {
    this.previewIndex.update((i) =>
      Math.min(i + 1, this.proposedChanges().length - 1),
    );
  }

  prevPreview() {
    this.previewIndex.update((i) => Math.max(i - 1, 0));
  }
}
