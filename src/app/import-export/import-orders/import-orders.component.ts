import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImportMappingComponent } from '../import-mapping/import-mapping';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { DataManagerService } from '../../data-manager.service';
import {
  Member,
  initMember,
  MembershipType,
  StudentLevel,
  InstructorLicenseType,
  MasterLevel,
  SheetsImportOrder,
  initSheetsImportOrder,
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
  ensureLaterDate,
  ensureHigherStudentLevel
} from '../import-export-utils';
import { format, addYears, addDays, isValid, parse, isAfter } from 'date-fns';

export type OrderType = 'ALL' | 'MEMBERSHIP' | 'SCHOOL_LICENSE' | 'INSTRUCTOR_LICENSE' | 'GRADING' | 'OTHER';

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
  public importSummary = signal({
    membershipExpirationsIncreased: 0,
    lifeMembers: 0,
    schoolLicenses: 0,
    instructorLicenses: 0,
  });

  // Data
  public parsedData = signal<ParsedRow[]>([]);
  public headers = signal<string[]>([]);
  public mapping = signal<Record<string, string[]>>({});

  // Analysis / Preview
  public proposedChanges = signal<{
    orders: ImportDelta<SheetsImportOrder>;
    memberUpdates: Map<string, { member: Member, oldMember: Member, diffs: { field: string; oldVal: string; newVal: string }[] }>;
    schoolUpdates: Map<string, { school: School, oldSchool: School, diffs: { field: string; oldVal: string; newVal: string }[] }>;
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

    let items: ProposedChange<SheetsImportOrder>[] = [];

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
      GRADING: countByType('GRADING'),
      OTHER: countByType('OTHER')
    };
  });

  public previewIndex = signal(0);
  public currentPreviewChange = computed(
    () => this.filteredProposedChanges()[this.previewIndex()],
  );

  public fieldSeparators: Record<string, string> = {};

  /** Human-readable labels for order fields shown in the preview UI. */
  readonly fieldLabels: Record<string, string> = {
    externalId: 'Member ID',
    referenceNumber: 'Reference Number',
    paidFor: 'Paid For',
    orderType: 'Order Type',
    datePaid: 'Date Paid',
    startDate: 'Start Date',
    firstName: 'First Name',
    lastName: 'Last Name',
    email: 'Email',
    country: 'Country',
    state: 'State',
    costUsd: 'Cost (USD)',
    studentOf: 'Student Of',
    newRenew: 'New/Renew',
    collected: 'Collected',
    split: 'Split',
    notes: 'Notes',
  };

  /** Fields the user can edit inline in the import preview. */
  readonly editableFields = new Set(['externalId', 'firstName', 'lastName', 'email']);

  getFieldLabel(key: string): string {
    return this.fieldLabels[key] || key;
  }

  /**
   * Whether the currently loaded file is in the WooCommerce TSV format
   * (detected by presence of `line_items` and `order_number_formatted` headers).
   */
  private isWooCommerceFormat = false;

  private orderFields = Object.keys(initSheetsImportOrder()) as Array<keyof SheetsImportOrder>;

  public fieldsToMap = computed(() => {
    return this.orderFields.filter(f => f !== 'docId' && f !== 'lastUpdated' && f !== 'ilcAppOrderKind');
  });

  reset() {
    this.stage.set('SELECT');
    this.parsedData.set([]);
    this.headers.set([]);
    this.mapping.set({});
    this.isWooCommerceFormat = false;
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
    this.importSummary.set({
      membershipExpirationsIncreased: 0,
      lifeMembers: 0,
      schoolLicenses: 0,
      instructorLicenses: 0,
    });
  }

  onFileChange(event: Event) {
    this.parsedData.set([]);
    this.headers.set([]);
    this.mapping.set({});
    this.isWooCommerceFormat = false;
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

    const isTsv = file.name.endsWith('.tsv') || file.type === 'text/tab-separated-values';
    const isCsv = file.type === 'text/csv' || file.name.endsWith('.csv');

    if (isCsv || isTsv) {
      // Read file as text first so we can retry with a different delimiter if needed.
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) return;

        // First attempt: use tab for TSV, auto-detect for CSV
        let result = Papa.parse<ParsedRow>(text, {
          header: true,
          skipEmptyLines: true,
          delimiter: isTsv ? '\t' : undefined,
        });
        let headers = result.meta.fields ?? [];

        // If auto-detection produced mangled headers (a header name contains a tab),
        // the file is likely tab-separated content saved with a .csv extension.
        // Retry with tab delimiter.
        if (!isTsv && headers.some(h => h.includes('\t'))) {
          result = Papa.parse<ParsedRow>(text, {
            header: true,
            skipEmptyLines: true,
            delimiter: '\t',
          });
          headers = result.meta.fields ?? [];
        }

        // Detect WooCommerce format by its distinctive headers
        this.isWooCommerceFormat = headers.includes('line_items') && headers.includes('order_number_formatted');
        onUploadComplete(
          headers,
          result.data,
          this.getDefaultMapping(headers),
        );
      };
      reader.readAsText(file);
    }
  }

  getDefaultMapping(headers: string[]): Record<string, string[]> {
    const fields = this.fieldsToMap();
    const mapping: Record<string, string[]> = {};

    // Map based on partial matches or exact matches
    const knownMappings: Record<string, string[]> = {
      'orderType': ['order', 'type', 'entry type'],
      'referenceNumber': ['Reference Number', 'ref', 'Order #', 'Order ID', 'Reference', 'order_number_formatted', 'transaction ID'],
      'externalId': ['External ID', 'ext', 'Member ID', 'Customer ID', 'Student ID', 'Student Member ID'],
      'studentOf': ['Student Of', 'instructor'],
      'paidFor': ['Paid For', 'Product', 'Item', 'Description', 'membership type', 'member type'],
      'newRenew': ['New/Renew', 'status'],
      'datePaid': ['Date Paid', 'Payment Date', 'Date', 'order_date'],
      'startDate': ['Start Date'],
      'lastName': ['Last Name', 'Surname', 'last_name'],
      'firstName': ['First Name', 'Forename', 'Given Name', 'first_name'],
      'email': ['Email', 'Email Address', 'billing_email'],
      'country': ['Country', 'billing_country'],
      'state': ['State', 'Region', 'billing_state'],
      'costUsd': ['Cost USD', 'Price', 'Amount'],
      'collected': ['Collected'],
      'split': ['Split'],
      'notes': ['Notes', 'Comments']
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
    const delta: ImportDelta<SheetsImportOrder> = {
      issues: [],
      updates: [],
      unchanged: [],
      new: new Map(),
      seenIds: new Set(),
    };
    const memberUpdates = new Map<string, { member: Member, oldMember: Member, diffs: any[] }>();
    const schoolUpdates = new Map<string, { school: School, oldSchool: School, diffs: any[] }>();

    const data = this.parsedData();
    const allExistingOrders = this.dataService.orders.entries();
    const existingOrders = allExistingOrders.filter((o) => {
      return o.ilcAppOrderKind !== 'https://api.squarespace.com/1.0/commerce/orders';
    });
    const ordersMap = new Map(existingOrders.map(o => [o.referenceNumber, o]));
    const members = this.dataService.members.entries();
    const schools = this.dataService.schools.entries();

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      let order: Partial<SheetsImportOrder>;
      let issues: string[];

      if (this.isWooCommerceFormat) {
        const result = this.mapWooCommerceRowToSheetsImportOrder(row);
        order = result.order;
        issues = result.issues;
      } else {
        const result = this.mapRowToSheetsImportOrder(row, this.mapping());
        order = result.order;
        issues = result.issues;
      }

      if (!order.referenceNumber) {
        // Skip empty rows or rows without reference number
        continue;
      }

      if (delta.seenIds.has(order.referenceNumber)) {
        delta.issues.push({
          status: 'ISSUE',
          key: order.referenceNumber,
          newItem: order as SheetsImportOrder,
          diffs: [],
          issues: [`Duplicate Reference Number (${order.referenceNumber}) in import file`, ...issues],
        });
        continue;
      }
      delta.seenIds.add(order.referenceNumber);

      // Find Existing Order
      const existingOrder = ordersMap.get(order.referenceNumber);
      let orderChange: ProposedChange<SheetsImportOrder> | undefined;

      if (existingOrder) {
        const diffs = getDifferences(order, existingOrder);
        if (diffs.length > 0) {
          orderChange = {
            status: 'UPDATE',
            key: order.referenceNumber,
            newItem: { ...existingOrder, ...order } as SheetsImportOrder,
            oldItem: existingOrder,
            diffs: diffs,
            issues: issues.length > 0 ? issues : undefined
          };
          delta.updates.push(orderChange);
        } else {
          orderChange = {
            status: 'UNCHANGED',
            key: order.referenceNumber,
            newItem: existingOrder as SheetsImportOrder,
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
          newItem: { ...initSheetsImportOrder(), ...order } as SheetsImportOrder,
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
      this.calculateSideEffects(order as SheetsImportOrder, members, schools, memberUpdates, schoolUpdates, issues);

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
    order: SheetsImportOrder,
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
      if (!member) {
        outIssues.push(`Member ID "${order.externalId}" not found`);
      // Continue to try email/name fallback below
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
      }
    }

    // 3. Try Name if email also failed
    if (!member && (order.firstName || order.lastName)) {
      const fullName = `${order.firstName} ${order.lastName}`.trim().toLowerCase();
      if (fullName) {
        const byName = members.filter(m => m.name.toLowerCase() === fullName);
        if (byName.length === 1) {
          member = byName[0];
        } else if (byName.length > 1) {
          outIssues.push(`Ambiguous Name: "${fullName}" matches ${byName.length} members`);
          return;
        }
      }
    }

    if (!member) {
      const identifiers = [
        order.externalId ? `ID: ${order.externalId}` : '',
        order.email ? `Email: ${order.email}` : '',
        (order.firstName || order.lastName) ? `Name: ${order.firstName} ${order.lastName}`.trim() : '',
      ].filter(Boolean).join(', ');
      outIssues.push(`Member not found (${identifiers || 'no identifying info'})`);
      return;
    }

    // Update order.externalId to the matched member's ID so the
    // member changes preview can look it up.
    order.externalId = member.memberId;

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
      'Member Dues - Minor',
      'Student Membership - Lifetime',
      'Student Membership - Senior Lifetime',
    ].some(t => paymentType === t);

    const isLifeMembership = isMembership && paymentType.includes('Life');


    const isInstructorLicense = paymentType.includes("Instructor's License") || paymentType === 'Instructor License';


    if (isLifeMembership) {
      // Life members don't expire — just set the membership type
      if (newMember.membershipType !== MembershipType.Life) {
        newMember.membershipType = MembershipType.Life;
        changed = true;
      }
    } else if (isMembership) {
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
      let updatedRenewalDate = newMember.instructorLicenseRenewalDate;
      if (potentialInstRenewal && potentialInstRenewal !== newMember.instructorLicenseRenewalDate) {
        newMember.instructorLicenseRenewalDate = potentialInstRenewal;
        updatedRenewalDate = potentialInstRenewal;
        changed = true;
      }

      let renewalDateObj = parseToDate(updatedRenewalDate);
      if (!renewalDateObj || !isValid(renewalDateObj)) {
        renewalDateObj = paidDate;
      }
      // Instructor license is valid for exactly 1 year from the renewal date.
      const newExpiryObj = addYears(renewalDateObj, 1);

      const prevExpiryObj = parseToDate(oldMember.instructorLicenseExpires);
      const prevExpiryTime = (prevExpiryObj && isValid(prevExpiryObj)) ? prevExpiryObj.getTime() : 0;

      const finalExpiryTime = Math.max(prevExpiryTime, newExpiryObj.getTime());
      const finalExpiryStr = format(finalExpiryTime, 'yyyy-MM-dd');

      if (finalExpiryStr !== newMember.instructorLicenseExpires) {
        newMember.instructorLicenseExpires = finalExpiryStr;
        changed = true;
      }

      if (newMember.instructorLicenseType !== InstructorLicenseType.Annual) {
        newMember.instructorLicenseType = InstructorLicenseType.Annual;
        changed = true;
      }
    }

    // Checking for Gradings
    const isGrading = order.orderType?.toLowerCase() === 'grading' || paymentType.toLowerCase().includes('student level');
    if (isGrading) {
      const levelMatch = paymentType.match(/Student Level\s*(\d+)/i);
      if (levelMatch) {
        const newLevel = levelMatch[1] as StudentLevel;
        // Only update if it's a higher level or different
        const higherLevel = ensureHigherStudentLevel(newMember.studentLevel, newLevel) as StudentLevel;
        if (higherLevel !== undefined && higherLevel !== newMember.studentLevel) {
          newMember.studentLevel = higherLevel;
          changed = true;
        }
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

  private mapRowToSheetsImportOrder(
    row: ParsedRow,
    mapping: Record<string, string[]>,
  ): { order: Partial<SheetsImportOrder>; issues: string[] } {
    const order: SheetsImportOrder = initSheetsImportOrder();
    const issues: string[] = [];
    for (const partialKey in mapping) {
      const key = partialKey as keyof SheetsImportOrder;
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
          (order as any)[key] = result.value;
        } else {
          issues.push(result.issue);
          (order as any)[key] = value;
        }
      } else {
        (order as any)[key] = value;
      }
    }

    // Fallback: if datePaid is empty but startDate is set, use startDate as datePaid
    if (!order.datePaid && order.startDate) {
      order.datePaid = order.startDate;
    }

    return { order, issues };
  }

  // ─── WooCommerce TSV format support ──────────────────────────────

  /**
   * Parse the WooCommerce `line_items` field.
   *
   * Example value:
   *   id:368|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1
   *   |subtotal:500.00|...|meta:Membership Level=Lifetime,Member Number=aus-wa-014,
   *   Student Of=Shane ODonnell,...
   *
   * Returns a flat key→value map of the top-level pipe fields *and*
   * the comma-separated meta entries (prefixed with `meta.`).
   */
  private parseWooCommerceLineItems(lineItems: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!lineItems) return result;

    // Split on `|` but be aware that meta values can contain commas
    // and backslash-escaped commas within address fields.
    // Handle multiple line items separated by ';' — parse only the first item
    // (the membership item) for order-level fields.
    const firstItem = lineItems.split(';')[0].trim();

    // Strategy: find the `meta:` portion first, then parse the rest.
    const metaIndex = firstItem.indexOf('|meta:');
    let topPart: string;
    let metaPart = '';

    if (metaIndex !== -1) {
      topPart = firstItem.substring(0, metaIndex);
      metaPart = firstItem.substring(metaIndex + 6); // skip "|meta:"
    } else {
      topPart = firstItem;
    }

    // Parse top-level pipe-separated fields
    for (const segment of topPart.split('|')) {
      const colonIdx = segment.indexOf(':');
      if (colonIdx === -1) continue;
      const key = segment.substring(0, colonIdx).trim();
      const value = segment.substring(colonIdx + 1).trim();
      result[key] = value;
    }

    // Parse meta: comma-separated key=value pairs.
    // Values can contain backslash-escaped commas (\,) inside addresses,
    // so we split only on commas NOT preceded by a backslash.
    if (metaPart) {
      // Replace escaped commas with a placeholder
      const placeholder = '\x00';
      const safeMeta = metaPart.replace(/\\,/g, placeholder);
      for (const entry of safeMeta.split(',')) {
        const eqIdx = entry.indexOf('=');
        if (eqIdx === -1) continue;
        const key = entry.substring(0, eqIdx).trim();
        const value = entry.substring(eqIdx + 1).trim().replace(new RegExp(placeholder, 'g'), ',');
        result['meta.' + key] = value;
      }
    }

    return result;
  }

  /**
   * Map a row from the WooCommerce-style TSV export into a SheetsImportOrder.
   * The `externalId` (member ID) is set from the `Member Number` in line_items
   * meta. If that's absent, we fall back to email lookup. The actual member
   * validation is handled later by `calculateSideEffects`.
   */
  private mapWooCommerceRowToSheetsImportOrder(
    row: ParsedRow,
  ): { order: Partial<SheetsImportOrder>; issues: string[] } {
    const order: SheetsImportOrder = initSheetsImportOrder();
    const issues: string[] = [];

    // Reference number
    order.referenceNumber = (row['order_number_formatted'] || row['order_number'] || '').trim();

    // Date paid
    const rawDate = (row['order_date'] || '').trim();
    if (rawDate) {
      // The format is "2018-01-06 16:50:00" — strip time portion for date parsing
      const dateOnly = rawDate.split(' ')[0];
      const result = parseDate(dateOnly);
      if (result.success) {
        order.datePaid = result.value;
      } else {
        issues.push(result.issue);
        order.datePaid = rawDate;
      }
    }

    // Column-level fallback fields (used if meta doesn't have them)
    const colFirstName = (row['first_name'] || '').trim();
    const colLastName = (row['last_name'] || '').trim();
    const colEmail = (row['billing_email'] || '').trim();
    order.country = (row['billing_country'] || '').trim();
    order.state = (row['billing_state'] || '').trim();

    // Parse line_items for rich metadata
    const lineItemsRaw = (row['line_items'] || '').trim();
    if (lineItemsRaw) {
      const li = this.parseWooCommerceLineItems(lineItemsRaw);

      // Product name → paidFor
      if (li['name']) {
        order.paidFor = li['name'];
      }

      // Store the full raw line_items into notes so nothing is lost
      order.notes = lineItemsRaw;

      // Cost
      if (li['total']) {
        order.costUsd = li['total'];
      } else if (li['subtotal']) {
        order.costUsd = li['subtotal'];
      }

      // Student Of from meta
      if (li['meta.Student Of']) {
        order.studentOf = li['meta.Student Of'];
      }

      // ─── Name: prefer meta "Name" or "Your Name" over billing columns ───
      const metaName = (li['meta.Name'] || li['meta.Your Name'] || '').trim();
      if (metaName) {
        // Split "First Last" into firstName and lastName
        const parts = metaName.split(/\s+/);
        order.firstName = parts[0] || '';
        order.lastName = parts.slice(1).join(' ') || '';
      } else {
        order.firstName = colFirstName;
        order.lastName = colLastName;
      }

      // ─── Email: prefer meta Email over billing column ───
      const metaEmail = (li['meta.Email'] || '').trim();
      order.email = metaEmail || colEmail;

      // Membership Level → orderType
      const membershipLevel = li['meta.Membership Level'] || '';
      if (membershipLevel) {
        order.orderType = `Membership: ${membershipLevel}`;
      }

      // ─── Set externalId (member ID) ───────────────────────
      const memberNumber = (li['meta.Member Number'] || '').trim();
      if (memberNumber && memberNumber !== 'N/A' && memberNumber !== 'NA') {
        order.externalId = this.cleanMemberId(memberNumber);
      }
    } else {
      // No line_items — use column values directly
      order.firstName = colFirstName;
      order.lastName = colLastName;
      order.email = colEmail;
    }

    return { order, issues };
  }

  /**
   * Clean up a member ID by extracting the canonical pattern:
   * 1–3 letters followed by digits. Anything after the digits that is
   * not a digit indicates the end of the member ID.
   * E.g. "PL62WLKP89" → "PL62", "US431-71" → "US431", "US318AZ" → "US318".
   * If the pattern doesn't match (e.g. "aus-wa-014"), returns the original string.
   */
  private cleanMemberId(raw: string): string {
    const match = raw.match(/^([A-Za-z]{1,3}\d+)/);
    return match ? match[1].toUpperCase() : raw;
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
        await this.dataService.updateOrder(change.oldItem!.docId, change.newItem);
      } catch (err) {
        console.error('Failed to update order', change.key, err);
      }
      currentProcessed++;
      this.importProgress.set({ current: currentProcessed, total });
    }

    // 2. Process Side Effects - Members
    for (const update of memberUpdates) {
      try {
        await this.dataService.updateMember(update.member.docId, update.member, update.oldMember);
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

    // Compute Summary
    let membershipExpirationsIncreased = 0;
    for (const update of memberUpdates) {
      const expDiff = update.diffs.find(d => d.field === 'currentMembershipExpires');
      if (expDiff && new Date(expDiff.newVal) > new Date(expDiff.oldVal)) {
        membershipExpirationsIncreased++;
      }
    }

    const allOrdersToProcess = [...newOrders, ...orderUpdates].map(o => o.newItem);
    let lifeMembers = allOrdersToProcess.filter(o => o.paidFor?.toLowerCase().includes('life')).length;
    let schoolLicenses = allOrdersToProcess.filter(o => this.getOrderType(o) === 'SCHOOL_LICENSE').length;
    let instructorLicenses = allOrdersToProcess.filter(o => this.getOrderType(o) === 'INSTRUCTOR_LICENSE').length;

    this.importSummary.set({
      membershipExpirationsIncreased,
      lifeMembers,
      schoolLicenses,
      instructorLicenses
    });

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

  onFieldEdit(orderKey: string, field: string, event: Event) {
    const newValue = (event.target as HTMLInputElement).value.trim();
    this.proposedChanges.update(pc => {
      // Update in the 'new' map
      const newEntry = pc.orders.new.get(orderKey);
      if (newEntry) {
        (newEntry.newItem as any)[field] = newValue;
      }
      // Update in the 'issues' list
      const issueEntry = pc.orders.issues.find(i => i.key === orderKey);
      if (issueEntry) {
        (issueEntry.newItem as any)[field] = newValue;
      }
      // Update in the 'updates' list
      const updateEntry = pc.orders.updates.find(u => u.key === orderKey);
      if (updateEntry) {
        (updateEntry.newItem as any)[field] = newValue;
      }
      return { ...pc };
    });
  }

  /**
   * Pure validation: checks if the order's member ID, email, or name
   * matches a real member/school. Returns issues and the matched member ID.
   */
  private validateOrder(order: Partial<SheetsImportOrder>): {
    issues: string[];
    matched: boolean;
    matchedMemberId?: string;
  } {
    const members = this.dataService.members.entries();
    const schools = this.dataService.schools.entries();
    const issues: string[] = [];
    let matched = false;
    let matchedMemberId: string | undefined;

    // 1. Try Member ID
    if (order.externalId) {
      const memberById = members.find(m => m.memberId === order.externalId);
      const schoolById = schools.find(s => s.schoolId === order.externalId);
      if (memberById || schoolById) {
        matched = true;
        matchedMemberId = order.externalId;
      } else {
        issues.push(`Member ID "${order.externalId}" not found`);
      }
    }

    // 2. Try Email
    if (!matched && order.email) {
      const byEmail = members.filter(m =>
        m.emails.some(e => e.toLowerCase() === order.email!.toLowerCase())
      );
      if (byEmail.length === 1) {
        matched = true;
        matchedMemberId = byEmail[0].memberId;
        issues.length = 0; // Clear earlier "ID not found" — matched by email
      } else if (byEmail.length > 1) {
        issues.push(`Ambiguous email: ${order.email} matches ${byEmail.length} members`);
      }
    }

    // 3. Try Name
    if (!matched && (order.firstName || order.lastName)) {
      const fullName = `${order.firstName} ${order.lastName}`.trim().toLowerCase();
      if (fullName) {
        const byName = members.filter(m => m.name.toLowerCase() === fullName);
        if (byName.length === 1) {
          matched = true;
          matchedMemberId = byName[0].memberId;
          issues.length = 0; // Clear earlier issues — matched by name
        } else if (byName.length > 1) {
          issues.push(`Ambiguous name: "${fullName}" matches ${byName.length} members`);
        } else {
          issues.push(`No member found matching name "${fullName}"`);
        }
      }
    }

    if (!matched && issues.length === 0) {
      issues.push('No Member ID, email, or name — cannot match to a member');
    }

    return { issues, matched, matchedMemberId };
  }

  /**
   * Re-validate the current order after the user edits fields.
   * Updates the displayed issues and match status WITHOUT moving
   * the order between categories. Use `acceptMatch` to actually move it.
   */
  revalidateOrder(orderKey: string) {
    this.proposedChanges.update(pc => {
      const entry = pc.orders.new.get(orderKey)
        || pc.orders.issues.find(i => i.key === orderKey)
        || pc.orders.updates.find(u => u.key === orderKey);
      if (!entry) return pc;

      const order = entry.newItem as SheetsImportOrder;
      const result = this.validateOrder(order);

      // Update the entry's issues in-place, but don't move categories
      entry.issues = result.issues.length > 0 ? result.issues : undefined;

      // If matched, update externalId so member changes preview works
      if (result.matched && result.matchedMemberId) {
        order.externalId = result.matchedMemberId;
        // Add informational message if matched by email/name (not by ID)
        if (!entry.issues) {
          entry.issues = [`✓ Matched to member ${result.matchedMemberId}`];
        }
      }

      return { ...pc };
    });
  }

  /**
   * Accept the current match and move the order from issues → new/update.
   * Only call this after validation passes.
   */
  acceptMatch(orderKey: string) {
    this.proposedChanges.update(pc => {
      const entry = pc.orders.issues.find(i => i.key === orderKey);
      if (!entry) return pc;

      const order = entry.newItem as SheetsImportOrder;
      const result = this.validateOrder(order);
      if (!result.matched) return pc; // safety: don't move if still invalid

      if (result.matchedMemberId) {
        order.externalId = result.matchedMemberId;
      }

      // Remove from issues
      pc.orders.issues = pc.orders.issues.filter(i => i.key !== orderKey);

      // Check if it's an update to an existing order
      let existingOrder: SheetsImportOrder | undefined;
      this.dataService.orders.entriesMap().forEach(o => {
        if ((o as SheetsImportOrder).referenceNumber === orderKey) {
          existingOrder = o as SheetsImportOrder;
        }
      });

      const newEntry: ProposedChange<SheetsImportOrder> = {
        ...entry,
        issues: undefined,
        status: existingOrder ? 'UPDATE' : 'NEW',
      };

      if (existingOrder) {
        newEntry.diffs = getDifferences(order, existingOrder);
        pc.orders.updates.push(newEntry);
      } else {
        pc.orders.new.set(orderKey, newEntry);
      }

      return { ...pc };
    });
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

  getOrderType(order: SheetsImportOrder): OrderType {
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
      'Member Dues - Minor',
      'Student Membership - Lifetime',
      'Student Membership - Senior Lifetime',
    ].some(t => paymentType === t);

    if (isMembership) return 'MEMBERSHIP';

    if (order.orderType?.toLowerCase() === 'grading' || paymentType.toLowerCase().includes('student level')) return 'GRADING';

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
