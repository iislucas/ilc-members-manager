import { Component, computed, inject, signal } from '@angular/core';
import { SpinnerComponent } from '../spinner/spinner.component';
import {
  Member,
  MembershipType,
  initMember,
  MasterLevel,
  School,
  initSchool,
  InstructorLicenseType,
} from '../../../functions/src/data-model';
import { DataManagerService } from '../data-manager.service';
import * as Papa from 'papaparse';
import { CommonModule } from '@angular/common';
import { parse, isValid, format, addYears } from 'date-fns';

type ParsedRow = Record<string, string>;

type ImportType = 'member' | 'school';
export type ImportStage =
  | 'SELECT'
  | 'MAPPING'
  | 'ANALYZING'
  | 'PREVIEW'
  | 'IMPORTING'
  | 'COMPLETED';

export type FilterStatus = 'NEW' | 'UPDATE' | 'ISSUE' | 'UNCHANGED';

// Handy format for UI to be able to display changes
export interface ProposedChange<T> {
  status: FilterStatus;
  key: string;
  newItem: T;
  oldItem?: T;
  diffs: { field: string; oldVal: string; newVal: string }[];
  issues?: string[];
}

// A set of changes to be applied to the database
export type ImportDelta<T> = {
  issues: ProposedChange<T>[];
  updates: ProposedChange<T>[];
  unchanged: ProposedChange<T>[];
  new: Map<string, ProposedChange<T>>;
  // We need to keep track of seenIds as well as newMembersBeingConsidered
  // because we need to handle the case where we find duplicates; in this 
  // case all duplicates are removed from newMembersBeingConsidered, but 
  // the we need to remember seenIds, just in case we find more duplicates
  // later on.
  seenIds: Set<string>;
}

type MappingResult<T> =
  | { success: true; value: T }
  | { success: false; issue: string };

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
  public proposedChanges = signal<ImportDelta<Member> | ImportDelta<School>>({
    issues: [],
    updates: [],
    unchanged: [],
    new: new Map(),
    seenIds: new Set(),
  });
  public selectedStatusFilter = signal<FilterStatus>('ISSUE');
  public filteredProposedChanges = computed(() => {
    const delta = this.proposedChanges() as ImportDelta<Member | School>;
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
      } else if (field === 'emails') {
        // Look for 'email' or 'emails' (case-insensitive) if 'emails' is not an exact match
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
    this.selectedStatusFilter.set('ISSUE');
    this.previewIndex.set(0);

    // Give UI a moment to update to 'ANALYZING'
    await new Promise((resolve) => setTimeout(resolve, 100));

    const delta =
      this.importType() === 'member'
        ? this.analyzeMembers()
        : this.analyzeSchools();

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

  // Returns both issues and updates
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
        const diffs = this.getDifferences(member, existing);
        if (diffs.length > 0) {
          delta.updates.push({
            status: 'UPDATE',
            key: memberId,
            newItem: { ...existing, ...member } as Member,
            oldItem: existing,
            diffs,
            issues: undefined,
          });
        } else {
          delta.unchanged.push({
            status: 'UNCHANGED',
            key: memberId,
            newItem: { ...existing, ...member } as Member,
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
      const diffs = this.getDifferences(school, existing);
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


  async executeImport() {
    if (this.importType() === 'member') {
      await this.executeImportMembers();
    } else {
      await this.executeImportSchools();
    }
  }

  async executeImportMembers() {
    this.stage.set('IMPORTING');
    const delta = this.proposedChanges() as ImportDelta<Member>;
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
  }

  async executeImportSchools() {
    this.stage.set('IMPORTING');
    const delta = this.proposedChanges() as ImportDelta<School>;
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
            // Even if it fails mapping, we can keep the raw value as a string cast
            // though it might violate the enum type if we were strict.
            // But for the 'member' object we are building, we'll leave it as is
            // or maybe set it to a default if we have to.
            // Since member is Partial<Member>, we can just not set it if we want to be safe.
          }
          break;
        }
        case 'firstMembershipStarted':
        case 'lastRenewalDate':
        case 'currentMembershipExpires':
        case 'dateOfBirth':
        case 'instructorLicenseRenewalDate':
        case 'instructorLicenseExpires': {
          const result = this.parseDate(value);
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

  private parseDate(value: string): MappingResult<string> {
    if (!value) return { success: true, value: '' };

    // Normalize separators and trim
    const normalizedValue = value.trim();

    // Check for year only (e.g. "1953")
    if (/^\d{4}$/.test(normalizedValue)) {
      const year = parseInt(normalizedValue, 10);
      // Basic sanity check for year range if needed, e.g. 1900-2100
      if (year > 1800 && year < 2200) {
        return { success: true, value: `${year}-01-01` };
      }
    }

    // List of supported formats to try
    // date-fns 2.x/3.x/4.x uses 'yyyy' for year, 'dd' for day, 'MM' for month, 'MMM' for short month name
    // We try multiple formats to be flexible.
    const formats = [
      'yyyy-MM-dd',    // ISO, e.g. 2023-12-31
      'dd/MM/yyyy',    // UK, e.g. 31/12/2023
      // 'd/K/yyyy' removed as K is hour
      'd/M/yyyy',      // single digits, e.g. 1/2/2023
      'yyyy/MM/dd',    // Japan, e.g. 2023/12/31
      'dd-MMM-yyyy',   // e.g. 23-Feb-1953
      'd-MMM-yyyy',    // e.g. 1-Feb-1953
      'dd-MM-yyyy',    // e.g. 23-02-1953
      'd-M-yyyy',      // e.g. 1-2-1953
    ];

    // Attempt to parse with each format
    for (const fmt of formats) {
      // parse(dateString, formatString, referenceDate)
      const parsedDate = parse(normalizedValue, fmt, new Date());
      
      // isValid() checks if the date is valid (e.g. not February 30th)
      if (isValid(parsedDate)) {
        // Additional sanity check: 
        // sometimes simplistic formats can match unexpectedly. 
        // But date-fns is usually good if the format aligns.
        // We format it to standard YYYY-MM-DD
        return { success: true, value: format(parsedDate, 'yyyy-MM-dd') };
      }
    }

    return {
      success: false,
      issue: `Invalid date format: "${value}". Expected YYYY-MM-DD, DD/MM/YYYY, or DD-Mon-YYYY.`,
    };
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
