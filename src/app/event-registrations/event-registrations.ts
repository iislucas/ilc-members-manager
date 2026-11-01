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
  output,
  signal,
} from '@angular/core';
import { studentLevelLabel, toApplicationLevel } from '../../../functions/src/data-model/curriculum';
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
  computeEffectiveCapacityUsage,
  EventCapacity,
  EventRegistration,
  EventRegistrationQuestionResponse,
  EventRegistrationStatus,
  formatQuestionResponseValue,
  hasQuestionResponseValue,
  IlcEvent,
  PaymentChoice,
  PricingTierType,
  Product,
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
  imports: [FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './event-registrations.html',
  styleUrl: './event-registrations.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventRegistrationsComponent implements OnInit {
  RegistrationSortField = RegistrationSortField;
  SortDirection = SortDirection;
  protected readonly formatQuestionResponseValue = formatQuestionResponseValue;
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected firebaseState = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected productService = inject(ProductService);
  protected stripeService = inject(StripeService);

  isLoading = signal(true);
  isUpdating = signal<string | null>(null);
  actionError = signal<string | null>(null);
  copiedAlert = signal(false);
  searchTerm = signal('');
  selectedFilter = signal<'all' | 'in_person' | 'online' | 'video' | 'paid_online' | 'pay_in_person'>('all');
  sortField = signal<RegistrationSortField>(RegistrationSortField.RegisteredAt);
  sortDirection = signal<SortDirection>(SortDirection.Desc);

  event = signal<IlcEvent | null>(null);
  product = signal<Product | null>(null);
  registrations = signal<EventRegistration[]>([]);
  titleLoaded = output<string>();

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
      list = list.filter((r) => this.hasBalanceDueAtDoor(r));
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
        const notesMatch = (r.notes || '').toLowerCase().includes(term);
        const optionMatch = (r.optionLabel || '').toLowerCase().includes(term);
        const suboptionMatch = (r.selectedSuboptions || []).some((s) =>
          s.toLowerCase().includes(term),
        );
        const addOnMatch = (r.selectedAddOnLabels || []).some((a) =>
          a.toLowerCase().includes(term),
        );
        const responseMatch = (r.questionResponses || []).some(
          (resp) =>
            hasQuestionResponseValue(resp) &&
            (resp.questionLabel.toLowerCase().includes(term) ||
              formatQuestionResponseValue(resp).toLowerCase().includes(term)),
        );
        return (
          nameMatch ||
          emailMatch ||
          phoneMatch ||
          memberIdMatch ||
          levelMatch ||
          notesMatch ||
          optionMatch ||
          suboptionMatch ||
          addOnMatch ||
          responseMatch
        );
      });
    }

    return list.slice().sort((a, b) => this.compareRegistrations(a, b));
  });

  hasAnyResponsesOrNotes = computed<boolean>(() => {
    return this.registrations().some(
      (r) => this.getAnsweredResponses(r).length > 0 || Boolean(r.notes?.trim()),
    );
  });

  getAnsweredResponses(reg: EventRegistration): EventRegistrationQuestionResponse[] {
    return (reg.questionResponses || []).filter((resp) => hasQuestionResponseValue(resp));
  }

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
    return this.registrations().filter((r) => this.hasBalanceDueAtDoor(r)).length;
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
    return (first?.currency || this.product()?.currency || 'USD').toUpperCase();
  });

  evaluatedCapacities = computed<
    Array<{ capacity: EventCapacity; used: number; remaining: number; isFull: boolean }>
  >(() => {
    const ev = this.event();
    const prod = this.product();
    const capacities =
      ev && ev.capacities.length > 0
        ? ev.capacities
        : prod?.pricingRules.capacities ?? [];
    if (capacities.length === 0) return [];

    const activeRegs = this.registrations().filter(
      (r) =>
        r.status !== EventRegistrationStatus.Cancelled &&
        r.status !== EventRegistrationStatus.Refunded,
    );
    const tallied: Record<string, number> = {};
    for (const reg of activeRegs) {
      const usage = computeEffectiveCapacityUsage(reg, capacities);
      for (const [capId, count] of Object.entries(usage)) {
        tallied[capId] = (tallied[capId] || 0) + count;
      }
    }

    return capacities.map((capacity) => {
      const used =
        activeRegs.length > 0
          ? tallied[capacity.id] || 0
          : ev?.capacityCounts?.[capacity.id] ?? prod?.capacityCounts?.[capacity.id] ?? 0;
      const remaining = Math.max(0, capacity.limit - used);
      return {
        capacity,
        used,
        remaining,
        isFull: used >= capacity.limit,
      };
    });
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
      const prod = ev?.productId
        ? await this.productService.getProduct(ev.productId)
        : await this.productService.getProductByEventId(id);
      this.event.set(ev || null);
      this.product.set(prod || null);
      this.registrations.set(regs);
      if (ev?.title) {
        this.titleLoaded.emit(ev.title);
      }
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
        reg.status !== EventRegistrationStatus.Paid &&
        reg.status !== EventRegistrationStatus.DepositPaid)
    );
  }

  isDepositPaid(reg: EventRegistration): boolean {
    return reg.status === EventRegistrationStatus.DepositPaid;
  }

  hasBalanceDueAtDoor(reg: EventRegistration): boolean {
    return (
      this.isPendingInPerson(reg) ||
      (reg.status === EventRegistrationStatus.DepositPaid && reg.amountDueCents > 0)
    );
  }

  canMarkPaidInFull(reg: EventRegistration): boolean {
    return (
      reg.status !== EventRegistrationStatus.Paid &&
      reg.status !== EventRegistrationStatus.Cancelled &&
      reg.status !== EventRegistrationStatus.Refunded
    );
  }

  canUnmarkPaid(reg: EventRegistration): boolean {
    if (reg.status !== EventRegistrationStatus.Paid) return false;
    return (
      reg.paidInFullOffline ||
      reg.paymentMethod === RegistrationPaymentMethod.InPerson ||
      (reg.depositPaidCents > 0 && reg.totalPriceCents > reg.depositPaidCents)
    );
  }

  resolveEffectiveTotalPriceCents(reg: EventRegistration): number {
    return reg.totalPriceCents > 0
      ? reg.totalPriceCents
      : (reg.amountPaidCents || 0) + (reg.amountDueCents || 0);
  }

  formatPaymentChoice(reg: EventRegistration): string {
    if (reg.paymentChoice === PaymentChoice.PayAtDoor || this.isPendingInPerson(reg)) {
      return 'Pay at Door';
    }
    if (
      reg.paymentChoice === PaymentChoice.Deposit ||
      reg.depositPaidCents > 0 ||
      reg.status === EventRegistrationStatus.DepositPaid
    ) {
      return 'Deposit';
    }
    return 'Full';
  }

  formatStatusBadge(reg: EventRegistration): string {
    switch (reg.status) {
      case EventRegistrationStatus.Paid:
        return reg.paidInFullOffline ? 'PAID IN FULL (OFFLINE)' : 'PAID IN FULL';
      case EventRegistrationStatus.DepositPaid:
        return 'DEPOSIT PAID';
      case EventRegistrationStatus.PendingInPerson:
        return 'PAY AT DOOR';
      default:
        return (reg.status || '').toUpperCase();
    }
  }

  async markPaid(reg: EventRegistration) {
    if (
      !confirm(
        `Mark ${reg.name || 'this attendee'} as paid in full? Any complimentary Paid-in-Full add-ons will also be unlocked.`,
      )
    ) {
      return;
    }

    this.isUpdating.set(reg.docId);
    this.actionError.set(null);
    try {
      const result = await this.stripeService.markEventRegistrationPaid({
        eventId: this.eventId(),
        registrationId: reg.docId,
      });

      if (result && result.success) {
        this.registrations.update((list) =>
          list.map((r) => {
            if (r.docId !== reg.docId) return r;
            const totalPaid =
              r.amountDueCents > 0
                ? r.amountPaidCents + r.amountDueCents
                : Math.max(r.amountPaidCents, r.totalPriceCents);
            const effectiveDepositPaid =
              r.depositPaidCents > 0
                ? r.depositPaidCents
                : r.status === EventRegistrationStatus.DepositPaid &&
                    r.amountPaidCents > 0 &&
                    r.amountDueCents > 0
                  ? r.amountPaidCents
                  : 0;
            return {
              ...r,
              status: EventRegistrationStatus.Paid,
              paidInFullOffline: result.paidInFullOffline ?? true,
              depositPaidCents: effectiveDepositPaid,
              totalPriceCents: r.totalPriceCents > 0 ? r.totalPriceCents : totalPaid,
              amountPaidCents: totalPaid,
              amountDueCents: 0,
              selectedAddOnIds: result.selectedAddOnIds ?? r.selectedAddOnIds,
              selectedAddOnLabels: result.selectedAddOnLabels ?? r.selectedAddOnLabels,
              autoGrantedAddOnIds: result.autoGrantedAddOnIds ?? r.autoGrantedAddOnIds,
              hasVideoAccess: result.hasVideoAccess ?? r.hasVideoAccess,
              paidAt: new Date().toISOString(),
            };
          }),
        );
      } else {
        this.actionError.set('Failed to update registration payment status.');
      }
    } catch (err: unknown) {
      console.error('Error marking registration paid:', err);
      this.actionError.set(err instanceof Error ? err.message : 'Error updating registration.');
    } finally {
      this.isUpdating.set(null);
    }
  }

  async unmarkPaid(reg: EventRegistration) {
    if (
      !confirm(
        `Unmark full payment for ${reg.name || 'this attendee'}? This will revert their offline balance to due.`,
      )
    ) {
      return;
    }

    this.isUpdating.set(reg.docId);
    this.actionError.set(null);
    try {
      const result = await this.stripeService.unmarkEventRegistrationPaid({
        eventId: this.eventId(),
        registrationId: reg.docId,
      });

      if (result && result.success) {
        this.registrations.update((list) =>
          list.map((r) => {
            if (r.docId !== reg.docId) return r;
            const addOnUpdates = {
              paidInFullOffline: false,
              selectedAddOnIds: result.selectedAddOnIds ?? r.selectedAddOnIds,
              selectedAddOnLabels: result.selectedAddOnLabels ?? r.selectedAddOnLabels,
              autoGrantedAddOnIds: result.autoGrantedAddOnIds ?? [],
              hasVideoAccess: result.hasVideoAccess ?? r.hasVideoAccess,
            };
            if (r.depositPaidCents > 0 && r.totalPriceCents > r.depositPaidCents) {
              return {
                ...r,
                ...addOnUpdates,
                status: EventRegistrationStatus.DepositPaid,
                amountPaidCents: r.depositPaidCents,
                amountDueCents: r.totalPriceCents - r.depositPaidCents,
                paidAt: '',
              };
            }
            return {
              ...r,
              ...addOnUpdates,
              status: EventRegistrationStatus.PendingInPerson,
              amountDueCents: r.totalPriceCents || r.amountPaidCents || r.amountDueCents,
              amountPaidCents: 0,
              paidAt: '',
            };
          }),
        );
      } else {
        this.actionError.set('Failed to unmark registration payment status.');
      }
    } catch (err: unknown) {
      console.error('Error unmarking registration paid:', err);
      this.actionError.set(err instanceof Error ? err.message : 'Error updating registration.');
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
    if (reg.studentLevel || reg.applicationLevel) {
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

  // 'Student 3' / 'Student Entry' for any recognised spelling; an
  // unrecognised value is shown as stored rather than hidden; '' when none.
  formatStudentLevel(lvl?: string): string {
    return studentLevelLabel(lvl) || (lvl ?? '').trim();
  }

  // Short application label, 'App 2', for any recognised spelling; an
  // unrecognised value is shown as stored rather than hidden; '' when none.
  formatApplicationLevel(lvl?: string): string {
    const level = toApplicationLevel(lvl);
    return level ? `App ${level}` : (lvl ?? '').trim();
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

    const distinctQuestions: { questionId: string; questionLabel: string }[] = [];
    const seenQuestionIds = new Set<string>();
    for (const q of this.product()?.pricingRules.questions ?? []) {
      if (q.id && !seenQuestionIds.has(q.id)) {
        seenQuestionIds.add(q.id);
        distinctQuestions.push({
          questionId: q.id,
          questionLabel: q.label || q.id,
        });
      }
    }
    for (const r of this.registrations()) {
      for (const resp of r.questionResponses || []) {
        if (!seenQuestionIds.has(resp.questionId)) {
          seenQuestionIds.add(resp.questionId);
          distinctQuestions.push({
            questionId: resp.questionId,
            questionLabel: resp.questionLabel || resp.questionId,
          });
        }
      }
    }
    const includeNotesColumn = this.registrations().some((r) => Boolean(r.notes?.trim()));

    const sanitizeSpreadsheetText = (val: string): string =>
      /^[=+\-@\t\r]/.test(val) ? `'${val}` : val;
    const escapeCsvCell = (val: string): string => `"${val.replace(/"/g, '""')}"`;

    const headers = [
      'Name',
      'Email',
      'Phone',
      'Role',
      'Member ID',
      'Student Level',
      'Application Level',
      'Attendance Mode',
      'Registration Option',
      'Sub-Options',
      'Add-Ons',
      'Video Access',
      'Payment Method',
      'Payment Choice',
      'Pricing Tier',
      'Total Price',
      'Deposit Paid',
      'Amount Paid',
      'Amount Due',
      'Currency',
      'Status',
      'Registered Date',
      'Paid Date',
      'Stripe Session ID',
      ...(includeNotesColumn ? ['Notes'] : []),
      ...distinctQuestions.map((q) => escapeCsvCell(sanitizeSpreadsheetText(q.questionLabel))),
    ];

    const rows = regs.map((r) => {
      const levels = this.getMemberLevels(r);
      const byQuestionId = new Map<string, EventRegistrationQuestionResponse>();
      for (const resp of r.questionResponses || []) {
        byQuestionId.set(resp.questionId, resp);
      }

      return [
        escapeCsvCell(sanitizeSpreadsheetText(r.name || '')),
        escapeCsvCell(r.email || ''),
        escapeCsvCell(r.phone || ''),
        escapeCsvCell(this.formatRole(r.role)),
        escapeCsvCell(this.getMemberId(r)),
        escapeCsvCell(levels.studentLevel || ''),
        escapeCsvCell(levels.applicationLevel || ''),
        escapeCsvCell(this.formatAttendance(r.attendance)),
        escapeCsvCell(r.optionLabel || this.formatAttendance(r.attendance)),
        escapeCsvCell((r.selectedSuboptions || []).join('; ')),
        escapeCsvCell((r.selectedAddOnLabels || []).join('; ')),
        escapeCsvCell(r.hasVideoAccess ? 'Yes' : 'No'),
        escapeCsvCell(r.paymentMethod || (r.amountPaidCents > 0 ? 'stripe' : 'in_person')),
        escapeCsvCell(this.formatPaymentChoice(r)),
        escapeCsvCell(this.formatPricingTier(r.pricingTierType) || 'Standard'),
        (this.resolveEffectiveTotalPriceCents(r) / 100).toFixed(2),
        ((r.depositPaidCents || 0) / 100).toFixed(2),
        ((r.amountPaidCents || 0) / 100).toFixed(2),
        ((r.amountDueCents || 0) / 100).toFixed(2),
        (r.currency || 'usd').toUpperCase(),
        r.status,
        escapeCsvCell(this.formatDate(r.registeredAt)),
        escapeCsvCell(this.formatDate(r.paidAt)),
        escapeCsvCell(r.stripeSessionId || ''),
        ...(includeNotesColumn ? [escapeCsvCell(sanitizeSpreadsheetText(r.notes || ''))] : []),
        ...distinctQuestions.map((q) => {
          const resp = byQuestionId.get(q.questionId);
          return escapeCsvCell(
            sanitizeSpreadsheetText(resp ? formatQuestionResponseValue(resp) : ''),
          );
        }),
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

  registrationUrl(reg: EventRegistration): string {
    return this.routingService.hrefForView(Views.EventRegistrationView, {
      eventId: this.eventId(),
      registrationId: reg.docId,
    });
  }

  onRowClick(event: MouseEvent, reg: EventRegistration) {
    const target = event.target as HTMLElement | null;
    if (target && target.closest('a, button, input, select, textarea')) {
      return;
    }
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (selection && selection.toString().length > 0) {
      return;
    }
    this.routingService.navigateTo(`events/${this.eventId()}/registrations/${reg.docId}`);
  }
}
