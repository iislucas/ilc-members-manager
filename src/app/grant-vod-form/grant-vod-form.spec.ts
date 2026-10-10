import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { GrantVodFormComponent, GrantVodResult } from './grant-vod-form';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import {
  GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH,
  GrantVideoAccessResponse,
  VideoSeries,
  initVideoItem,
} from '../../../functions/src/data-model/vod';
import { Member, initMember } from '../../../functions/src/data-model/members';
import {
  MailSendingStatus,
  MailSettings,
  TransactionalEmailKey,
  initMailSettings,
} from '../../../functions/src/data-model/mail';

describe('GrantVodFormComponent', () => {
  let component: GrantVodFormComponent;
  let fixture: ComponentFixture<GrantVodFormComponent>;
  let mailSettings: ReturnType<typeof signal<MailSettings>>;
  let grantVideoAccess: ReturnType<typeof vi.fn>;

  const video = {
    ...initVideoItem(),
    docId: 'vid_1',
    title: 'Neutral Stance',
    seriesId: 'series_basics',
    seriesTitle: 'Basics',
  };
  const series: VideoSeries = {
    seriesId: 'series_basics',
    title: 'Basics',
    description: '',
    tags: [],
    videoCount: 3,
    totalDurationSeconds: 0,
    videos: [video],
  };
  const member: Member = {
    ...initMember(),
    docId: 'mem_1',
    memberId: 'US402',
    name: 'Test Student',
    emails: ['student@example.com'],
  };
  const okResponse: GrantVideoAccessResponse = {
    success: true,
    grantedCount: 1,
    recipientEmail: 'student@example.com',
    notifiedInApp: true,
    emailSent: true,
  };

  function mailWith(status: MailSendingStatus): MailSettings {
    const s = initMailSettings();
    return { ...s, status, notificationStatus: { ...s.notificationStatus, [TransactionalEmailKey.VodAccessGranted]: status } };
  }

  async function create(inputs: { video?: typeof video | null; series?: VideoSeries | null; parentSeries?: VideoSeries | null }) {
    const memberSet = new SearchableSet<'memberId', Member>(['name'], 'memberId');
    memberSet.setEntries([member]);
    mailSettings = signal(mailWith(MailSendingStatus.Active));
    grantVideoAccess = vi.fn().mockResolvedValue(okResponse);
    await TestBed.configureTestingModule({
      imports: [GrantVodFormComponent],
      providers: [
        {
          provide: DataManagerService,
          useValue: {
            members: memberSet,
            mailSettings,
            grantVideoAccess,
            getMember: vi.fn(),
            getMemberByMemberId: vi.fn().mockReturnValue(member),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(GrantVodFormComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('video', inputs.video ?? null);
    fixture.componentRef.setInput('series', inputs.series ?? null);
    fixture.componentRef.setInput('parentSeries', inputs.parentSeries ?? null);
    fixture.componentRef.setInput('cancelHref', '/back');
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  describe('for a series', () => {
    beforeEach(() => create({ series }));

    it('grants the series without offering a video/series choice', () => {
      expect(component.canChooseScope()).toBe(false);
      expect(component.grantScope()).toBe('series');
      expect(component.targetId()).toBe('series_basics');
      expect(text()).not.toContain('This video only');
    });
  });

  describe('for a video in a series', () => {
    beforeEach(() => create({ video, parentSeries: series }));

    it('defaults to the video and lets the admin grant the whole series instead', () => {
      expect(component.canChooseScope()).toBe(true);
      expect(component.grantScope()).toBe('video');
      expect(component.targetId()).toBe('vid_1');
      component.grantScope.set('series');
      expect(component.targetId()).toBe('series_basics');
      expect(component.title()).toBe('Basics');
    });

    it('starts with the "Access granted" preset, keeping {title} for the server to fill in', () => {
      expect(component.message()).toBe("You've been given access to **{title}**.");
      expect(component.editorValue()).toBe(component.message());
    });

    it('uses the shared markdown editor with {title} and {name} placeholder chips', () => {
      const editor = (fixture.nativeElement as HTMLElement).querySelector('app-markdown-editor');
      expect(editor).toBeTruthy();
      expect(component.messageChips.map((c) => c.token)).toEqual(['{title}', '{name}']);
    });

    it('switches presets and re-applies a preset after edits', () => {
      component.selectPreset('gift');
      expect(component.message()).toBe('🎁 A gift for you: enjoy **{title}**!');
      expect(component.editorValue()).toBe(component.message());
      component.message.set('custom');
      component.selectPreset('gift');
      expect(component.message()).toContain('A gift for you');
    });

    it('flags formatting that email cannot render', () => {
      component.message.set('# Heading');
      expect(component.messageWarnings().length).toBeGreaterThan(0);
    });

    it('sends an optional expiry date and rejects a date in the past', async () => {
      component.onMemberSelected(member);
      component.expiresOn.set('2000-01-01');
      await component.submit();
      expect(grantVideoAccess).not.toHaveBeenCalled();
      expect(component.errorMessage()).toContain('today or later');

      component.expiresOn.set('2999-12-31');
      await component.submit();
      expect(grantVideoAccess).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: '2999-12-31' }));
    });

    it('sends no expiry when none is chosen', async () => {
      component.onMemberSelected(member);
      await component.submit();
      expect(grantVideoAccess).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: undefined }));
    });

    it('submits an admin grant with the edited message and emits the result', async () => {
      const results: GrantVodResult[] = [];
      component.granted.subscribe((r) => results.push(r));
      component.onMemberSelected(member);
      component.message.set('Welcome aboard!');
      component.notes.set('Level 3 reward');
      await component.submit();
      expect(grantVideoAccess).toHaveBeenCalledWith({
        targetType: 'video',
        targetId: 'vid_1',
        recipientEmail: 'student@example.com',
        recipientMemberDocId: 'mem_1',
        recipientName: 'Test Student',
        notes: 'Level 3 reward',
        sendNotification: true,
        notificationMessage: 'Welcome aboard!',
      });
      expect(results[0].title).toBe('Neutral Stance');
      expect(results[0].notificationRequested).toBe(true);
    });

    it('grants silently without a message when notifications are off', async () => {
      component.onMemberSelected(member);
      component.sendNotification.set(false);
      fixture.detectChanges();
      expect(text()).toContain('Access will be added silently');
      await component.submit();
      expect(grantVideoAccess).toHaveBeenCalledWith(
        expect.objectContaining({ sendNotification: false, notificationMessage: undefined }),
      );
    });

    it('rejects a message that is too long', async () => {
      component.onMemberSelected(member);
      component.message.set('x'.repeat(GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH + 1));
      await component.submit();
      expect(grantVideoAccess).not.toHaveBeenCalled();
      expect(component.errorMessage()).toContain(String(GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH));
    });

    it('allows granting to any email even when email notifications are off', async () => {
      mailSettings.set(mailWith(MailSendingStatus.Off));
      component.toggleManualEmail();
      component.manualEmail.set('Guest@Example.com');
      fixture.detectChanges();
      expect(component.recipientMember()).toBeNull();
      expect(component.notificationNotice()).toContain('Please contact them directly');
      await component.submit();
      expect(grantVideoAccess).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'guest@example.com', recipientMemberDocId: undefined }),
      );
    });

    it('tells the admin a member will only get an in-app notification when email is off', () => {
      mailSettings.set(mailWith(MailSendingStatus.Off));
      component.onMemberSelected(member);
      expect(component.notificationNotice()).toContain('only get an in-app notification');
    });

    it('recognises a typed email that belongs to a member', () => {
      component.toggleManualEmail();
      component.manualEmail.set('student@example.com');
      expect(component.recipientMember()?.docId).toBe('mem_1');
      expect(component.notificationNotice()).toBeNull();
    });

    it('warns that non-members get email only when email is on', () => {
      component.toggleManualEmail();
      component.manualEmail.set('guest@example.com');
      expect(component.notificationNotice()).toContain('email but no in-app notification');
    });

    it('requires a valid email', async () => {
      component.toggleManualEmail();
      component.manualEmail.set('not-an-email');
      await component.submit();
      expect(grantVideoAccess).not.toHaveBeenCalled();
      expect(component.errorMessage()).toContain('valid email');
    });
  });
});
