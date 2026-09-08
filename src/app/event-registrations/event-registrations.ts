/* event-registrations.ts
 *
 * Dedicated dashboard for admins and event owners/hosts to review
 * registrations for a class or workshop event.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { ProductService } from '../product.service';
import { StripeService } from '../stripe.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import {
  AttendeeRole,
  AttendanceType,
  EventRegistration,
  EventRegistrationStatus,
  IlcEvent,
  PricingTierType,
  RegistrationPaymentMethod,
} from '../../../functions/src/data-model/events';
import {
  StudentLevel,
  ApplicationLevel,
} from '../../../functions/src/data-model/curriculum';

export enum RegistrationSortField {
  Attendee = 'attendee',
  Role = 'role',
  Levels = 'levels',
  Attendance = 'attendance',
  Video = 'video',
  Payment = 'payment',
  RegisteredAt = 'registeredAt',
  Status = 'status',
}

export enum SortDirection {
  Asc = 'asc',
  Desc = 'desc',
}

const STUDENT_LEVEL_ORDER: Record<string, number> = {
  [StudentLevel.None]: 0,
  [StudentLevel.Entry]: 1,
  [StudentLevel.Level1]: 2,
  [StudentLevel.Level2]: 3,
  [StudentLevel.Level3]: 4,
  [StudentLevel.Level4]: 5,
  [StudentLevel.Level5]: 6,
  [StudentLevel.Level6]: 7,
  [StudentLevel.Level7]: 8,
  [StudentLevel.Level8]: 9,
  [StudentLevel.Level9]: 10,
  [StudentLevel.Level10]: 11,
  [StudentLevel.Level11]: 12,
};

const APP_LEVEL_ORDER: Record<string, number> = {
  [ApplicationLevel.None]: 0,
  [ApplicationLevel.Level1]: 1,
  [ApplicationLevel.Level2]: 2,
  [ApplicationLevel.Level3]: 3,
  [ApplicationLevel.Level4]: 4,
  [ApplicationLevel.Level5]: 5,
  [ApplicationLevel.Level6]: 6,
};

const ROLE_ORDER: Record<AttendeeRole, number> = {
  [AttendeeRole.Instructor]: 3,
  [AttendeeRole.Member]: 2,
  [AttendeeRole.NonMember]: 1,
};

function getStudentLevelRank(lvl?: string): number {
  if (!lvl) return 0;
  const cleaned = lvl.replace(/^student\s*/i, '').trim();
  if (cleaned.toLowerCase() === 'entry') return 1;
  const num = parseInt(cleaned, 10);
  if (!isNaN(num) && num >= 1 && num <= 11) {
    return num + 1;
  }
  return STUDENT_LEVEL_ORDER[lvl] ?? 0;
}

function getAppLevelRank(lvl?: string): number {
  if (!lvl) return 0;
  const cleaned = lvl.replace(/^(application|app)\s*/i, '').trim();
  const num = parseInt(cleaned, 10);
  if (!isNaN(num) && num >= 1 && num <= 6) {
    return num;
  }
  return APP_LEVEL_ORDER[lvl] ?? 0;
}

@Component({
  selector: 'app-event-registrations',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './event-registrations.html',
  styleUrl: './event-registrations.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventRegistrationsComponent implements OnInit {
  RegistrationSortField = RegistrationSortField;
  SortDirection = SortDirection;
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected firebaseState = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected productService = inject(ProductService);
  protected stripeService = inject(StripeService);

  isLoading = signal(true);
  isUpdating = signal<string | null>(null);
  copiedAlert = signal(false);
  searchTerm = signal('');
  selectedFilter = signal<'all' | 'in_person' | 'online' | 'video' | 'paid_online' | 'pay_in_person'>('all');
  sortField = signal<RegistrationSortField>(RegistrationSortField.RegisteredAt);
  sortDirection = signal<SortDirection>(SortDirection.Desc);

  event = signal<IlcEvent | null>(null);
  registrations = signal<EventRegistration[]>([]);

  eventId = computed(() => {
    return this.routingService.signals.eventRegistrations.pathVars.eventId() || '';
  });

  currentUser = computed(() => this.firebaseState.user());
  isAdmin = computed(() => this.currentUser()?.isAdmin || false);

  userEmails = computed(() => {
    const user = this.currentUser();
    if (!user) return [];
    const emails = [user.firebaseUser?.email, ...(user.member?.emails || [])];
    return emails.filter(Boolean).map((e) => (e as string).toLowerCase().trim());
  });

  userMemberDocId = computed(() => this.currentUser()?.member?.docId || '');

  isOwner = computed(() => {
    const ev = this.event();
    const docId = this.userMemberDocId();
    const emails = this.userEmails();
    if (!ev) return false;
    if (docId && ev.ownerDocId === docId) return true;
    if (ev.ownerEmails?.some((e) => emails.includes(e.toLowerCase().trim()))) return true;
    return false;
  });

  isManager = computed(() => {
    const ev = this.event();
    const docId = this.userMemberDocId();
    const emails = this.userEmails();
    if (!ev) return false;
    if (docId && ev.managerDocIds?.includes(docId)) return true;
    if (ev.managerEmails?.some((e) => emails.includes(e.toLowerCase().trim()))) return true;
    return false;
  });

  canView = computed(() => this.isAdmin() || this.isOwner() || this.isManager());

  filteredRegistrations = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const filter = this.selectedFilter();
    let list = this.registrations();

    if (filter === 'in_person') {
      list = list.filter((r) => r.attendance === AttendanceType.InPerson || r.attendance === AttendanceType.InPersonAndOnline);
    } else if (filter === 'online') {
      list = list.filter((r) => r.attendance === AttendanceType.Online || r.attendance === AttendanceType.InPersonAndOnline);
    } else if (filter === 'video') {
      list = list.filter((r) => r.hasVideoAccess);
    } else if (filter === 'paid_online') {
      list = list.filter((r) => r.paymentMethod === RegistrationPaymentMethod.Stripe || (r.status === EventRegistrationStatus.Paid && !r.paymentMethod));
    } else if (filter === 'pay_in_person') {
      list = list.filter((r) => this.isPendingInPerson(r));
    }

    if (term) {
      list = list.filter((r) => {
        const nameMatch = (r.name || '').toLowerCase().includes(term);
        const emailMatch = (r.email || '').toLowerCase().includes(term);
        const phoneMatch = (r.phone || '').toLowerCase().includes(term);
        const memberIdMatch = this.getMemberId(r).toLowerCase().includes(term);
        const levels = this.getMemberLevels(r);
        const studentLevelStr = this.formatStudentLevel(levels.studentLevel).toLowerCase();
        const appLevelStr = this.formatApplicationLevel(levels.applicationLevel).toLowerCase();
        const levelMatch =
          studentLevelStr.includes(term) ||
          appLevelStr.includes(term) ||
          (levels.studentLevel || '').toLowerCase().includes(term) ||
          (levels.applicationLevel || '').toLowerCase().includes(term);
        return nameMatch || emailMatch || phoneMatch || memberIdMatch || levelMatch;
      });
    }

    return list.slice().sort((a, b) => this.compareRegistrations(a, b));
  });

  totalAttendeesCount = computed(() => this.registrations().length);

  inPersonCount = computed(() => {
    return this.registrations().filter(
      (r) => r.attendance === AttendanceType.InPerson || r.attendance === AttendanceType.InPersonAndOnline,
    ).length;
  });

  onlineCount = computed(() => {
    return this.registrations().filter(
      (r) => r.attendance === AttendanceType.Online || r.attendance === AttendanceType.InPersonAndOnline,
    ).length;
  });

  videoCount = computed(() => {
    return this.registrations().filter((r) => r.hasVideoAccess).length;
  });

  paidOnlineCount = computed(() => {
    return this.registrations().filter(
      (r) => r.paymentMethod === RegistrationPaymentMethod.Stripe || (r.status === EventRegistrationStatus.Paid && !r.paymentMethod),
    ).length;
  });

  pendingInPersonCount = computed(() => {
    return this.registrations().filter((r) => this.isPendingInPerson(r)).length;
  });

  totalRevenue = computed(() => {
    const totalCents = this.registrations().reduce((sum, r) => sum + (r.amountPaidCents || 0), 0);
    return totalCents / 100;
  });

  totalPendingRevenue = computed(() => {
    const dueCents = this.registrations().reduce((sum, r) => sum + (r.amountDueCents || 0), 0);
    return dueCents / 100;
  });

  revenueCurrency = computed(() => {
    const first = this.registrations()[0];
    return (first?.currency || 'USD').toUpperCase();
  });

  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadData();
  }

  async loadData() {
    const id = this.eventId();
    if (!id) {
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    try {
      const [ev, regs] = await Promise.all([
        this.dataService.getEventById(id),
        this.productService.getEventRegistrations(id),
      ]);
      this.event.set(ev || null);
      this.registrations.set(regs);
    } catch (err) {
      console.error('Error loading event registrations:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  formatRole(role: AttendeeRole): string {
    switch (role) {
      case AttendeeRole.Instructor:
        return 'Instructor';
      case AttendeeRole.Member:
        return 'Member';
      case AttendeeRole.NonMember:
      default:
        return 'Non-Member';
    }
  }

  formatAttendance(att: AttendanceType): string {
    if (att === AttendanceType.InPersonAndOnline) return 'In-Person & Online';
    if (att === AttendanceType.Online) return 'Online';
    if (att === AttendanceType.VideoOnly) return 'Video Pre-Order';
    return 'In-Person';
  }

  formatPricingTier(tier?: PricingTierType): string {
    switch (tier) {
      case PricingTierType.EarlyBird:
        return 'Early-Bird';
      case PricingTierType.InPerson:
        return 'At Door';
      case PricingTierType.Standard:
      default:
        return '';
    }
  }

  isPendingInPerson(reg: EventRegistration): boolean {
    return (
      reg.status === EventRegistrationStatus.PendingInPerson ||
      (reg.paymentMethod === RegistrationPaymentMethod.InPerson &&
        reg.status !== EventRegistrationStatus.Paid)
    );
  }

  async markPaid(reg: EventRegistration) {
    if (!confirm(`Mark ${reg.name || 'this attendee'} as paid in person at the event?`)) {
      return;
    }

    this.isUpdating.set(reg.docId);
    try {
      const result = await this.stripeService.markEventRegistrationPaid({
        eventId: this.eventId(),
        registrationId: reg.docId,
      });

      if (result && result.success) {
        this.registrations.update((list) =>
          list.map((r) =>
            r.docId === reg.docId
              ? {
                  ...r,
                  status: EventRegistrationStatus.Paid,
                  amountPaidCents: r.amountDueCents || r.amountPaidCents,
                  amountDueCents: 0,
                  paidAt: new Date().toISOString(),
                }
              : r,
          ),
        );
      } else {
        alert('Failed to update registration payment status.');
      }
    } catch (err: unknown) {
      console.error('Error marking registration paid:', err);
      alert(err instanceof Error ? err.message : 'Error updating registration.');
    } finally {
      this.isUpdating.set(null);
    }
  }

  async unmarkPaid(reg: EventRegistration) {
    if (
      !confirm(
        `Unmark payment for ${reg.name || 'this attendee'}? This will revert their status to unpaid / pay at the door.`,
      )
    ) {
      return;
    }

    this.isUpdating.set(reg.docId);
    try {
      const result = await this.stripeService.unmarkEventRegistrationPaid({
        eventId: this.eventId(),
        registrationId: reg.docId,
      });

      if (result && result.success) {
        this.registrations.update((list) =>
          list.map((r) =>
            r.docId === reg.docId
              ? {
                  ...r,
                  status: EventRegistrationStatus.PendingInPerson,
                  amountDueCents: r.amountPaidCents || r.amountDueCents,
                  amountPaidCents: 0,
                  paidAt: undefined,
                }
              : r,
          ),
        );
      } else {
        alert('Failed to unmark registration payment status.');
      }
    } catch (err: unknown) {
      console.error('Error unmarking registration paid:', err);
      alert(err instanceof Error ? err.message : 'Error updating registration.');
    } finally {
      this.isUpdating.set(null);
    }
  }

  formatAmount(cents: number, currency: string = 'usd'): string {
    const amount = (cents / 100).toFixed(2);
    const curr = (currency || 'usd').toUpperCase();
    if (curr === 'USD') return `$${amount}`;
    if (curr === 'EUR') return `€${amount}`;
    if (curr === 'GBP') return `£${amount}`;
    return `${curr} ${amount}`;
  }

  formatDate(val: unknown): string {
    if (!val) return '';
    try {
      let date: Date;
      if (val instanceof Date) {
        date = val;
      } else if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
        date = (val as { toDate: () => Date }).toDate();
      } else if (typeof (val as { seconds?: number }).seconds === 'number') {
        date = new Date((val as { seconds: number }).seconds * 1000);
      } else {
        date = new Date(val as string | number);
      }
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  }

  async copyAllEmails() {
    const emails = Array.from(
      new Set(
        this.filteredRegistrations()
          .map((r) => r.email?.trim())
          .filter((e): e is string => !!e),
      ),
    );

    if (emails.length === 0) return;

    try {
      await navigator.clipboard.writeText(emails.join(', '));
      this.copiedAlert.set(true);
      setTimeout(() => this.copiedAlert.set(false), 3000);
    } catch (err) {
      console.error('Failed to copy emails to clipboard:', err);
    }
  }

  getMemberId(reg: EventRegistration): string {
    if (reg.memberId) return reg.memberId;
    if (reg.memberDocId) {
      const member = this.dataService.getMemberByDocId(reg.memberDocId);
      if (member?.memberId) return member.memberId;
    }
    if (reg.email && typeof this.dataService.members?.entries === 'function') {
      const regEmail = reg.email.toLowerCase().trim();
      for (const m of this.dataService.members.entries()) {
        if (m.emails?.some((e: string) => e.toLowerCase().trim() === regEmail)) {
          if (m.memberId) return m.memberId;
        }
      }
    }
    return '';
  }

  getMemberLevels(reg: EventRegistration): { studentLevel?: string; applicationLevel?: string } {
    if (reg.studentLevel !== undefined || reg.applicationLevel !== undefined) {
      return {
        studentLevel: reg.studentLevel || '',
        applicationLevel: reg.applicationLevel || '',
      };
    }
    const member =
      (reg.memberDocId ? this.dataService.getMemberByDocId(reg.memberDocId) : undefined) ??
      (reg.memberId ? this.dataService.getMemberByMemberId(reg.memberId) : undefined);
    if (member) {
      return {
        studentLevel: member.studentLevel || '',
        applicationLevel: member.applicationLevel || '',
      };
    }
    if (reg.email && typeof this.dataService.members?.entries === 'function') {
      const regEmail = reg.email.toLowerCase().trim();
      for (const m of this.dataService.members.entries()) {
        if (m.emails?.some((e: string) => e.toLowerCase().trim() === regEmail)) {
          return {
            studentLevel: m.studentLevel || '',
            applicationLevel: m.applicationLevel || '',
          };
        }
      }
    }
    return {
      studentLevel: '',
      applicationLevel: '',
    };
  }

  formatStudentLevel(lvl?: string): string {
    if (!lvl) return '';
    if (lvl.toLowerCase().startsWith('student')) return lvl;
    return `Student ${lvl}`;
  }

  formatApplicationLevel(lvl?: string): string {
    if (!lvl) return '';
    if (lvl.toLowerCase().startsWith('app')) return lvl;
    return `App ${lvl}`;
  }

  toggleSort(field: RegistrationSortField) {
    if (this.sortField() === field) {
      this.sortDirection.update((dir) =>
        dir === SortDirection.Asc ? SortDirection.Desc : SortDirection.Asc,
      );
    } else {
      this.sortField.set(field);
      if (
        field === RegistrationSortField.RegisteredAt ||
        field === RegistrationSortField.Payment
      ) {
        this.sortDirection.set(SortDirection.Desc);
      } else {
        this.sortDirection.set(SortDirection.Asc);
      }
    }
  }

  private getTime(val: unknown): number {
    if (!val) return 0;
    try {
      if (val instanceof Date) return val.getTime();
      if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
        return (val as { toDate: () => Date }).toDate().getTime();
      }
      if (typeof (val as { seconds?: number }).seconds === 'number') {
        return (val as { seconds: number }).seconds * 1000;
      }
      const t = new Date(val as string | number).getTime();
      return isNaN(t) ? 0 : t;
    } catch {
      return 0;
    }
  }

  compareRegistrations(a: EventRegistration, b: EventRegistration): number {
    const field = this.sortField();
    const dir = this.sortDirection();
    const mul = dir === SortDirection.Asc ? 1 : -1;

    let res = 0;
    switch (field) {
      case RegistrationSortField.Attendee: {
        const nameA = (a.name || '').trim();
        const nameB = (b.name || '').trim();
        res = mul * nameA.localeCompare(nameB);
        if (res === 0) {
          res = mul * (a.email || '').localeCompare(b.email || '');
        }
        break;
      }
      case RegistrationSortField.Role: {
        const rA = ROLE_ORDER[a.role] ?? 0;
        const rB = ROLE_ORDER[b.role] ?? 0;
        res = mul * (rA - rB);
        break;
      }
      case RegistrationSortField.Levels: {
        const aLevels = this.getMemberLevels(a);
        const bLevels = this.getMemberLevels(b);
        const sDiff = getStudentLevelRank(aLevels.studentLevel) - getStudentLevelRank(bLevels.studentLevel);
        if (sDiff !== 0) {
          res = mul * sDiff;
        } else {
          const appDiff = getAppLevelRank(aLevels.applicationLevel) - getAppLevelRank(bLevels.applicationLevel);
          if (appDiff !== 0) {
            res = mul * appDiff;
          } else {
            const mIdA = this.getMemberId(a);
            const mIdB = this.getMemberId(b);
            res = mul * mIdA.localeCompare(mIdB, undefined, { numeric: true });
          }
        }
        break;
      }
      case RegistrationSortField.Attendance: {
        res = mul * (a.attendance || '').localeCompare(b.attendance || '');
        break;
      }
      case RegistrationSortField.Video: {
        const vA = a.hasVideoAccess ? 1 : 0;
        const vB = b.hasVideoAccess ? 1 : 0;
        res = mul * (vA - vB);
        break;
      }
      case RegistrationSortField.Payment: {
        const amtA = this.isPendingInPerson(a) ? (a.amountDueCents || 0) : (a.amountPaidCents || 0);
        const amtB = this.isPendingInPerson(b) ? (b.amountDueCents || 0) : (b.amountPaidCents || 0);
        res = mul * (amtA - amtB);
        if (res === 0) {
          res = mul * (a.status || '').localeCompare(b.status || '');
        }
        break;
      }
      case RegistrationSortField.RegisteredAt: {
        const tA = this.getTime(a.registeredAt);
        const tB = this.getTime(b.registeredAt);
        res = mul * (tA - tB);
        break;
      }
      case RegistrationSortField.Status: {
        res = mul * (a.status || '').localeCompare(b.status || '');
        break;
      }
    }

    if (res !== 0) return res;
    // Secondary tiebreaker: registeredAt descending
    return this.getTime(b.registeredAt) - this.getTime(a.registeredAt);
  }

  exportCsv() {
    const regs = this.filteredRegistrations();
    if (regs.length === 0) return;

    const headers = [
      'Name',
      'Email',
      'Phone',
      'Role',
      'Member ID',
      'Student Level',
      'Application Level',
      'Attendance Mode',
      'Video Access',
      'Payment Method',
      'Pricing Tier',
      'Amount Paid',
      'Amount Due',
      'Currency',
      'Status',
      'Registered Date',
      'Paid Date',
      'Stripe Session ID',
    ];

    const rows = regs.map((r) => {
      const levels = this.getMemberLevels(r);
      return [
        `"${(r.name || '').replace(/"/g, '""')}"`,
        `"${(r.email || '').replace(/"/g, '""')}"`,
        `"${(r.phone || '').replace(/"/g, '""')}"`,
        `"${this.formatRole(r.role)}"`,
        `"${this.getMemberId(r)}"`,
        `"${levels.studentLevel || ''}"`,
        `"${levels.applicationLevel || ''}"`,
        `"${this.formatAttendance(r.attendance)}"`,
        `"${r.hasVideoAccess ? 'Yes' : 'No'}"`,
        `"${r.paymentMethod || (r.amountPaidCents > 0 ? 'stripe' : 'in_person')}"`,
        `"${this.formatPricingTier(r.pricingTierType) || 'Standard'}"`,
        ((r.amountPaidCents || 0) / 100).toFixed(2),
        ((r.amountDueCents || 0) / 100).toFixed(2),
        (r.currency || 'usd').toUpperCase(),
        r.status,
        `"${this.formatDate(r.registeredAt)}"`,
        `"${this.formatDate(r.paidAt)}"`,
        `"${r.stripeSessionId || ''}"`,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const evTitle = this.event()?.title
      ? this.event()!.title.replace(/[^a-zA-Z0-9_-]/g, '_')
      : 'event';
    link.setAttribute('download', `${evTitle}_registrations.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  backToEventUrl(): string {
    return this.routingService.hrefForView(Views.EventView, { eventId: this.eventId() });
  }
}
