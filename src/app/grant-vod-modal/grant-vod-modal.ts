/* grant-vod-modal.ts
 *
 * Administrator modal dialog to grant or gift VOD access (single video or series)
 * to an existing member or by email address.
 */

import {
  Component,
  input,
  output,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VideoItem, VideoSeries, VideoGrantKind } from '../../../functions/src/data-model/vod';
import { Member } from '../../../functions/src/data-model/members';
import { MailSendingStatus } from '../../../functions/src/data-model/mail';
import { DataManagerService } from '../data-manager.service';
import { MemberSelectorComponent } from '../member-selector/member-selector';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-grant-vod-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MemberSelectorComponent,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './grant-vod-modal.html',
  styleUrl: './grant-vod-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrantVodModalComponent {
  private dataService = inject(DataManagerService);

  video = input<VideoItem | null>(null);
  series = input<VideoSeries | null>(null);

  closed = output<void>();
  granted = output<{ targetId: string; recipientEmail: string; grantedCount: number }>();

  // Scope: 'video' | 'series'
  grantScope = signal<'video' | 'series'>('video');

  // Recipient selection
  selectedMemberId = signal<string>('');
  selectedMember = signal<Member | null>(null);
  useManualEmail = signal<boolean>(false);
  manualEmail = signal<string>('');
  recipientName = signal<string>('');

  // Grant parameters
  grantKind = signal<VideoGrantKind>(VideoGrantKind.AdminGrant);
  notes = signal<string>('');
  isGranting = signal<boolean>(false);
  errorMessage = signal<string>('');

  isMailOff = computed(() => {
    return this.dataService.mailSettings().status === MailSendingStatus.Off;
  });

  readonly VideoGrantKind = VideoGrantKind;

  canGrantSeries = computed(() => {
    if (this.series()) return true;
    const v = this.video();
    return Boolean(v?.seriesId || v?.forVodPageId);
  });

  effectiveTargetId = computed(() => {
    if (this.grantScope() === 'series') {
      return this.series()?.seriesId || this.video()?.seriesId || this.video()?.forVodPageId || '';
    }
    return this.video()?.docId || '';
  });

  effectiveTitle = computed(() => {
    if (this.grantScope() === 'series') {
      return this.series()?.title || this.video()?.seriesTitle || this.video()?.forVodSeriesTitle || 'Series';
    }
    return this.video()?.title || 'Video';
  });

  effectiveRecipientEmail = computed(() => {
    if (this.useManualEmail()) {
      return this.manualEmail().trim().toLowerCase();
    }
    const mem = this.selectedMember();
    return mem?.emails?.[0]?.trim().toLowerCase() || '';
  });

  onMemberSelected(m: Member | null) {
    this.selectedMember.set(m);
    if (m) {
      this.recipientName.set(m.name || '');
    }
  }

  async submitGrant() {
    this.errorMessage.set('');
    const email = this.effectiveRecipientEmail();
    if (!email || !email.includes('@')) {
      this.errorMessage.set('Please select a member with a valid email or enter a recipient email.');
      return;
    }

    if (this.isMailOff() && !this.selectedMember()) {
      const allMembers = this.dataService.members.entries() || [];
      const found = allMembers.find(
        (m) => (m.emails || []).some((e) => e.toLowerCase() === email.toLowerCase())
      );
      if (!found) {
        this.errorMessage.set(
          'Email notifications are currently turned off. Access can only be granted to existing member accounts.',
        );
        return;
      }
    }

    const targetId = this.effectiveTargetId();
    if (!targetId) {
      this.errorMessage.set('Could not identify target video or series.');
      return;
    }

    this.isGranting.set(true);
    try {
      const res = await this.dataService.grantVideoAccess({
        targetType: this.grantScope(),
        targetId,
        recipientEmail: email,
        recipientMemberDocId: this.selectedMember()?.docId || undefined,
        recipientName: this.recipientName().trim() || undefined,
        grantKind: this.grantKind(),
        notes: this.notes().trim() || undefined,
      });

      if (res.success) {
        this.granted.emit({
          targetId,
          recipientEmail: email,
          grantedCount: res.grantedCount,
        });
        this.closed.emit();
      } else {
        this.errorMessage.set('Failed to grant video access.');
      }
    } catch (err: any) {
      this.errorMessage.set(err.message || 'An error occurred while granting access.');
    } finally {
      this.isGranting.set(false);
    }
  }

  close() {
    this.closed.emit();
  }
}
