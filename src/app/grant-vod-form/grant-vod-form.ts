/* grant-vod-form.ts
 *
 * Admin form to grant access to a single video or a whole series to a member
 * or to any email address. Every admin grant is a plain "admin grant"; the
 * admin chooses whether to notify the recipient and, if so, edits the message
 * (starting from one of two presets) in the same markdown editor used for
 * system email templates, with {title}/{name} placeholders filled in
 * server-side. An optional expiry can be set. Embedded in the grant pages at
 * /manage-vod/video/:videoId/grant and /manage-vod/series/:seriesId/grant.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import {
  GRANT_MESSAGE_PLACEHOLDERS,
  GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH,
  GrantVideoAccessResponse,
  VideoItem,
  VideoSeries,
} from '../../../functions/src/data-model/vod';
import { findUnsupportedEmailMarkdown } from '../../../functions/src/email-markdown';
import { Member } from '../../../functions/src/data-model/members';
import {
  MailSendingStatus,
  TransactionalEmailKey,
  resolveNotificationStatus,
} from '../../../functions/src/data-model/mail';
import { DataManagerService } from '../data-manager.service';
import { MemberSelectorComponent } from '../member-selector/member-selector';
import { EditorChip, MarkdownEditor, MarkdownFeature } from '../markdown-editor/markdown-editor';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

export type GrantMessagePresetId = 'access' | 'gift';

/**
 * Recipient-facing notification presets. Placeholders (GRANT_MESSAGE_PLACEHOLDERS)
 * are kept as-is and filled in server-side, like system email templates.
 */
export const GRANT_MESSAGE_PRESETS: readonly { id: GrantMessagePresetId; label: string; template: string }[] = [
  { id: 'access', label: 'Access granted', template: `You've been given access to **${GRANT_MESSAGE_PLACEHOLDERS.title}**.` },
  { id: 'gift', label: 'Gift', template: `🎁 A gift for you: enjoy **${GRANT_MESSAGE_PLACEHOLDERS.title}**!` },
];

/** Today's date as YYYY-MM-DD in the admin's local time (min for the expiry picker). */
function localDateString(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Emitted after a successful grant, for the page to show a confirmation. */
export interface GrantVodResult {
  response: GrantVideoAccessResponse;
  targetType: 'video' | 'series';
  targetId: string;
  title: string;
  recipientLabel: string;
  notificationRequested: boolean;
  /** YYYY-MM-DD the access ends (end of day, UTC), if any. */
  expiresOn?: string;
}

@Component({
  selector: 'app-grant-vod-form',
  standalone: true,
  imports: [MemberSelectorComponent, IconComponent, SpinnerComponent, MarkdownEditor],
  templateUrl: './grant-vod-form.html',
  styleUrl: './grant-vod-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrantVodFormComponent {
  private dataService = inject(DataManagerService);

  readonly presets = GRANT_MESSAGE_PRESETS;
  readonly maxMessageLength = GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH;
  /** Same formatting as system email bodies (they're rendered into the email). */
  readonly messageFeatures: MarkdownFeature[] = ['bold', 'link'];
  readonly messageChips: EditorChip[] = [
    { token: GRANT_MESSAGE_PLACEHOLDERS.title, description: 'Title of the video or series' },
    { token: GRANT_MESSAGE_PLACEHOLDERS.name, description: "Recipient's name" },
  ];

  /** Provide exactly one of `video` or `series`. */
  video = input<VideoItem | null>(null);
  series = input<VideoSeries | null>(null);
  /** For a video: the series it belongs to (lets the admin grant the whole series instead). */
  parentSeries = input<VideoSeries | null>(null);
  /** Where Cancel goes. */
  cancelHref = input.required<string>();

  granted = output<GrantVodResult>();

  // Scope: a series page always grants the series; a video page grants the
  // video, or optionally its whole series.
  private parentSeriesId = computed(() => {
    const v = this.video();
    return this.parentSeries()?.seriesId || v?.seriesId || v?.forVodPageId || '';
  });
  canChooseScope = computed(() => !this.series() && Boolean(this.video()) && Boolean(this.parentSeriesId()));
  grantScope = linkedSignal<'video' | 'series'>(() => (this.series() ? 'series' : 'video'));

  targetId = computed(() => {
    const s = this.series();
    if (s) return s.seriesId;
    return this.grantScope() === 'series' ? this.parentSeriesId() : this.video()?.docId || '';
  });

  title = computed(() => {
    const s = this.series();
    if (s) return s.title;
    const v = this.video();
    if (this.grantScope() === 'series') {
      return this.parentSeries()?.title || v?.seriesTitle || v?.forVodSeriesTitle || 'this series';
    }
    return v?.title || 'this video';
  });

  seriesVideoCount = computed(() => {
    const s = this.series() ?? this.parentSeries();
    return s ? s.videoCount || s.videos.length : 0;
  });

  // Recipient: an existing member, or any email address.
  useManualEmail = signal<boolean>(false);
  selectedMemberId = signal<string>('');
  selectedMember = signal<Member | null>(null);
  manualEmail = signal<string>('');
  recipientName = signal<string>('');

  recipientEmail = computed(() => {
    if (this.useManualEmail()) return this.manualEmail().trim().toLowerCase();
    return this.selectedMember()?.emails?.[0]?.trim().toLowerCase() || '';
  });

  /** The member behind the recipient, if any (a typed email may still belong to a member). */
  recipientMember = computed<Member | null>(() => {
    if (!this.useManualEmail()) return this.selectedMember();
    const email = this.recipientEmail();
    if (!email) return null;
    return (
      this.dataService.members
        .entries()
        .find((m) => (m.emails || []).some((e) => e.trim().toLowerCase() === email)) ?? null
    );
  });

  // Notification
  sendNotification = signal<boolean>(true);
  presetId = signal<GrantMessagePresetId>('access');
  /** Value loaded into the editor; only changes when a preset is chosen. */
  editorValue = signal<string>(GRANT_MESSAGE_PRESETS[0].template);
  /** The current message as edited (markdown, placeholders unfilled). */
  message = signal<string>(GRANT_MESSAGE_PRESETS[0].template);
  messageTooLong = computed(() => this.message().length > this.maxMessageLength);
  messageWarnings = computed(() => findUnsupportedEmailMarkdown(this.message()));

  /** Optional expiry date (YYYY-MM-DD); access ends at the end of that day (UTC). */
  expiresOn = signal<string>('');
  readonly minExpiryDate = localDateString();

  /** Private note for admins (shown in the access list), never sent to the recipient. */
  notes = signal<string>('');

  isMailOff = computed(
    () =>
      resolveNotificationStatus(this.dataService.mailSettings(), TransactionalEmailKey.VodAccessGranted) ===
      MailSendingStatus.Off,
  );

  /** How (or whether) the recipient will hear about the grant, given email settings and membership. */
  notificationNotice = computed<string | null>(() => {
    if (!this.sendNotification() || !this.recipientEmail()) return null;
    const hasAccount = Boolean(this.recipientMember());
    if (this.isMailOff()) {
      return hasAccount
        ? 'Email notifications are turned off, so they will only get an in-app notification.'
        : 'Email notifications are turned off and this person has no member account, so they will not be notified. ' +
            'Please contact them directly to let them know once access is granted.';
    }
    return hasAccount
      ? null
      : 'This person has no member account, so they will get an email but no in-app notification. ' +
          'They will have access when they sign in with this email address.';
  });

  isGranting = signal<boolean>(false);
  errorMessage = signal<string>('');

  onMemberSelected(m: Member | null): void {
    this.selectedMember.set(m);
    if (m) this.recipientName.set(m.name || '');
  }

  toggleManualEmail(): void {
    this.useManualEmail.update((v) => !v);
    this.errorMessage.set('');
  }

  selectPreset(id: GrantMessagePresetId): void {
    this.presetId.set(id);
    // Re-apply even if the same preset is picked again after edits.
    const preset = this.presets.find((p) => p.id === id) ?? this.presets[0];
    this.message.set(preset.template);
    this.editorValue.set(preset.template);
  }

  async submit(): Promise<void> {
    this.errorMessage.set('');
    const email = this.recipientEmail();
    if (!email || !email.includes('@')) {
      this.errorMessage.set('Please select a member with an email address, or enter a valid email.');
      return;
    }
    const targetId = this.targetId();
    if (!targetId) {
      this.errorMessage.set('Could not identify the video or series to grant.');
      return;
    }
    const expiresOn = this.expiresOn().trim();
    if (expiresOn && expiresOn < this.minExpiryDate) {
      this.errorMessage.set('The expiry date must be today or later.');
      return;
    }
    const sendNotification = this.sendNotification();
    if (sendNotification && this.messageTooLong()) {
      this.errorMessage.set(`The message must be at most ${this.maxMessageLength} characters.`);
      return;
    }

    const targetType = this.grantScope();
    this.isGranting.set(true);
    try {
      const response = await this.dataService.grantVideoAccess({
        targetType,
        targetId,
        recipientEmail: email,
        recipientMemberDocId: this.recipientMember()?.docId || undefined,
        recipientName: this.recipientName().trim() || undefined,
        notes: this.notes().trim() || undefined,
        expiresAt: expiresOn || undefined,
        sendNotification,
        notificationMessage: sendNotification ? this.message().trim() : undefined,
      });
      if (!response.success) {
        this.errorMessage.set('Failed to grant access.');
        return;
      }
      const member = this.recipientMember();
      this.granted.emit({
        response,
        targetType,
        targetId,
        title: this.title(),
        recipientLabel: member ? `${member.name} (${email})` : email,
        notificationRequested: sendNotification,
        expiresOn: expiresOn || undefined,
      });
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'An error occurred while granting access.');
    } finally {
      this.isGranting.set(false);
    }
  }
}
