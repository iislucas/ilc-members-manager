/* action-queue-dialog.component.ts
 *
 * Modal dialog for inspecting pending offline actions, viewing field-level diffs,
 * resolving server conflicts, and manually triggering synchronization.
 */

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  ActionQueueService,
  ActionStatus,
  ConflictResolution,
  QueuedAction,
} from '../action-queue.service';
import { NetworkStateService } from '../network-state.service';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-action-queue-dialog',
  standalone: true,
  imports: [NgTemplateOutlet, IconComponent],
  templateUrl: './action-queue-dialog.component.html',
  styleUrl: './action-queue-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionQueueDialogComponent {
  ActionStatus = ActionStatus;
  ConflictResolution = ConflictResolution;

  actionQueue = inject(ActionQueueService);
  networkState = inject(NetworkStateService);

  closed = output<void>();

  expandedIds = signal<Set<string>>(new Set());

  actions = this.actionQueue.queuedActions;
  hasPending = this.actionQueue.hasPending;
  pendingCount = this.actionQueue.pendingCount;
  conflictCount = this.actionQueue.conflictCount;
  isSyncing = this.actionQueue.isSyncing;
  isOffline = this.networkState.isOffline;

  formatTimestamp(ts: string): string {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return ts;
    }
  }

  toggleExpanded(id: string): void {
    const current = new Set(this.expandedIds());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    this.expandedIds.set(current);
  }

  isExpanded(id: string): boolean {
    return this.expandedIds().has(id);
  }

  getChangedKeys(action: QueuedAction): string[] {
    const oldS = (action.oldState || {}) as Record<string, unknown>;
    const newS = (action.newState || {}) as Record<string, unknown>;
    const keys = new Set([...Object.keys(oldS), ...Object.keys(newS)]);
    const changed: string[] = [];

    for (const key of keys) {
      if (key === 'lastUpdated') continue;
      const vOld = oldS[key];
      const vNew = newS[key];
      if (JSON.stringify(vOld) !== JSON.stringify(vNew)) {
        changed.push(key);
      }
    }
    return changed;
  }

  formatFieldLabel(key: string): string {
    const customNames: Record<string, string> = {
      notes: 'Notes',
      publicBioMarkdown: 'Public Bio',
      name: 'Full Name',
      email: 'Email Address',
      emails: 'Email Addresses',
      phone: 'Phone Number',
      address: 'Address',
      city: 'City',
      postcode: 'Postcode',
      country: 'Country',
      dateOfBirth: 'Date of Birth',
      roles: 'Roles',
      tags: 'Tags',
      schools: 'Schools',
      primarySchoolId: 'Primary School',
      isInstructor: 'Instructor Status',
      instructorId: 'Instructor ID',
      primaryInstructorId: 'Primary Instructor ID',
      status: 'Status',
      schoolName: 'School Name',
      schoolId: 'School ID',
      headInstructorName: 'Head Instructor',
      studentName: 'Student Name',
      studentDocId: 'Student',
      assessedLevel: 'Assessed Level',
      feedback: 'Feedback',
      dateOfGrading: 'Date of Grading',
      gradingInstructorId: 'Grading Instructor',
      title: 'Title',
      description: 'Description',
      startDate: 'Start Date',
      endDate: 'End Date',
      location: 'Location',
      purchaseDetailsMarkdown: 'Purchase Details',
      inPersonDetailsMarkdown: 'In-Person Details',
      onlineJoiningLink: 'Online Joining Link',
      recordedVideoId: 'Recorded Video ID',
      recordedVideoUrl: 'Recorded Video URL',
      managerDocIds: 'Managers',
      contacts: 'Contacts',
      documents: 'Documents',
      productId: 'Product ID',
    };
    if (customNames[key]) return customNames[key];
    const spaced = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase().trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  isEmpty(val: unknown): boolean {
    if (val === undefined || val === null || val === '') return true;
    if (Array.isArray(val) && val.length === 0) return true;
    if (typeof val === 'object' && Object.keys(val as object).length === 0) return true;
    return false;
  }

  isBoolean(val: unknown): boolean {
    return typeof val === 'boolean';
  }

  isMultiline(key: string, val: unknown): boolean {
    if (typeof val !== 'string') return false;
    if (val.includes('\n')) return true;
    const multilineKeys = [
      'notes',
      'publicBioMarkdown',
      'feedback',
      'description',
      'address',
      'purchaseDetailsMarkdown',
      'inPersonDetailsMarkdown',
    ];
    return multilineKeys.includes(key) && val.length > 50;
  }

  isTagList(val: unknown): boolean {
    if (!Array.isArray(val) || val.length === 0) return false;
    return val.every((item) => typeof item === 'string' || typeof item === 'number');
  }

  asTagList(val: unknown): string[] {
    if (!Array.isArray(val)) return [];
    return val.map((v) => String(v));
  }

  isContactsList(val: unknown): boolean {
    if (!Array.isArray(val) || val.length === 0) return false;
    return val.every((item) => item && typeof item === 'object' && ('name' in item || 'email' in item));
  }

  asContacts(val: unknown): Array<{ name: string; details: string }> {
    if (!Array.isArray(val)) return [];
    return (val as Array<Record<string, unknown>>).map((item) => {
      const name = typeof item['name'] === 'string' ? item['name'] : 'Unnamed Contact';
      const details = [item['email'], item['phone']].filter(Boolean).map(String).join(' • ');
      return { name, details };
    });
  }

  isDate(key: string, val: unknown): boolean {
    if (!val) return false;
    if (val instanceof Date) return true;
    if (typeof val === 'object' && val !== null && 'seconds' in val) return true;
    if (typeof val === 'string') {
      const isDateKey = /date|time|dob|created|updated/i.test(key);
      const looksLikeIso = /^\d{4}-\d{2}-\d{2}/.test(val);
      return isDateKey && looksLikeIso;
    }
    return false;
  }

  formatDate(val: unknown): string {
    if (!val) return '—';
    try {
      if (typeof val === 'object' && val !== null && 'seconds' in val) {
        const d = new Date((val as { seconds: number }).seconds * 1000);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      }
      const d = new Date(val as string | number | Date);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      }
    } catch {}
    return String(val);
  }

  isObject(val: unknown): boolean {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
  }

  asObjectEntries(val: unknown): Array<{ key: string; value: string }> {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return [];
    return Object.entries(val as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      value: this.formatPrimitive(v),
    }));
  }

  formatPrimitive(val: unknown): string {
    if (val === undefined || val === null || val === '') return '—';
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    return String(val);
  }

  formatValue(val: unknown): string {
    if (val === undefined || val === null) return '—';
    if (typeof val === 'string') return val.trim() ? val : '""';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') return String(val);
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      if (val.every((item) => typeof item === 'string' || typeof item === 'number')) {
        return val.join(', ');
      }
      return `${val.length} items`;
    }
    if (typeof val === 'object') {
      try {
        return JSON.stringify(val);
      } catch {
        return '[Object]';
      }
    }
    return String(val);
  }

  async syncNow(): Promise<void> {
    if (this.isOffline() || this.isSyncing()) return;
    await this.actionQueue.syncQueue();
  }

  async discard(action: QueuedAction): Promise<void> {
    await this.actionQueue.discardAction(action.id);
  }

  async clearAll(): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm('Discard all pending offline edits? This cannot be undone.')) {
      return;
    }
    await this.actionQueue.clearAll();
  }

  async resolveConflict(
    id: string,
    resolution: ConflictResolution,
  ): Promise<void> {
    await this.actionQueue.resolveConflict(id, resolution);
  }

  close(): void {
    this.closed.emit();
    this.actionQueue.closeDialog();
  }
}
