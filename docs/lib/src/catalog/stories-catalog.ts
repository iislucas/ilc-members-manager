/* stories-catalog.ts
 *
 * Authoritative registry of all user stories in docs/user-stories/*.md.
 */

import { UserStoryEntry } from '../models/user-story';

export const STORIES_CATALOG: UserStoryEntry[] = [
  {
    id: 'grading-sifu-notifications',
    title: 'Primary instructor notified of student grading progress',
    status: 'Implemented',
    area: 'Gradings',
    role: 'Instructor (Sifu)',
    taxonomyNodeId: 'sifu-instructor',
    capability: 'receive automated notifications whenever my student requests, schedules, or completes a grading',
    benefit: 'I can mentor and track my students progression without manual check-ins',
    scenarios: [
      {
        name: 'Student requests grading with selected sifu',
        given: 'A student initiates a grading and selects Instructor 289',
        when: 'The grading record is saved in Firestore',
        then: 'A MemberNotification is created under /members/{instructorDocId}/notifications',
      },
    ],
    codeReferences: [
      { file: 'functions/src/on-grading-update.ts', symbol: 'onGradingUpdate', line: 150 },
    ],
    testReferences: [
      { file: 'tests/e2e/grading-event-managers.spec.ts', testSuite: 'story: grading-sifu-notifications' },
    ],
  },
  {
    id: 'grading-request-acceptance',
    title: "Student's grading request is accepted or declined",
    status: 'Implemented',
    area: 'Gradings',
    role: 'Instructor / Grading Manager',
    taxonomyNodeId: 'sifu-instructor',
    capability: 'accept or decline a students examination request with explanatory feedback',
    benefit: 'the student knows whether they are approved to attend the grading examination',
    scenarios: [
      {
        name: 'Instructor accepts grading request',
        given: 'A grading in Pending status',
        when: 'The instructor sets status to Accepted',
        then: 'acceptedByMemberDocId is recorded and student receives notification',
      },
    ],
    codeReferences: [
      { file: 'src/app/grading-edit/grading-edit.ts', symbol: 'GradingEditComponent', line: 110 },
      { file: 'functions/src/on-grading-update.ts', symbol: 'onGradingUpdate', line: 210 },
    ],
    testReferences: [
      { file: 'tests/e2e/grading-paid-and-snapshot.spec.ts', testSuite: 'story: grading-request-acceptance' },
    ],
  },
  {
    id: 'grading-result-recorded',
    title: 'Student sees their grading result and level update',
    status: 'Implemented',
    area: 'Gradings',
    role: 'Student / Member',
    taxonomyNodeId: 'student-practitioner',
    capability: 'view my finalized examination outcome and see my student or application level advance automatically',
    benefit: 'my digital passbook is always accurate immediately after passing',
    scenarios: [
      {
        name: 'Examiner records Pass result',
        given: 'A grading in Accepted or InReview status',
        when: 'Examiner changes status to Passed',
        then: 'The student Member record is updated with new studentLevel or applicationLevel',
      },
    ],
    codeReferences: [
      { file: 'functions/src/on-grading-update.ts', symbol: 'onGradingUpdate', line: 310 },
    ],
    testReferences: [
      { file: 'tests/e2e/grading-paid-and-snapshot.spec.ts', testSuite: 'story: grading-result-recorded' },
    ],
  },
  {
    id: 'grading-event-managers',
    title: 'Linking a grading to an event grants event staff manager access',
    status: 'Implemented',
    area: 'Gradings',
    role: 'Event Organizer / Manager',
    taxonomyNodeId: 'event-organizer',
    capability: 'manage, schedule, and grade students who linked their grading to my event',
    benefit: 'visiting examiners can evaluate attendees without needing permanent global instructor rights',
    scenarios: [
      {
        name: 'Grading linked to IlcEvent grants manager permissions',
        given: 'An event with managerDocIds and an unlinked grading',
        when: 'The grading sets gradingEventDocId to this event',
        then: 'The event managers can edit and grade the record via isGradingEventManager() rule',
      },
    ],
    codeReferences: [
      { file: 'firestore.rules', symbol: 'isGradingEventManager', line: 145 },
      { file: 'src/app/grading-edit/grading-edit.ts', symbol: 'userIsEventManager', line: 135 },
    ],
    testReferences: [
      { file: 'tests/e2e/grading-event-managers.spec.ts', testSuite: 'story: grading-event-managers' },
    ],
  },
  {
    id: 'grading-unpaid-request-guard',
    title: 'Only one unpaid grading request permitted per student',
    status: 'Implemented',
    area: 'Gradings',
    role: 'System Administrator',
    taxonomyNodeId: 'grading-candidate',
    capability: 'prevent students from submitting multiple redundant unpaid grading requests',
    benefit: 'the examination queue remains clean and accurate',
    scenarios: [
      {
        name: 'Student attempts second unpaid request',
        given: 'Student already has an unpaid grading request',
        when: 'Student calls requestGrading callable function',
        then: 'The request is rejected with failed-precondition error',
      },
    ],
    codeReferences: [
      { file: 'functions/src/grading-request.ts', symbol: 'requestGrading', line: 40 },
    ],
    testReferences: [
      { file: 'tests/e2e/grading-paid-and-snapshot.spec.ts', testSuite: 'story: grading-unpaid-request-guard' },
    ],
  },
  {
    id: 'email-notifications-dispatch',
    title: 'Administrator manages outbound email dispatch lifecycle and tests SMTP connectivity',
    status: 'Implemented',
    area: 'Email Notifications',
    role: 'HQ Administrator',
    taxonomyNodeId: 'hq-admin',
    capability: 'manage global outbound email sending state (Off, Paused, Active), send admin test emails, and monitor delivery queue',
    benefit: 'we can test email functionality safely without accidental member spam and have full observability over outbound delivery',
    scenarios: [
      {
        name: 'Off state zero-write enforcement',
        given: 'Global mail sending status is Off in /system/mail-settings',
        when: 'A purchase or onboarding notification is triggered',
        then: 'The dispatcher logs and exits with zero writes to /mail',
      },
      {
        name: 'Admin test email bypasses Off and Paused',
        given: 'Global mail sending is Off or Paused',
        when: 'An administrator sends a test email from /email-notifications',
        then: 'The document is enqueued with metadata.adminTest: true and dispatched via SMTP',
      },
      {
        name: 'Paused placeholder queuing and unpause release',
        given: 'Global mail sending is Paused',
        when: 'Notifications are triggered and status is later switched to Active',
        then: 'Placeholders are stored with raw template keys and rendered with latest templates upon unpause',
      },
      {
        name: 'Failed delivery retry',
        given: 'An email failed delivery with status ERROR',
        when: 'An administrator clicks Retry in the Mail Logs & Queue viewer',
        then: 'The document is reset to PENDING and automatically retried by the queue trigger',
      },
    ],
    codeReferences: [
      { file: 'src/app/email-notifications/email-notifications.component.ts', symbol: 'EmailNotificationsComponent', line: 1 },
      { file: 'functions/src/mail-processor.ts', symbol: 'processMailQueue', line: 1 },
      { file: 'functions/src/email-dispatcher.ts', symbol: 'sendSmtpEmail', line: 1 },
    ],
    testReferences: [
      { file: 'functions/src/mail-processor.spec.ts', testSuite: 'Mail Processor' },
      { file: 'src/app/email-notifications/email-notifications.component.spec.ts', testSuite: 'EmailNotificationsComponent' },
    ],
  },
];
