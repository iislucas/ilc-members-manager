import { Component, inject, input, output, signal, computed, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SquareSpaceOrder, SquareSpaceLineItem, Member, School, OrderStatus } from '../../../../functions/src/data-model';
import { computeRenewalAndExpiration } from '../../../../functions/src/squarespace-orders/common';
import { DataManagerService } from '../../data-manager.service';
import { IconComponent } from '../../icons/icon.component';
import { AutocompleteComponent } from '../../autocomplete/autocomplete';

// Describes the expiry date effect of a line item.
export interface ExpiryPreview {
  label: string; // e.g. 'Membership', 'Instructor License', etc.
  renewalDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  isRecorded: boolean; // true if from processed order, false if preview
  // Resolved entity info (member or school).
  entityId: string; // The member ID or school ID resolved.
  entityName: string; // The member name or school name, empty if not found.
  entityFound: boolean; // True if the entity was found in the database.
  entityKind: 'member' | 'school'; // What kind of entity this targets.
  entityProfileLink: string; // Link to profile e.g. '#/members/US123', empty if N/A.
  originalEntityId?: string;
  isOverridden?: boolean;
}

// SKU patterns that change an expiry date and their renewal durations (months).
const EXPIRY_SKU_CONFIG: {
  match: (sku: string) => boolean;
  label: string;
  months: number;
  entityKind: 'member' | 'school';
}[] = [
    { match: (sku) => sku.startsWith('MEM-YEAR-'), label: 'Membership', months: 12, entityKind: 'member' },
    { match: (sku) => sku.startsWith('MEM-LIFE-'), label: 'Life Membership', months: 0, entityKind: 'member' },
    { match: (sku) => sku === 'VID-LIBRARY', label: 'Video Library', months: 1, entityKind: 'member' },
    { match: (sku) => sku === 'LIS-YEAR-GL' || sku === 'LIS-YEAR-INS' || sku === 'LIS-YEAR-LI', label: 'Instructor License', months: 12, entityKind: 'member' },
    { match: (sku) => sku === 'LIS-SCH-YRL', label: 'School License (Annual)', months: 12, entityKind: 'school' },
    { match: (sku) => sku === 'LIS-SCH-MTH', label: 'School License (Monthly)', months: 1, entityKind: 'school' },
  ];

function getExpiryConfig(sku: string) {
  for (const config of EXPIRY_SKU_CONFIG) {
    if (config.match(sku)) return config;
  }
  return undefined;
}

// Extract entity IDs from a line item's customization fields.
function extractMemberIdFromCustomizations(lineItem: SquareSpaceLineItem): string {
  for (const c of lineItem.customizations || []) {
    if (!c.label || !c.value) continue;
    // Match both 'MemberID' and 'Member ID' (and variations).
    const normalized = c.label.toLowerCase().replace(/\s+/g, '');
    if (normalized.includes('memberid')) {
      return c.value.trim();
    }
  }
  return '';
}

function extractSchoolIdFromCustomizations(lineItem: SquareSpaceLineItem): string {
  for (const c of lineItem.customizations || []) {
    if (!c.label || !c.value) continue;
    const normalized = c.label.toLowerCase().replace(/\s+/g, '');
    if (normalized.includes('schoolid')) {
      return c.value.trim();
    }
  }
  return '';
}

@Component({
  selector: 'app-squarespace-order-view',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, AutocompleteComponent],
  templateUrl: './squarespace-order-view.html',
  styleUrl: './squarespace-order-view.scss'
})
export class SquarespaceOrderView {
  dataService = inject(DataManagerService);

  schoolDisplayFns = {
    toChipId: (s: School) => s.schoolId,
    toName: (s: School) => s.schoolName,
  };

  order = input.required<SquareSpaceOrder>();
  orderUpdated = output<void>();

  // Per-line-item UI state, keyed by line item id.
  memberLookupResults = signal<Map<string, Member[]>>(new Map());
  fulfillmentMenuOpen = signal(false);
  memberIdInputs = signal<Map<string, string>>(new Map());
  schoolIdInputs = signal<Map<string, string>>(new Map());
  countryOverrideInputs = signal<Map<string, string>>(new Map());
  savingLineItems = signal<Set<string>>(new Set());

  constructor() {
    effect(() => {
      const ord = this.order(); // Track order changes
      if (!ord || !ord.lineItems) return;

      const memberMap = untracked(() => new Map(this.memberIdInputs()));
      const schoolMap = untracked(() => new Map(this.schoolIdInputs()));
      const countryMap = untracked(() => new Map(this.countryOverrideInputs()));
      let changed = false;

      for (const item of ord.lineItems) {
        const hasUnsaved = untracked(() => this.hasUnsavedChange(item));
        if (!hasUnsaved && item.ilcAppMemberIdInferred) {
          if (memberMap.get(item.id) !== item.ilcAppMemberIdInferred) {
            memberMap.set(item.id, item.ilcAppMemberIdInferred);
            changed = true;
          }
        }

        const hasSchoolUnsaved = untracked(() => this.hasSchoolUnsavedChange(item));
        if (!hasSchoolUnsaved && item.ilcAppSchoolIdInferred) {
          if (schoolMap.get(item.id) !== item.ilcAppSchoolIdInferred) {
            schoolMap.set(item.id, item.ilcAppSchoolIdInferred);
            changed = true;
          }
        }

        const hasCountryUnsaved = untracked(() => this.hasCountryUnsavedChange(item));
        if (!hasCountryUnsaved && item.ilcAppCountryOverride) {
          if (countryMap.get(item.id) !== item.ilcAppCountryOverride) {
            countryMap.set(item.id, item.ilcAppCountryOverride);
            changed = true;
          }
        }
      }

      if (changed) {
        this.memberIdInputs.set(memberMap);
        this.schoolIdInputs.set(schoolMap);
        this.countryOverrideInputs.set(countryMap);
      }
    });
  }

  // Computed signal: for each line item, produces the expiry preview (or null).
  // Reactive to: order(), dataService.members.entriesMap(), dataService.schools.entriesMap().
  lineItemPreviews = computed(() => {
    const o = this.order();
    const membersMap = this.dataService.members.entriesMap();
    const schoolsMap = this.dataService.schools.entriesMap();
    const result = new Map<string, ExpiryPreview | null>();

    for (const item of o.lineItems || []) {
      if (!item.sku) {
        result.set(item.id, null);
        continue;
      }

      const config = getExpiryConfig(item.sku);
      if (!config) {
        result.set(item.id, null);
        continue;
      }

      // Resolve entity (member or school) and read its current expiry date.
      let entityId = '';
      let entityName = '';
      let entityFound = false;
      let entityProfileLink = '';
      let currentExpiry = '';
      let originalId = '';
      let isOverridden = false;

      if (config.entityKind === 'member') {
        originalId = extractMemberIdFromCustomizations(item);
        entityId = item.ilcAppMemberIdInferred || originalId;
        isOverridden = !!item.ilcAppMemberIdInferred && item.ilcAppMemberIdInferred !== originalId;
        if (entityId) {
          const member = this.dataService.getMemberByMemberId(entityId);
          if (member) {
            entityName = member.name;
            entityFound = true;
            entityProfileLink = '#/members/' + entityId;
            // Read the current expiry for the relevant subscription type.
            if (config.label === 'Membership' || config.label === 'Life Membership') {
              currentExpiry = member.currentMembershipExpires || '';
            } else if (config.label === 'Instructor License') {
              currentExpiry = member.instructorLicenseExpires || '';
            } else if (config.label === 'Video Library') {
              currentExpiry = member.classVideoLibraryExpirationDate || '';
            }
          }
        }
      } else {
        originalId = extractSchoolIdFromCustomizations(item);
        entityId = item.ilcAppSchoolIdInferred || originalId;
        isOverridden = !!item.ilcAppSchoolIdInferred && item.ilcAppSchoolIdInferred !== originalId;
        if (entityId) {
          const school = schoolsMap.get(entityId) as School | undefined;
          if (school) {
            entityName = school.schoolName;
            entityFound = true;
            currentExpiry = school.schoolLicenseExpires || '';
          }
        }
      }

      // If the order has been processed and dates are recorded, show recorded values.
      if (item.ilcAppNewLastRenewalDate && item.ilcAppNewExpiryDate) {
        result.set(item.id, {
          label: config.label,
          renewalDate: item.ilcAppNewLastRenewalDate,
          expiryDate: item.ilcAppNewExpiryDate,
          isRecorded: true,
          entityId, entityName, entityFound,
          entityKind: config.entityKind,
          entityProfileLink,
          originalEntityId: originalId,
          isOverridden,
        });
        continue;
      }

      // If no entity ID is known at all, we can't show a meaningful preview.
      if (!entityId) {
        result.set(item.id, null);
        continue;
      }

      // Compute a preview based on the order creation date.
      const orderDate = o.createdOn ? o.createdOn.substring(0, 10) : '';
      if (!orderDate) {
        result.set(item.id, null);
        continue;
      }

      // Life memberships get a special expiry.
      if (config.months === 0) {
        result.set(item.id, {
          label: config.label,
          renewalDate: orderDate,
          expiryDate: '9999-12-31',
          isRecorded: false,
          entityId, entityName, entityFound,
          entityKind: config.entityKind,
          entityProfileLink,
          originalEntityId: originalId,
          isOverridden,
        });
        continue;
      }

      // For regular renewals, compute preview dates using the entity's
      // current expiry. This mirrors the backend: renewalDate = max(currentExpiry, orderDate),
      // newExpiry = renewalDate + months.
      const { renewalDate, expirationDate } = computeRenewalAndExpiration(currentExpiry, orderDate, config.months);
      result.set(item.id, {
        label: config.label,
        renewalDate,
        expiryDate: expirationDate,
        isRecorded: false,
        entityId, entityName, entityFound,
        entityKind: config.entityKind,
        entityProfileLink,
        originalEntityId: originalId,
        isOverridden,
      });
    }

    return result;
  });

  lookupMemberByEmail(lineItem: SquareSpaceLineItem) {
    const email = this.getEmailForLineItem(lineItem);
    if (!email) return;

    const results = this.dataService.lookupMembersByEmail(email);
    const map = new Map(this.memberLookupResults());
    map.set(lineItem.id, results);
    this.memberLookupResults.set(map);
  }

  getEmailForLineItem(lineItem: SquareSpaceLineItem): string {
    // Try to find email in customizations first
    for (const c of lineItem.customizations || []) {
      if (c.label?.toLowerCase().includes('email') && c.value) {
        return c.value.trim();
      }
    }
    // Fall back to order customer email
    return this.order().customerEmail || '';
  }

  getInferredMemberId(lineItem: SquareSpaceLineItem): string {
    // First check the input map for unsaved edits
    const inputMap = this.memberIdInputs();
    if (inputMap.has(lineItem.id)) {
      return inputMap.get(lineItem.id) || '';
    }
    return lineItem.ilcAppMemberIdInferred || '';
  }

  setInferredMemberIdInput(lineItemId: string, value: string) {
    const map = new Map(this.memberIdInputs());
    map.set(lineItemId, value);
    this.memberIdInputs.set(map);
  }

  selectMemberForLineItem(lineItemId: string, memberId: string) {
    this.setInferredMemberIdInput(lineItemId, memberId);
  }

  async saveInferredMemberId(lineItem: SquareSpaceLineItem) {
    const memberId = this.getInferredMemberId(lineItem);
    const orderId = this.order().docId;
    if (!orderId) return;

    const saving = new Set(this.savingLineItems());
    saving.add(lineItem.id);
    this.savingLineItems.set(saving);

    try {
      await this.dataService.setOrderLineItemInferredMemberId(
        orderId, lineItem.id, memberId
      );
      // Clear the input state after successful save
      const map = new Map(this.memberIdInputs());
      map.delete(lineItem.id);
      this.memberIdInputs.set(map);
      this.orderUpdated.emit();
    } catch (e: unknown) {
      alert(`Error saving inferred member ID: ${(e as Error).message}`);
    } finally {
      const saving = new Set(this.savingLineItems());
      saving.delete(lineItem.id);
      this.savingLineItems.set(saving);
    }
  }

  hasUnsavedChange(lineItem: SquareSpaceLineItem): boolean {
    const inputMap = this.memberIdInputs();
    if (!inputMap.has(lineItem.id)) return false;
    return inputMap.get(lineItem.id) !== (lineItem.ilcAppMemberIdInferred || '');
  }

  getInferredSchoolId(lineItem: SquareSpaceLineItem): string {
    const inputMap = this.schoolIdInputs();
    if (inputMap.has(lineItem.id)) {
      return inputMap.get(lineItem.id) || '';
    }
    return lineItem.ilcAppSchoolIdInferred || '';
  }

  setInferredSchoolIdInput(lineItemId: string, value: string) {
    const map = new Map(this.schoolIdInputs());
    map.set(lineItemId, value);
    this.schoolIdInputs.set(map);
  }

  async saveInferredSchoolId(lineItem: SquareSpaceLineItem) {
    const schoolId = this.getInferredSchoolId(lineItem);
    const orderId = this.order().docId;
    if (!orderId) return;

    const saving = new Set(this.savingLineItems());
    saving.add(lineItem.id);
    this.savingLineItems.set(saving);

    try {
      await this.dataService.setOrderLineItemInferredSchoolId(
        orderId, lineItem.id, schoolId
      );
      const map = new Map(this.schoolIdInputs());
      map.delete(lineItem.id);
      this.schoolIdInputs.set(map);
      this.orderUpdated.emit();
    } catch (e: unknown) {
      alert(`Error saving inferred school ID: ${(e as Error).message}`);
    } finally {
      const saving = new Set(this.savingLineItems());
      saving.delete(lineItem.id);
      this.savingLineItems.set(saving);
    }
  }

  hasSchoolUnsavedChange(lineItem: SquareSpaceLineItem): boolean {
    const inputMap = this.schoolIdInputs();
    if (!inputMap.has(lineItem.id)) return false;
    return inputMap.get(lineItem.id) !== (lineItem.ilcAppSchoolIdInferred || '');
  }

  getCountryOverride(lineItem: SquareSpaceLineItem): string {
    const inputMap = this.countryOverrideInputs();
    if (inputMap.has(lineItem.id)) {
      return inputMap.get(lineItem.id) || '';
    }
    return lineItem.ilcAppCountryOverride || '';
  }

  setCountryOverrideInput(lineItemId: string, value: string) {
    const map = new Map(this.countryOverrideInputs());
    map.set(lineItemId, value);
    this.countryOverrideInputs.set(map);
  }

  async saveCountryOverride(lineItem: SquareSpaceLineItem) {
    const country = this.getCountryOverride(lineItem);
    const orderId = this.order().docId;
    if (!orderId) return;

    const saving = new Set(this.savingLineItems());
    saving.add(lineItem.id);
    this.savingLineItems.set(saving);

    try {
      await this.dataService.setOrderLineItemCountryOverride(
        orderId, lineItem.id, country
      );
      const map = new Map(this.countryOverrideInputs());
      map.delete(lineItem.id);
      this.countryOverrideInputs.set(map);
      this.orderUpdated.emit();
    } catch (e: unknown) {
      alert(`Error saving country override: ${(e as Error).message}`);
    } finally {
      const saving = new Set(this.savingLineItems());
      saving.delete(lineItem.id);
      this.savingLineItems.set(saving);
    }
  }

  hasCountryUnsavedChange(lineItem: SquareSpaceLineItem): boolean {
    const inputMap = this.countryOverrideInputs();
    if (!inputMap.has(lineItem.id)) return false;
    return inputMap.get(lineItem.id) !== (lineItem.ilcAppCountryOverride || '');
  }

  async markAsFulfilled() {
    const orderId = this.order().docId;
    if (!orderId) return;

    try {
      await this.dataService.fulfillOrder(orderId);
      this.orderUpdated.emit();
    } catch (e: unknown) {
      alert(`Error marking as fulfilled: ${(e as Error).message}`);
    }
  }
}
