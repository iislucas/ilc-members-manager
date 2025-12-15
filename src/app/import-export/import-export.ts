import { Component, computed, inject, signal } from '@angular/core';
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

@Component({
  selector: 'app-import-export',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './import-export.html',
  styleUrl: './import-export.scss',
})
export class ImportExportComponent {
  public membersService = inject(DataManagerService);
  public parsedData = signal<ParsedRow[]>([]);
  public headers = signal<string[]>([]);
  public mapping = signal<Record<string, string>>({});
  public importType = signal<ImportType>('member');
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

    if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
      Papa.parse<ParsedRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          this.headers.set(result.meta.fields ?? []);
          this.parsedData.set(result.data);
          this.setDefaultMapping(result.meta.fields ?? []);
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

        this.headers.set(firstObjectHeaders);
        this.parsedData.set(data);
        this.setDefaultMapping(firstObjectHeaders);
      };
      reader.readAsText(file);
    }
  }

  setDefaultMapping(headers: string[]) {
    const fields = this.fieldsToMap();
    const mapping: Record<string, string> = {};
    fields.forEach((field) => {
      if (headers.includes(field)) {
        mapping[field] = field;
      }
    });
    this.mapping.set(mapping);
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

  importData() {
    if (this.importType() === 'member') {
      this.importMembers();
    } else {
      this.importSchools();
    }
  }

  private importMembers() {
    const data = this.parsedData();
    const mapping = this.mapping();

    data.forEach(async (row) => {
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
            member[key] = value
              .split(',')
              .map((s) => s.trim()) as MasterLevel[];
            break;
          default:
            (member as any)[key] = value;
            break;
        }
      }
      if (Object.keys(member).length > 0) {
        await this.membersService.addMember(member as Member);
      }
    });
  }

  private importSchools() {
    const data = this.parsedData();
    const mapping = this.mapping();

    data.forEach(async (row) => {
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
      if (Object.keys(school).length > 0) {
        await this.membersService.setSchool(school as School);
      }
    });
  }
}
