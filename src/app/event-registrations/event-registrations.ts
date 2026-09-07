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
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { AttendeeRole, AttendanceType, EventRegistration, IlcEvent } from '../../../functions/src/data-model/events';

@Component({
  selector: 'app-event-registrations',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './event-registrations.html',
  styleUrl: './event-registrations.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventRegistrationsComponent implements OnInit {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected firebaseState = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected productService = inject(ProductService);

  isLoading = signal(true);
  copiedAlert = signal(false);
  searchTerm = signal('');
  selectedFilter = signal<'all' | 'in_person' | 'online' | 'video'>('all');

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
    }

    if (!term) return list;

    return list.filter((r) => {
      const nameMatch = (r.name || '').toLowerCase().includes(term);
      const emailMatch = (r.email || '').toLowerCase().includes(term);
      const phoneMatch = (r.phone || '').toLowerCase().includes(term);
      return nameMatch || emailMatch || phoneMatch;
    });
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

  totalRevenue = computed(() => {
    const totalCents = this.registrations().reduce((sum, r) => sum + (r.amountPaidCents || 0), 0);
    return totalCents / 100;
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
    if (att === AttendanceType.VideoOnly) return 'Video Only';
    return 'In-Person';
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

  exportCsv() {
    const regs = this.filteredRegistrations();
    if (regs.length === 0) return;

    const headers = [
      'Name',
      'Email',
      'Phone',
      'Role',
      'Attendance Mode',
      'Video Access',
      'Amount Paid',
      'Currency',
      'Status',
      'Date Paid',
      'Stripe Session ID',
    ];

    const rows = regs.map((r) => [
      `"${(r.name || '').replace(/"/g, '""')}"`,
      `"${(r.email || '').replace(/"/g, '""')}"`,
      `"${(r.phone || '').replace(/"/g, '""')}"`,
      `"${this.formatRole(r.role)}"`,
      `"${this.formatAttendance(r.attendance)}"`,
      `"${r.hasVideoAccess ? 'Yes' : 'No'}"`,
      (r.amountPaidCents / 100).toFixed(2),
      (r.currency || 'usd').toUpperCase(),
      r.status,
      `"${this.formatDate(r.registeredAt)}"`,
      `"${r.stripeSessionId || ''}"`,
    ]);

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
