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
  MasterLevel,
  Order,
  initOrder,
  School
} from '../../../../functions/src/data-model';
import * as Papa from 'papaparse';
import {
  ParsedRow,
  ImportStage,
  FilterStatus,
  ImportDelta,
  getDifferences,
  parseDate,
  parseToDate,
  MappingResult,
  ProposedChange,
  ensureLaterDate
} from '../import-export-utils';
import { format, addYears, isValid, parse, isAfter } from 'date-fns';

export type OrderType = 'ALL' | 'MEMBERSHIP' | 'SCHOOL_LICENSE' | 'INSTRUCTOR_LICENSE' | 'OTHER';

@Component({
  selector: 'app-import-orders',
  standalone: true,
  imports: [CommonModule, SpinnerComponent, ImportMappingComponent],
  templateUrl: './import-orders.component.html',
  styleUrl: './import-orders.component.scss',
})
export class ImportOrdersComponent {
  public dataService = inject(DataManagerService);

  // State
  public stage = signal<ImportStage>('SELECT');
  public importProgress = signal({ current: 0, total: 0 });

  // Data
  public parsedData = signal<ParsedRow[]>([]);
  public headers = signal<string[]>([]);
  public mapping = signal<Record<string, string[]>>({});

  // Analysis / Preview
  public proposedChanges = signal<{
    orders: ImportDelta<Order>;
    memberUpdates: Map<string, { member: Member, oldMember: Member, diffs: { field: string; oldValue: any; newValue: any }[] }>;
    schoolUpdates: Map<string, { school: School, oldSchool: School, diffs: { field: string; oldValue: any; newValue: any }[] }>;
  }>({
    orders: {
      issues: [],
      updates: [],
      unchanged: [],
      new: new Map(),
      seenIds: new Set(),
    },
    memberUpdates: new Map(),
    schoolUpdates: new Map(),
  });

  public selectedStatusFilter = signal<FilterStatus>('ISSUE');
  public selectedTypeFilter = signal<OrderType>('ALL');

  // Computed for UI
  public filteredProposedChanges = computed(() => {
    const delta = this.proposedChanges().orders;
    const filterStatus = this.selectedStatusFilter();
    const filterType = this.selectedTypeFilter();

    let items: ProposedChange<Order>[] = [];

    switch (filterStatus) {
      case 'NEW':
        items = Array.from(delta.new.values());
        break;
      case 'UPDATE':
        items = delta.updates;
        break;
      case 'ISSUE':
        items = delta.issues;
        break;
      case 'UNCHANGED':
        items = delta.unchanged;
        break;
    }

    if (filterType !== 'ALL') {
      items = items.filter(item => this.getOrderType(item.newItem) === filterType);
    }

    return items;
  });

  public stats = computed(() => {
    const delta = this.proposedChanges().orders;
    const allItems = [
      ...Array.from(delta.new.values()),
      ...delta.updates,
      ...delta.issues,
      ...delta.unchanged
    ];

    const countByType = (type: OrderType) => {
      if (type === 'ALL') return allItems.length;
      return allItems.filter(i => this.getOrderType(i.newItem) === type).length;
    };

    return {
      ALL: countByType('ALL'),
      MEMBERSHIP: countByType('MEMBERSHIP'),
      SCHOOL_LICENSE: countByType('SCHOOL_LICENSE'),
      INSTRUCTOR_LICENSE: countByType('INSTRUCTOR_LICENSE'),
      OTHER: countByType('OTHER')
    };
  });

  public previewIndex = signal(0);
  public currentPreviewChange = computed(
    () => this.filteredProposedChanges()[this.previewIndex()],
  );

  public fieldSeparators: Record<string, string> = {};


  private orderFields = Object.keys(initOrder()) as Array<keyof Order>;

  public fieldsToMap = computed(() => {
    return this.orderFields.filter(f => f !== 'id' && f !== 'lastUpdated');
  });

  reset() {
    this.stage.set('SELECT');
    this.parsedData.set([]);
    this.headers.set([]);
    this.mapping.set({});
    this.proposedChanges.set({
      orders: {
        issues: [],
        updates: [],
        unchanged: [],
        new: new Map(),
        seenIds: new Set(),
      },
      memberUpdates: new Map(),
      schoolUpdates: new Map(),
    });
    this.selectedStatusFilter.set('ISSUE');
    this.selectedTypeFilter.set('ALL');
    this.previewIndex.set(0);
    this.importProgress.set({ current: 0, total: 0 });
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
      mapping: Record<string, string[]>,
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
    }
  }

  getDefaultMapping(headers: string[]): Record<string, string[]> {
    const fields = this.fieldsToMap();
    const mapping: Record<string, string[]> = {};

    // Map based on partial matches or exact matches
    const knownMappings: Record<string, string[]> = {
      'referenceNumber': ['Reference Number', 'ref'],
      'externalId': ['External ID', 'ext'],
      'studentOf': ['Student Of'],
      'paidFor': ['Paid For'],
      'newRenew': ['New/Renew'],
      'datePaid': ['Date Paid'],
      'startDate': ['Start Date'],
      'lastName': ['Last Name'],
      'firstName': ['First Name'],
      'email': ['Email'],
      'country': ['Country'],
      'state': ['State'],
      'costUsd': ['Cost USD'],
      'collected': ['Collected'],
      'split': ['Split'],
      'notes': ['Notes']
    };

    fields.forEach((field) => {
      if (headers.includes(field)) {
        mapping[field] = [field];
      } else if (knownMappings[field]) {
        const match = headers.find(h => knownMappings[field].some(km => h.toLowerCase() === km.toLowerCase()));
        if (match) mapping[field] = [match];
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

    // Ensure we have orders loaded for checking duplicates
    await this.dataService.updateOrdersSync();

    const result = this.analyzeOrders();

    this.proposedChanges.set(result);
    this.stage.set('PREVIEW');
  }

  private analyzeOrders() {
    const delta: ImportDelta<Order> = {
      issues: [],
      updates: [],
      unchanged: [],
      new: new Map(),
      seenIds: new Set(),
    };
    const memberUpdates = new Map<string, { member: Member, oldMember: Member, diffs: any[] }>();
    const schoolUpdates = new Map<string, { school: School, oldSchool: School, diffs: any[] }>();

    const data = this.parsedData();
    const existingOrders = this.dataService.orders.entries();
    const ordersMap = new Map(existingOrders.map(o => [o.referenceNumber, o]));
    const members = this.dataService.members.entries();
    const schools = this.dataService.schools.entries();

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const { order, issues } = this.mapRowToOrder(row, this.mapping());

      if (!order.referenceNumber) {
        // Skip empty rows or rows without reference number
        continue;
      }

      if (delta.seenIds.has(order.referenceNumber)) {
        delta.issues.push({
          status: 'ISSUE',
          key: order.referenceNumber,
          newItem: order as Order,
          diffs: [],
          issues: [`Duplicate Reference Number (${order.referenceNumber}) in import file`, ...issues],
        });
        continue;
      }
      delta.seenIds.add(order.referenceNumber);

      // Find Existing Order
      const existingOrder = ordersMap.get(order.referenceNumber);
      let orderChange: ProposedChange<Order> | undefined;

      if (existingOrder) {
        const diffs = getDifferences(order, existingOrder);
        if (diffs.length > 0) {
          orderChange = {
            status: 'UPDATE',
            key: order.referenceNumber,
            newItem: { ...existingOrder, ...order } as Order,
            oldItem: existingOrder,
            diffs: diffs,
            issues: issues.length > 0 ? issues : undefined
          };
          delta.updates.push(orderChange);
        } else {
          orderChange = {
            status: 'UNCHANGED',
            key: order.referenceNumber,
            newItem: existingOrder as Order,
            oldItem: existingOrder,
            diffs: [],
            issues: undefined
          };
          delta.unchanged.push(orderChange);
        }
      } else {
        orderChange = {
          status: 'NEW',
          key: order.referenceNumber,
          newItem: { ...initOrder(), ...order } as Order,
          diffs: [],
          issues: issues.length > 0 ? issues : undefined
        };
        delta.new.set(order.referenceNumber, orderChange);
      }

      if (issues.length > 0) {
        // Our 'issues' array here is things like "Invalid Date".
        // If we have issues, we usually put it in delta.issues instead of new/updates
        if (orderChange.status !== 'ISSUE') {
          delta.issues.push({ ...orderChange, status: 'ISSUE', issues: issues } as any);
          // Remove from others?
          if (orderChange.status === 'NEW') delta.new.delete(order.referenceNumber);
          if (orderChange.status === 'UPDATE') delta.updates.pop();
          if (orderChange.status === 'UNCHANGED') delta.unchanged.pop();
          continue; // Skip side effects if order data is invalid
        }
      }

      // SIDE EFFECTS
      this.calculateSideEffects(order as Order, members, schools, memberUpdates, schoolUpdates, issues);

      // If side effects generated new issues (e.g. Ambiguous Email), add to Order Issues
      if (issues.length > 0) {
        // Re-evaluate if we need to move to ISSUES list
        if (orderChange && orderChange.status !== 'ISSUE') {
          delta.issues.push({ ...orderChange, status: 'ISSUE', issues: issues } as any);
          if (orderChange.status === 'NEW') delta.new.delete(order.referenceNumber);
          if (orderChange.status === 'UPDATE') delta.updates.pop();
          if (orderChange.status === 'UNCHANGED') delta.unchanged.pop();
        }
      }
    }

    return { orders: delta, memberUpdates, schoolUpdates };
  }

  private calculateSideEffects(
    order: Order,
    members: Member[],
    schools: School[],
    memberUpdates: Map<string, { member: Member, oldMember: Member, diffs: any[] }>,
    schoolUpdates: Map<string, { school: School, oldSchool: School, diffs: any[] }>,
    outIssues: string[]
  ) {
    if (!order.paidFor) return;
    const paymentType = order.paidFor.trim();
    const paidDate = parseToDate(order.datePaid);

    if (!paidDate || !isValid(paidDate)) {
      outIssues.push(`Invalid Paid Date: ${order.datePaid}`);
      return;
    }

    // Check for School License
    if (paymentType.includes('School License')) {
      // Match School
      let school: School | undefined;
      if (order.externalId) {
        school = schools.find(s => s.schoolId === order.externalId);
        if (!school) {
          outIssues.push(`School not found with ID: ${order.externalId}`);
          return;
        }
      } else {
        outIssues.push(`School License requires External ID (School ID)`);
        return;
      }

      // Update School
      const oldSchool = school;
      const newSchool = { ...oldSchool };
      let changed = false;

      // Renewal Date
      const potentialNewRenewal = ensureLaterDate(newSchool.schoolLicenseRenewalDate, order.datePaid);
      if (potentialNewRenewal && potentialNewRenewal !== newSchool.schoolLicenseRenewalDate) {
        newSchool.schoolLicenseRenewalDate = potentialNewRenewal;
        changed = true;
      }

      // Expiry Date
      const finalExpiry = this.calculateNewExpiry(newSchool.schoolLicenseExpires, paidDate, order.startDate);

      const finalExpiryStr = format(finalExpiry, 'yyyy-MM-dd');
      if (finalExpiryStr !== newSchool.schoolLicenseExpires) {
        newSchool.schoolLicenseExpires = finalExpiryStr;
        changed = true;
      }

      if (changed) {
        schoolUpdates.set(newSchool.schoolId, {
          school: newSchool,
          oldSchool: oldSchool,
          diffs: getDifferences(newSchool, oldSchool)
        });
      }
      return;
    }

    // Member Matches
    let member: Member | undefined;

    // 1. Try External ID
    if (order.externalId) {
      member = members.find(m => m.memberId === order.externalId);
      if (!member && !order.email) {
        outIssues.push(`Member not found with ID: ${order.externalId}`);
        return;
      }
    }

    // 2. Try Email if ID matched nothing
    if (!member && order.email) {
      const matchedMembers = members.filter(m => m.emails.some(e => e.toLowerCase() === order.email.toLowerCase()));
      if (matchedMembers.length === 1) {
        member = matchedMembers[0];
      } else if (matchedMembers.length > 1) {
        outIssues.push(`Ambiguous Email: ${order.email} matches ${matchedMembers.length} members`);
        return;
      } else {
        // 0 matches
        if (order.externalId) {
          outIssues.push(`Member not found with ID: ${order.externalId} OR Email: ${order.email}`);
        } else {
          outIssues.push(`Member not found with Email: ${order.email}`);
        }
        return;
      }
    }

    if (!member) {
      return;
    }

    // Apply Updates to Member
    const oldMember = member;
    const newMember = { ...oldMember };
    let changed = false;

    const isMembership = [
      'Member Dues - Annual',
      'Member Dues - Life',
      'Member Dues - Life (Partner)',
      'Member Dues - Senior',
      'Member Dues - Student',
      'Member Dues - Minor'
    ].some(t => paymentType === t || paymentType === 'Member Dues - Annual');


    const isInstructorLicense = paymentType.includes("Instructor's License") || paymentType === 'Instructor License';


    if (isMembership && !paymentType.includes('Life')) { // Life members don't expire
      const potentialNewRenewal = ensureLaterDate(newMember.lastRenewalDate, order.datePaid);
      if (potentialNewRenewal && potentialNewRenewal !== newMember.lastRenewalDate) {
        newMember.lastRenewalDate = potentialNewRenewal;
        changed = true;
      }

      const finalExpiry = this.calculateNewExpiry(newMember.currentMembershipExpires, paidDate, order.startDate);

      const finalExpiryStr = format(finalExpiry, 'yyyy-MM-dd');
      if (finalExpiryStr !== newMember.currentMembershipExpires) {
        newMember.currentMembershipExpires = finalExpiryStr;
        changed = true;
      }
    }

    if (isInstructorLicense) {
      const potentialInstRenewal = ensureLaterDate(newMember.instructorLicenseRenewalDate, order.datePaid);
      if (potentialInstRenewal && potentialInstRenewal !== newMember.instructorLicenseRenewalDate) {
        newMember.instructorLicenseRenewalDate = potentialInstRenewal;
        changed = true;
      }

      const finalExpiry = this.calculateNewExpiry(newMember.instructorLicenseExpires, paidDate, order.startDate);

      const finalExpiryStr = format(finalExpiry, 'yyyy-MM-dd');
      if (finalExpiryStr !== newMember.instructorLicenseExpires) {
        newMember.instructorLicenseExpires = finalExpiryStr;
        changed = true;
      }

      if (newMember.instructorLicenseType === InstructorLicenseType.None) {
        newMember.instructorLicenseType = InstructorLicenseType.Annual;
        changed = true;
      }
    }

    if (changed) {
      const existingUpdate = memberUpdates.get(newMember.memberId);
      if (existingUpdate) {
        const mergedMember = { ...existingUpdate.member, ...newMember };
        memberUpdates.set(newMember.memberId, {
          member: newMember,
          oldMember: oldMember,
          diffs: getDifferences(newMember, oldMember)
        });
      } else {
        memberUpdates.set(newMember.memberId, {
          member: newMember,
          oldMember: oldMember,
          diffs: getDifferences(newMember, oldMember)
        });
      }
    }
  }

  private mapRowToOrder(
    row: ParsedRow,
    mapping: Record<string, string[]>,
  ): { order: Partial<Order>; issues: string[] } {
    const order: Partial<Order> = {};
    const issues: string[] = [];
    for (const partialKey in mapping) {
      const key = partialKey as keyof Order;
      const csvHeaders = mapping[key];
      if (!csvHeaders || csvHeaders.length === 0) continue;

      // Take first header value for orders (no multi-header joining needed)
      let value = row[csvHeaders[0]];

      if (value === undefined || value === null) continue;
      value = value.trim();
      if (value === '') continue;

      if (['datePaid', 'startDate', 'lastUpdated'].includes(key)) {
        const result = parseDate(value);
        if (result.success) {
          order[key] = result.value;
        } else {
          issues.push(result.issue);
          (order as any)[key] = value;
        }
      } else {
        (order as any)[key] = value;
      }
    }
    return { order, issues };
  }

  async executeImportOrders() {
    this.stage.set('IMPORTING');
    const ordersDelta = this.proposedChanges().orders;
    const memberUpdates = Array.from(this.proposedChanges().memberUpdates.values());
    const schoolUpdates = Array.from(this.proposedChanges().schoolUpdates.values());

    const newOrders = Array.from(ordersDelta.new.values());
    const orderUpdates = ordersDelta.updates;

    const total = newOrders.length + orderUpdates.length + memberUpdates.length + schoolUpdates.length;
    let currentProcessed = 0;
    this.importProgress.set({ current: 0, total });

    // 1. Process Orders
    for (const change of newOrders) {
      try {
        await this.dataService.addOrder(change.newItem);
      } catch (err) {
        console.error('Failed to add order', change.key, err);
      }
      currentProcessed++;
      this.importProgress.set({ current: currentProcessed, total });
    }

    for (const change of orderUpdates) {
      try {
        await this.dataService.updateOrder(change.oldItem!.id, change.newItem);
      } catch (err) {
        console.error('Failed to update order', change.key, err);
      }
      currentProcessed++;
      this.importProgress.set({ current: currentProcessed, total });
    }

    // 2. Process Side Effects - Members
    for (const update of memberUpdates) {
      try {
        await this.dataService.updateMember(update.member.id, update.member);
      } catch (err) {
        console.error('Failed to update member from order', update.member.memberId, err);
      }
      currentProcessed++;
      this.importProgress.set({ current: currentProcessed, total });
    }

    // 3. Process Side Effects - Schools
    for (const update of schoolUpdates) {
      try {
        await this.dataService.setSchool(update.school);
      } catch (err) {
        console.error('Failed to update school from order', update.school.schoolId, err);
      }
      currentProcessed++;
      this.importProgress.set({ current: currentProcessed, total });
    }

    this.stage.set('COMPLETED');
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

  setTypeFilter(type: OrderType) {
    this.selectedTypeFilter.set(type);
    this.previewIndex.set(0);
  }

  getOrderType(order: Order): OrderType {
    if (!order.paidFor) return 'OTHER';
    const paymentType = order.paidFor.trim();

    if (paymentType.includes('School License')) return 'SCHOOL_LICENSE';
    if (paymentType.includes("Instructor's License") || paymentType === 'Instructor License') return 'INSTRUCTOR_LICENSE';

    const isMembership = [
      'Member Dues - Annual',
      'Member Dues - Life',
      'Member Dues - Life (Partner)',
      'Member Dues - Senior',
      'Member Dues - Student',
      'Member Dues - Minor'
    ].some(t => paymentType === t || paymentType === 'Member Dues - Annual');

    if (isMembership) return 'MEMBERSHIP';

    return 'OTHER';
  }

  // Helpers for UI
  getMemberDiffs(orderReference: string) {
    // This is tricky. We need to map Order Ref -> Member Update.
    // But we computed Member Updates aggregated by Member ID.
    // So we don't have a direct link stored easily in `proposedChanges`.
    // We'd have to re-find it or store it differently.
    // For now, let's just list ALL member/school updates in a separate UI section or
    // try to find relevant one?
    // Since preview focuses on ORDERS, maybe we should show "Associated Side Effects" for that order?
    // But we lost that context in `analyzeOrders` when we aggregated into Map<MemberID>.
    // We could store `causedBy: OrderRef[]` in the member update payload?
    return [];
  }

  private calculateNewExpiry(
    currentExpiryStr: string | undefined | null,
    paidDate: Date,
    startDateStr: string | undefined | null
  ): Date {
    const dates: number[] = [];

    // 1. Paid Date
    if (paidDate && isValid(paidDate)) {
      dates.push(paidDate.getTime());
    }

    // 2. Start Date
    if (startDateStr) {
      const startDate = parseToDate(startDateStr);
      if (startDate && isValid(startDate)) {
        dates.push(startDate.getTime());
      }
    }

    // 3. Current Expiry
    if (currentExpiryStr) {
      const currentExpiry = parseToDate(currentExpiryStr);
      if (currentExpiry && isValid(currentExpiry)) {
        dates.push(currentExpiry.getTime());
      }
    }

    if (dates.length === 0) {
      // Fallback
      return addYears(paidDate, 1);
    }

    const maxTime = Math.max(...dates);
    return addYears(new Date(maxTime), 1);
  }
}
