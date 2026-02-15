import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImportMappingComponent } from '../import-mapping/import-mapping';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { DataManagerService } from '../../data-manager.service';
import {
  Member,
  initMember,
  MembershipType,
  InstructorLicenseType,
  MasterLevel
} from '../../../../functions/src/data-model';
import * as Papa from 'papaparse';
import {
  ParsedRow,
  ImportStage,
  FilterStatus,
  ImportDelta,
  getDifferences,
  parseDate,
  MappingResult,
  ProposedChange,
  ensureLaterDate
} from '../import-export-utils';
import { format, addYears, isValid, parse } from 'date-fns';

@Component({
  selector: 'app-import-members',
  standalone: true,
  imports: [CommonModule, SpinnerComponent, ImportMappingComponent],
  templateUrl: './import-members.component.html',
  styleUrl: './import-members.component.scss',
})
export class ImportMembersComponent {
  public membersService = inject(DataManagerService);

  // State
  public stage = signal<ImportStage>('SELECT');
  public importProgress = signal({ current: 0, total: 0 });

  // Data
  public parsedData = signal<ParsedRow[]>([]);
  public headers = signal<string[]>([]);
  public mapping = signal<Record<string, string>>({});

  // Analysis / Preview
  public proposedChanges = signal<ImportDelta<Member>>({
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
      memberIdCounters?: { [key: string]: number };
      instructorIdCounter?: number;
    };
    error?: string;
  } | null>(null);

  public previewIndex = signal(0);
  public currentPreviewChange = computed(
    () => this.filteredProposedChanges()[this.previewIndex()],
  );


  private memberFields = Object.keys(initMember()) as Array<keyof Member>;

  public fieldsToMap = computed(() => {
    return this.memberFields;
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
    this.mapping.set({});
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
      } else if (field === 'emails') {
        const emailHeader = headers.find(
          (h) => h.toLowerCase() === 'email' || h.toLowerCase() === 'emails',
        );
        if (emailHeader) {
          mapping[field] = emailHeader;
        }
      }
    });
    return mapping;
  }

  async analyzeData() {
    this.stage.set('ANALYZING');
    this.selectedStatusFilter.set('ISSUE');
    this.previewIndex.set(0);

    // Give UI a moment to update to 'ANALYZING'
    await new Promise((resolve) => setTimeout(resolve, 100));

    const delta = this.analyzeMembers();

    this.proposedChanges.set(delta);
    this.stage.set('PREVIEW');
  }

  private analyzeMembers(): ImportDelta<Member> {
    const delta: ImportDelta<Member> = {
      issues: [],
      updates: [],
      unchanged: [],
      new: new Map(),
      seenIds: new Set(),
    };
    const data = this.parsedData();

    for (let i = 0; i < data.length; i++) {
      this.analyzeMemberRow(data[i], i, delta);
    }

    return delta;
  }

  private analyzeMemberRow(
    row: ParsedRow,
    index: number,
    delta: ImportDelta<Member>,
  ): void {
    const { member, issues } = this.mapRowToMember(row, this.mapping());

    // Skip if all mapped fields are empty
    const mappedValues = Object.values(this.mapping()).map((header) =>
      row[header]?.trim(),
    );
    if (mappedValues.every((v) => !v)) {
      return;
    }

    const memberId = member.memberId;

    if (!memberId) {
      delta.issues.push({
        status: 'ISSUE',
        key: `Row ${index + 1}`,
        newItem: member as Member,
        diffs: [],
        issues: ['Member ID is required', ...issues],
      });
      return;
    }

    if (delta.seenIds.has(memberId)) {
      delta.issues.push({
        status: 'ISSUE',
        key: memberId,
        newItem: { ...initMember(), ...member } as Member,
        diffs: [],
        issues: [`Duplicate ID (${memberId}) in import file`, ...issues],
      });
      const existingNewChange = delta.new.get(memberId);
      if (existingNewChange) {
        delta.issues.push({
          ...existingNewChange,
          status: 'ISSUE',
          issues: [
            `Duplicate ID (${memberId}) in import file`,
            ...(existingNewChange.issues || []),
          ],
        });
        delta.new.delete(memberId);
      }
      return;
    }
    delta.seenIds.add(memberId);

    if (issues.length > 0) {
      delta.issues.push({
        status: 'ISSUE',
        key: memberId,
        newItem: { ...initMember(), ...member } as Member,
        oldItem: undefined,
        diffs: [],
        issues,
      });
    } else {
      const existing = this.membersService.members.entriesMap().get(memberId);
      if (existing) {
        // NOTE: We need to define newMember based on merge but respecting date rules
        const newMember = { ...existing, ...member } as Member;

        // Enforce date rules: do not overwrite with earlier dates
        const datesToCheck: (keyof Member)[] = [
          'lastRenewalDate',
          'currentMembershipExpires',
          'instructorLicenseRenewalDate',
          'instructorLicenseExpires'
        ];

        datesToCheck.forEach(field => {
          // We know these fields are strings in our model, or undefined
          const oldVal = existing[field] as string | undefined;
          const proposedVal = member[field] as string | undefined; // from import

          // If proposedVal exists, we have already overwritten it in newMember via spread
          // So we need to check if we should REVERT to oldVal
          if (proposedVal) {
            const secureVal = ensureLaterDate(oldVal, proposedVal);
            if (secureVal !== undefined) {
              (newMember as any)[field] = secureVal;
            }
          }
        });

        const diffs = getDifferences(newMember, existing);
        if (diffs.length > 0) {
          delta.updates.push({
            status: 'UPDATE',
            key: memberId,
              newItem: newMember,
              oldItem: existing,
              diffs,
              issues: undefined,
            });
          } else {
            delta.unchanged.push({
              status: 'UNCHANGED',
              key: memberId,
                 newItem: newMember,
                 oldItem: existing,
                 diffs: [],
                 issues: undefined,
               });
          }
      } else {
        const newChange: ProposedChange<Member> = {
          status: 'NEW',
          key: memberId,
          newItem: { ...initMember(), ...member } as Member,
          diffs: [],
        };
        // Track for duplicate detection within the file
        delta.new.set(memberId, newChange);
      }
    }
  }

  async executeImportMembers() {
    this.stage.set('IMPORTING');
    const delta = this.proposedChanges();
    const newMembers = Array.from(delta.new.values());
    const updates = delta.updates;
    const total = newMembers.length + updates.length;
    let currentProcessed = 0;

    this.importProgress.set({ current: 0, total });

    for (const change of newMembers) {
      try {
        await this.membersService.addMember(change.newItem);
      } catch (err) {
        console.error('Failed to import new member', change.key, err);
      }
      currentProcessed++;
      this.importProgress.set({ current: currentProcessed, total });
    }

    for (const change of updates) {
      try {
        // Merge update
        await this.membersService.updateMember(
          change.oldItem?.id || change.key,
          change.newItem,
        );
      } catch (err) {
        console.error('Failed to update member', change.key, err);
      }
      currentProcessed++;
      this.importProgress.set({ current: currentProcessed, total });
    }

    this.stage.set('COMPLETED');

    try {
      await this.updateCountersFromMembers();
    } catch (err) {
      console.error('Failed to update counters', err);
      this.counterUpdateResult.set({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async updateCountersFromMembers() {
    const delta = this.proposedChanges();
    const allMembers = [
      ...Array.from(delta.new.values()).map((c) => c.newItem),
      ...delta.updates.map((c) => c.newItem),
      ...delta.unchanged.map((c) => c.newItem),
    ];

    const currentCounters = this.membersService.counters();
    const memberIdCounters: { [key: string]: number } = {
      ...(currentCounters?.memberIdCounters || {}),
    };
    let instructorIdCounter = currentCounters?.instructorIdCounter || 0;

    for (const member of allMembers) {
      // Parse Member ID
      if (member.memberId) {
        const match = member.memberId.match(/^([A-Za-z]{2,3})(\d+)$/);
        if (match) {
          const countryCode = match[1].toUpperCase();
          const number = parseInt(match[2], 10);
          if (!memberIdCounters[countryCode] || number > memberIdCounters[countryCode]) {
            memberIdCounters[countryCode] = number;
          }
        }
      }

      // Parse Instructor ID
      if (member.instructorId) {
        const match = member.instructorId.match(/^(\d+)$/);
        if (match) {
          const number = parseInt(match[1], 10);
          if (number > instructorIdCounter) {
            instructorIdCounter = number;
          }
        }
      }
    }

    const updates = {
      memberIdCounters,
      instructorIdCounter: instructorIdCounter > 0 ? instructorIdCounter : undefined,
    };

    await this.membersService.updateCounters(updates);
    this.counterUpdateResult.set({
      success: true,
      updates,
    });
  }

  private mapRowToMember(
    row: ParsedRow,
    mapping: Record<string, string>,
  ): { member: Partial<Member>; issues: string[] } {
    const member: Partial<Member> = {};
    const issues: string[] = [];
    for (const partialKey in mapping) {
      const key = partialKey as keyof Member;
      const csvHeader = mapping[key];
      let value = row[csvHeader];

      if (value === undefined || value === null) continue;
      value = value.trim();
      if (value === '') continue;

      switch (key) {
        case 'isAdmin':
          member[key] = ['true', '1', 'yes'].includes(value.toLowerCase());
          break;
        case 'membershipType': {
          const result = this.mapMembershipType(value);
          if (result.success) {
            member[key] = result.value;
          } else {
            issues.push(result.issue);
          }
          break;
        }
        case 'firstMembershipStarted':
        case 'lastRenewalDate':
        case 'currentMembershipExpires':
        case 'dateOfBirth':
        case 'instructorLicenseRenewalDate':
        case 'instructorLicenseExpires': {
          const result = parseDate(value);
          if (result.success) {
            member[key] = result.value;
          } else {
            issues.push(result.issue);
            (member as any)[key] = value;
          }
          break;
        }
        case 'emails':
          member[key] = value
            .split(/[,\s\n]+/)
            .map((s) => s.trim().toLowerCase())
            .filter((e) => !!e);
          break;
        case 'publicEmail':
          member[key] = value.toLowerCase();
          break;
        case 'mastersLevels':
          member[key] = value.split(',').map((s) => s.trim()) as MasterLevel[];
          break;
        default:
          (member as any)[key] = value;
          break;
      }
    }

    // Auto-calculate membership expiration for annual members
    if (
      member.lastRenewalDate &&
      member.membershipType === MembershipType.Annual && 
      !member.currentMembershipExpires
    ) {
      const renewalDate = parse(member.lastRenewalDate, 'yyyy-MM-dd', new Date());
      if (isValid(renewalDate)) {
        const expiresDate = addYears(renewalDate, 1);
        member.currentMembershipExpires = format(expiresDate, 'yyyy-MM-dd');
      }
    }

    // Auto-calculate instructor license expiration for annual members
    if (
      member.instructorLicenseRenewalDate &&
      member.instructorLicenseType === InstructorLicenseType.Annual && 
      !member.instructorLicenseExpires
    ) {
      const issueDate = parse(member.instructorLicenseRenewalDate, 'yyyy-MM-dd', new Date());
      if (isValid(issueDate)) {
        const expiresDate = addYears(issueDate, 1);
        member.instructorLicenseExpires = format(expiresDate, 'yyyy-MM-dd');
      }
    }

    return { member, issues };
  }

  private mapMembershipType(value: string): MappingResult<MembershipType> {
    const normalized = value.toLowerCase().trim().replace(/\s+/g, ' ');

    if (normalized.includes('annual'))
      return { success: true, value: MembershipType.Annual };
    if (
      normalized.includes('life (partner)') ||
      normalized.includes('life partner')
    )
      return { success: true, value: MembershipType.LifePartner };
    if (normalized.includes('life'))
      return { success: true, value: MembershipType.Life };
    if (normalized.includes('senior'))
      return { success: true, value: MembershipType.Senior };
    if (normalized.includes('student'))
      return { success: true, value: MembershipType.Student };
    if (normalized.includes('minor'))
      return { success: true, value: MembershipType.Minor };
    if (normalized.includes('inactive'))
      return { success: true, value: MembershipType.Inactive };
    if (normalized.includes('deceased'))
      return { success: true, value: MembershipType.Deceased };

    return { success: false, issue: `Unknown membership type: "${value}"` };
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
