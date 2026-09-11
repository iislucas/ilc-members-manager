"use strict";
/* stories-catalog.ts
 *
 * Authoritative registry of all user stories in docs/user-stories/*.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORIES_CATALOG = void 0;
exports.STORIES_CATALOG = [
    {
        id: 'grading-sifu-notifications',
        title: 'Primary instructor notified of student grading progress',
        status: 'Implemented',
        area: 'Gradings',
        role: 'Instructor (Sifu)',
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
];
//# sourceMappingURL=stories-catalog.js.map