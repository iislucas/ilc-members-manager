import { Component, inject, signal } from '@angular/core';
import { Member, MembershipType, initMember, MasterLevel } from '../data-model';
import { MembersService } from '../members.service';
import * as Papa from 'papaparse';
import { CommonModule } from '@angular/common';
import { Timestamp } from 'firebase/firestore';

type ParsedRow = Record<string, string>;

@Component({
  selector: 'app-member-import-export',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './member-import-export.html',
  styleUrl: './member-import-export.scss',
})
export class MemberImportExportComponent {
  public membersService = inject(MembersService);
  public parsedData = signal<ParsedRow[]>([]);
  public headers = signal<string[]>([]);
  public mapping = signal<Record<string, string>>({}); // { memberField: csvHeader }
  public memberFields = Object.keys(initMember()) as Array<keyof Member>;

  onFileChange(event: Event) {
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
              // Convert all values to string for consistency with CSV parsing
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
      };
      reader.readAsText(file);
    }
  }

  setMapping(memberField: keyof Member, event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const csvHeader = selectElement.value;
    this.mapping.update((m) => ({ ...m, [memberField]: csvHeader }));
  }

  importData() {
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
            // TODO: Add type validation for MembershipType
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
        await this.membersService.addMember(member);
      }
    });
  }
}
