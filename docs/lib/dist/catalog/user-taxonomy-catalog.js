"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USER_TAXONOMY_TREE = void 0;
exports.flattenTaxonomy = flattenTaxonomy;
exports.findTaxonomyNode = findTaxonomyNode;
exports.buildTaxonomyHierarchy = buildTaxonomyHierarchy;
const user_taxonomy_1 = require("../models/user-taxonomy");
exports.USER_TAXONOMY_TREE = [
    {
        id: 'public-prospective',
        name: 'Public & Prospective Users',
        category: user_taxonomy_1.TaxonomyCategory.PublicAndProspective,
        roleSummary: 'Unauthenticated or prospective visitors exploring the ILC ecosystem, finding certified teachers, and attending open events.',
        responsibilities: [
            'Locate registered instructors and affiliated schools worldwide',
            'Browse open workshops and guest seminar schedules',
            'Submit membership applications and register accounts',
        ],
        permissionsSnapshot: ['read:public-instructors', 'read:public-schools', 'read:public-events', 'create:member-application'],
        startingJourneyIds: ['vod-streaming', 'event-hosting-ticketing', 'member-onboarding'],
        ownedJourneyIds: ['member-onboarding'],
        participatingJourneyIds: ['vod-streaming', 'event-hosting-ticketing'],
        planIds: ['plan-event-hosting-ticketing'],
        storyIds: [],
        startingRoutes: [
            { path: '/find-an-instructor', title: 'Instructor Locator', description: 'Search certified teachers by geographic location and rank' },
            { path: '/events', title: 'Events Calendar', description: 'Browse upcoming open seminars and master workshops' },
            { path: '/signup', title: 'Member Application', description: 'Apply for official student membership in the association' },
        ],
        children: [
            {
                id: 'anonymous-visitor',
                name: 'Anonymous Visitor',
                category: user_taxonomy_1.TaxonomyCategory.PublicAndProspective,
                roleSummary: 'Public web visitor browsing the public facing components without an authenticated session.',
                responsibilities: [
                    'Locate nearby instructors using the interactive map',
                    'Read public knowledge base articles and news updates',
                    'Inspect event details, itineraries, and ticket tiers',
                ],
                permissionsSnapshot: ['read:public-data'],
                startingJourneyIds: ['vod-streaming', 'event-hosting-ticketing'],
                ownedJourneyIds: [],
                participatingJourneyIds: ['vod-streaming', 'event-hosting-ticketing'],
                planIds: ['plan-event-hosting-ticketing'],
                storyIds: [],
                startingRoutes: [
                    { path: '/find-an-instructor', title: 'Instructor Locator', description: 'Find registered teachers by city or country' },
                    { path: '/events', title: 'Public Events', description: 'Browse seminars open to non-members' },
                ],
            },
            {
                id: 'prospective-member',
                name: 'Prospective Member / Applicant',
                category: user_taxonomy_1.TaxonomyCategory.PublicAndProspective,
                roleSummary: 'Individual actively applying for official membership or onboarding into the digital passbook.',
                responsibilities: [
                    'Submit membership application with contact details',
                    'Verify email address and configure credentials',
                    'Submit introductory registration fee if applicable',
                ],
                permissionsSnapshot: ['create:member-application', 'read:own-profile'],
                startingJourneyIds: ['member-onboarding'],
                ownedJourneyIds: ['member-onboarding'],
                participatingJourneyIds: [],
                planIds: [],
                storyIds: [],
                startingRoutes: [
                    { path: '/signup', title: 'Sign Up', description: 'Create Firebase Auth account' },
                    { path: '/me', title: 'My Profile', description: 'Complete onboarding information' },
                ],
            },
            {
                id: 'external-attendee',
                name: 'External Workshop Attendee',
                category: user_taxonomy_1.TaxonomyCategory.PublicAndProspective,
                roleSummary: 'Non-member martial artist purchasing seminar or guest passes for open association events.',
                responsibilities: [
                    'Select ticket tier and complete Stripe checkout',
                    'Receive digital registration confirmation and QR pass',
                    'Check in at event reception',
                ],
                permissionsSnapshot: ['purchase:event-ticket', 'read:own-registrations'],
                startingJourneyIds: ['event-hosting-ticketing'],
                ownedJourneyIds: [],
                participatingJourneyIds: ['event-hosting-ticketing'],
                planIds: ['plan-event-hosting-ticketing'],
                storyIds: [],
                startingRoutes: [
                    { path: '/events/:id', title: 'Event Registration', description: 'Purchase seminar pass via Stripe Checkout' },
                ],
            },
        ],
    },
    {
        id: 'members-practitioners',
        name: 'Members & Practitioners',
        category: user_taxonomy_1.TaxonomyCategory.MembersAndPractitioners,
        roleSummary: 'Authenticated active students and practitioners advancing through the formal martial arts curriculum.',
        responsibilities: [
            'Track curriculum advancement on digital passbook',
            'Stream instructional Video-on-Demand library',
            'Register and pay for official grading examinations',
        ],
        permissionsSnapshot: ['read:member-passbook', 'read:curriculum', 'stream:vod', 'request:grading'],
        startingJourneyIds: ['grading-progression', 'vod-streaming', 'materials-download', 'push-notifications'],
        ownedJourneyIds: ['grading-progression', 'vod-streaming', 'materials-download', 'push-notifications'],
        participatingJourneyIds: ['member-onboarding', 'event-hosting-ticketing'],
        planIds: ['plan-grading-progression'],
        storyIds: ['grading-result-recorded', 'grading-unpaid-request-guard'],
        startingRoutes: [
            { path: '/me', title: 'Digital Passbook', description: 'Inspect level achievements and curriculum progression' },
            { path: '/vod', title: 'Video On Demand', description: 'Stream instructional series and masterclasses' },
            { path: '/gradings/next', title: 'Next Grading', description: 'Apply for promotion examination' },
        ],
        children: [
            {
                id: 'active-member',
                name: 'Active Member',
                category: user_taxonomy_1.TaxonomyCategory.MembersAndPractitioners,
                roleSummary: 'Verified association member with an active annual membership license.',
                responsibilities: [
                    'Inspect active membership validity and expiration dates',
                    'Maintain personal profile and emergency contact information',
                    'View order history, invoices, and billing portal',
                ],
                permissionsSnapshot: ['read:member-profile', 'read:own-orders', 'manage:billing-portal'],
                startingJourneyIds: ['materials-download', 'push-notifications', 'vod-streaming'],
                ownedJourneyIds: ['materials-download', 'push-notifications'],
                participatingJourneyIds: ['member-onboarding', 'event-hosting-ticketing', 'vod-streaming'],
                planIds: ['plan-grading-progression'],
                storyIds: ['grading-result-recorded'],
                startingRoutes: [
                    { path: '/me', title: 'My Profile', description: 'View membership credentials and status' },
                    { path: '/orders', title: 'Orders & Receipts', description: 'Manage Stripe subscriptions and payments' },
                ],
            },
            {
                id: 'student-practitioner',
                name: 'Student Practitioner (Levels 1–9)',
                category: user_taxonomy_1.TaxonomyCategory.MembersAndPractitioners,
                roleSummary: 'Student training toward formal rank examinations under certified instruction.',
                responsibilities: [
                    'Review curriculum requirements for current student/application level',
                    'Select certifying instructor (Sifu) for mentorship and feedback',
                    'Access form breakdowns and technical training notes',
                ],
                permissionsSnapshot: ['read:curriculum-level', 'read:syllabus'],
                startingJourneyIds: ['vod-streaming', 'grading-progression'],
                ownedJourneyIds: ['vod-streaming'],
                participatingJourneyIds: ['member-onboarding'],
                planIds: ['plan-grading-progression'],
                storyIds: ['grading-result-recorded'],
                startingRoutes: [
                    { path: '/me', title: 'Curriculum Progression', description: 'Review student syllabus requirements' },
                    { path: '/gradings', title: 'Grading History', description: 'Track passed examinations and feedback' },
                ],
            },
            {
                id: 'grading-candidate',
                name: 'Grading Candidate',
                category: user_taxonomy_1.TaxonomyCategory.MembersAndPractitioners,
                roleSummary: 'Practitioner actively seeking level evaluation or rank advancement.',
                responsibilities: [
                    'Verify eligibility criteria for target level',
                    'Submit grading request with designated instructor',
                    'Pay examination fee via Stripe checkout',
                    'Attend exam session and receive certified grade outcome',
                ],
                permissionsSnapshot: ['create:grading-request', 'purchase:grading-fee', 'read:grading-feedback'],
                startingJourneyIds: ['grading-progression'],
                ownedJourneyIds: ['grading-progression'],
                participatingJourneyIds: [],
                planIds: ['plan-grading-progression'],
                storyIds: ['grading-unpaid-request-guard', 'grading-request-acceptance', 'grading-result-recorded'],
                startingRoutes: [
                    { path: '/gradings/next', title: 'Apply for Grading', description: 'Select level, sifu, and submit request' },
                    { path: '/gradings/:id', title: 'Grading Record', description: 'Check acceptance status and feedback' },
                ],
            },
        ],
    },
    {
        id: 'certified-instructors',
        name: 'Certified Instructors & Mentors',
        category: user_taxonomy_1.TaxonomyCategory.CertifiedInstructors,
        roleSummary: 'Certified teachers authorized to train students, review examination readiness, and administer grading tests.',
        responsibilities: [
            'Mentor students and monitor their training progression',
            'Accept or decline student grading applications with feedback',
            'Conduct examination tests and record official results',
            'Manage public profile in the instructor locator',
        ],
        permissionsSnapshot: ['accept:grading-request', 'evaluate:grading', 'mentor:students', 'update:instructor-profile'],
        startingJourneyIds: ['instructor-licensing', 'grading-progression'],
        ownedJourneyIds: ['instructor-licensing'],
        participatingJourneyIds: ['grading-progression', 'materials-download', 'push-notifications'],
        planIds: ['plan-grading-progression'],
        storyIds: ['grading-sifu-notifications', 'grading-request-acceptance', 'grading-result-recorded'],
        startingRoutes: [
            { path: '/gradings', title: 'Gradings Queue', description: 'Review, accept, or decline student applications' },
            { path: '/my-students', title: 'Student Roster', description: 'Track active students and examination readiness' },
            { path: '/instructors/:id', title: 'Instructor Profile', description: 'Edit bio, credentials, and teaching schedule' },
        ],
        children: [
            {
                id: 'apprentice-instructor',
                name: 'Apprentice Instructor',
                category: user_taxonomy_1.TaxonomyCategory.CertifiedInstructors,
                roleSummary: 'Assistant instructor in training, assisting senior teachers with classroom instruction.',
                responsibilities: [
                    'Assist senior instructors with beginner class training',
                    'Track student attendance and syllabus familiarity',
                ],
                permissionsSnapshot: ['read:student-roster', 'read:school-gradings'],
                startingJourneyIds: ['instructor-licensing'],
                ownedJourneyIds: [],
                participatingJourneyIds: ['grading-progression'],
                planIds: ['plan-grading-progression'],
                storyIds: [],
                startingRoutes: [
                    { path: '/my-students', title: 'Assigned Students', description: 'View assigned apprentice student roster' },
                ],
            },
            {
                id: 'sifu-instructor',
                name: 'Sifu / Full Instructor',
                category: user_taxonomy_1.TaxonomyCategory.CertifiedInstructors,
                roleSummary: 'Fully accredited instructor authorized to sponsor students for promotion examinations.',
                responsibilities: [
                    'Receive notifications when students request examination',
                    'Review candidate readiness and approve/decline applications',
                    'Provide actionable technical feedback notes',
                    'Maintain published public locator profile',
                ],
                permissionsSnapshot: ['accept:grading-request', 'update:instructor-profile', 'mentor:students'],
                startingJourneyIds: ['instructor-licensing', 'grading-progression'],
                ownedJourneyIds: ['instructor-licensing'],
                participatingJourneyIds: ['grading-progression', 'push-notifications'],
                planIds: ['plan-grading-progression', 'plan-school-licensing'],
                storyIds: ['grading-sifu-notifications', 'grading-request-acceptance'],
                startingRoutes: [
                    { path: '/gradings', title: 'Instructor Review Console', description: 'Approve or decline student grading requests' },
                    { path: '/my-students', title: 'My Mentored Students', description: 'Manage direct student apprentices' },
                    { path: '/instructors/:id', title: 'Public Profile', description: 'Manage public locator listing' },
                ],
            },
            {
                id: 'grading-examiner',
                name: 'Chief Examiner / Grading Judge',
                category: user_taxonomy_1.TaxonomyCategory.CertifiedInstructors,
                roleSummary: 'Senior certified examiner authorized to test candidates and record official Pass/Fail outcomes.',
                responsibilities: [
                    'Conduct formal curriculum evaluations during seminars or school exams',
                    'Record official grading decisions (Passed, NotPassed, InReview)',
                    'Provide standardized assessment commentary',
                ],
                permissionsSnapshot: ['record:grading-result', 'evaluate:grading'],
                startingJourneyIds: ['grading-progression'],
                ownedJourneyIds: [],
                participatingJourneyIds: ['grading-progression'],
                planIds: ['plan-grading-progression'],
                storyIds: ['grading-result-recorded'],
                startingRoutes: [
                    { path: '/gradings/:id', title: 'Examiner Scoring Console', description: 'Input official pass/fail results' },
                ],
            },
        ],
    },
    {
        id: 'institutional-events',
        name: 'Institutional & Events Leadership',
        category: user_taxonomy_1.TaxonomyCategory.InstitutionalAndEvents,
        roleSummary: 'Branch owners, school directors, and event coordinators governing local branches and seminars.',
        responsibilities: [
            'Maintain accredited school standing and student rosters',
            'Organize association events and configure ticket tiers',
            'Manage event-linked grading examinations',
            'Renew annual school licensing agreements',
        ],
        permissionsSnapshot: ['manage:school', 'manage:event', 'manage:event-gradings', 'license:school-renewal'],
        startingJourneyIds: ['event-hosting-ticketing', 'instructor-licensing'],
        ownedJourneyIds: ['event-hosting-ticketing'],
        participatingJourneyIds: ['instructor-licensing', 'grading-progression'],
        planIds: ['plan-event-hosting-ticketing', 'plan-school-licensing'],
        storyIds: ['grading-event-managers'],
        startingRoutes: [
            { path: '/my-schools', title: 'My Schools', description: 'Administer school branches and student rosters' },
            { path: '/events/manage', title: 'Event Operations', description: 'Create and manage association events' },
        ],
        children: [
            {
                id: 'school-manager',
                name: 'School Manager / Branch Director',
                category: user_taxonomy_1.TaxonomyCategory.InstitutionalAndEvents,
                roleSummary: 'Director managing an affiliated training branch, its licensed teachers, and student body.',
                responsibilities: [
                    'Maintain school branch profile, location, and contact information',
                    'Manage school-wide student rosters and enrollments',
                    'Organize branch-level grading examination days',
                    'Complete annual school license renewal via Stripe',
                ],
                permissionsSnapshot: ['manage:school', 'manage:school-roster', 'license:school-renewal'],
                startingJourneyIds: ['instructor-licensing'],
                ownedJourneyIds: [],
                participatingJourneyIds: ['instructor-licensing', 'grading-progression'],
                planIds: ['plan-school-licensing'],
                storyIds: [],
                startingRoutes: [
                    { path: '/my-schools', title: 'School Dashboard', description: 'School profile, instructors, and student directory' },
                    { path: '/schools/:id/gradings', title: 'School Gradings', description: 'Schedule branch promotion examinations' },
                    { path: '/schools/:id/license', title: 'License Renewal', description: 'Renew annual school affiliation fee' },
                ],
            },
            {
                id: 'event-organizer',
                name: 'Event Organizer / Host',
                category: user_taxonomy_1.TaxonomyCategory.InstitutionalAndEvents,
                roleSummary: 'Coordinator hosting regional seminars, international camps, or master workshops.',
                responsibilities: [
                    'Create event listing with venue information and schedule',
                    'Configure ticket tiers, early-bird pricing, and capacity limits',
                    'Link grading examinations to event schedule',
                    'Check in attendees via QR code scanning or manual lookup',
                ],
                permissionsSnapshot: ['manage:event', 'manage:event-gradings', 'checkin:attendees'],
                startingJourneyIds: ['event-hosting-ticketing'],
                ownedJourneyIds: ['event-hosting-ticketing'],
                participatingJourneyIds: ['grading-progression'],
                planIds: ['plan-event-hosting-ticketing', 'plan-grading-progression'],
                storyIds: ['grading-event-managers'],
                startingRoutes: [
                    { path: '/events/manage', title: 'Event Management', description: 'Publish and administer seminar details' },
                    { path: '/events/:id/attendees', title: 'Attendee Roster', description: 'Check-in registered participants' },
                    { path: '/events/:id/gradings', title: 'Event Gradings', description: 'Manage gradings linked to seminar' },
                ],
            },
        ],
    },
    {
        id: 'governance-system',
        name: 'Platform Governance & Automation',
        category: user_taxonomy_1.TaxonomyCategory.GovernanceAndSystem,
        roleSummary: 'HQ governance authorities and automated cloud background services operating the infrastructure.',
        responsibilities: [
            'Global member account verification and data reconciliation',
            'Manual overrides for orders, gradings, and permissions',
            'Automated background event processing, mirroring, and backups',
        ],
        permissionsSnapshot: ['admin:all', 'service:firebase-admin', 'override:orders'],
        startingJourneyIds: ['member-onboarding', 'event-hosting-ticketing', 'instructor-licensing'],
        ownedJourneyIds: [],
        participatingJourneyIds: ['grading-progression', 'member-onboarding', 'event-hosting-ticketing', 'instructor-licensing', 'materials-download', 'push-notifications'],
        planIds: ['plan-grading-progression', 'plan-event-hosting-ticketing', 'plan-school-licensing'],
        storyIds: ['grading-unpaid-request-guard', 'grading-sifu-notifications'],
        startingRoutes: [
            { path: '/admin', title: 'HQ Governance', description: 'System overview and administrative controls' },
            { path: '/admin/members', title: 'Member Governance', description: 'Account verifications and role overrides' },
            { path: '/admin/orders', title: 'Commerce Administration', description: 'Stripe order overrides and refunds' },
        ],
        children: [
            {
                id: 'hq-admin',
                name: 'HQ Administrator',
                category: user_taxonomy_1.TaxonomyCategory.GovernanceAndSystem,
                roleSummary: 'Executive association administrator with unrestricted system oversight and manual override authority.',
                responsibilities: [
                    'Approve school affiliations and instructor certifications',
                    'Execute manual level adjustments or data emergency fixes',
                    'Audit financial transactions, invoices, and refunds',
                    'Manage outbound email sending states, templates, and delivery queue',
                    'Directly grant complimentary or gifted VOD streaming access to members or external emails',
                    'Trigger disaster recovery and full database backups',
                ],
                permissionsSnapshot: ['admin:all', 'override:orders', 'manage:backups', 'verify:members', 'grant:vod-access'],
                startingJourneyIds: ['member-onboarding', 'event-hosting-ticketing', 'outbound-email-notifications'],
                ownedJourneyIds: ['outbound-email-notifications'],
                participatingJourneyIds: ['grading-progression', 'member-onboarding', 'event-hosting-ticketing', 'instructor-licensing', 'materials-download', 'vod-streaming'],
                planIds: ['plan-grading-progression', 'plan-event-hosting-ticketing', 'plan-school-licensing'],
                storyIds: ['grading-unpaid-request-guard', 'email-notifications-dispatch'],
                startingRoutes: [
                    { path: '/admin', title: 'Admin Overview', description: 'Platform health and verification queue' },
                    { path: '/email-notifications', title: 'Email Notifications & Mail Queue', description: 'Monitor outbound mail queue, test SMTP delivery, manage dispatch state (Off/Paused/Active), and configure notification templates' },
                    { path: '/videos?grant=true', title: 'Grant VOD Access Modal', description: 'Admin modal dialog to directly grant access to videos or series' },
                    { path: '/admin/members', title: 'Member Master Roster', description: 'Search, edit, and verify all accounts' },
                    { path: '/admin/orders', title: 'Financial Overrides', description: 'Manage Stripe transactions and license records' },
                ],
            },
            {
                id: 'system-automation',
                name: 'Cloud Triggers & Background Automation',
                category: user_taxonomy_1.TaxonomyCategory.GovernanceAndSystem,
                roleSummary: 'Autonomous backend triggers, Stripe webhook workers, and scheduled cloud jobs.',
                responsibilities: [
                    'Handle Stripe checkout.session.completed webhooks and fulfill orders',
                    'Execute onGradingUpdate, onMemberUpdate, and mirror records into subcollections',
                    'Dynamically recalculate /acl/{email} access control caches',
                    'Run nightly GCS database backups via scheduled Cloud Functions',
                ],
                permissionsSnapshot: ['service:firebase-admin', 'webhook:stripe', 'transcoder:gcp'],
                startingJourneyIds: ['vod-streaming', 'grading-progression'],
                ownedJourneyIds: [],
                participatingJourneyIds: ['grading-progression', 'member-onboarding', 'event-hosting-ticketing', 'vod-streaming', 'materials-download', 'push-notifications'],
                planIds: ['plan-grading-progression', 'plan-event-hosting-ticketing', 'plan-school-licensing'],
                storyIds: ['grading-sifu-notifications', 'grading-unpaid-request-guard'],
                startingRoutes: [
                    { path: 'functions/src/stripe-webhook.ts', title: 'Stripe Webhook', description: 'Asynchronous payment fulfillment' },
                    { path: 'functions/src/on-grading-update.ts', title: 'Grading Trigger', description: 'Automated level upgrades and mirroring' },
                ],
            },
        ],
    },
];
function flattenTaxonomy(nodes = exports.USER_TAXONOMY_TREE) {
    const result = [];
    for (const node of nodes) {
        result.push(node);
        if (node.children?.length) {
            result.push(...flattenTaxonomy(node.children));
        }
    }
    return result;
}
function findTaxonomyNode(id, nodes = exports.USER_TAXONOMY_TREE) {
    for (const node of nodes) {
        if (node.id === id)
            return node;
        if (node.children?.length) {
            const match = findTaxonomyNode(id, node.children);
            if (match)
                return match;
        }
    }
    return undefined;
}
/**
 * Builds a structured, complete 3-level taxonomy hierarchy:
 * Level 1: Persona (User)
 *   -> Level 2: User Journeys (Owned + Participating)
 *     -> Level 3: Steps on the Journey (with screen route, data mutations, and inter-user handoffs)
 */
function buildTaxonomyHierarchy(taxonomyNodes, journeys) {
    const flatNodes = flattenTaxonomy(taxonomyNodes);
    const result = [];
    for (const node of flatNodes) {
        const ownedIds = new Set(node.ownedJourneyIds || []);
        const partIds = new Set(node.participatingJourneyIds || []);
        const startingIds = new Set(node.startingJourneyIds || []);
        // Filter journeys relevant to this persona
        const relevantJourneys = journeys.filter((j) => ownedIds.has(j.id) ||
            partIds.has(j.id) ||
            startingIds.has(j.id) ||
            j.primaryTaxonomyNodeId === node.id ||
            j.participatingTaxonomyNodeIds?.includes(node.id));
        const journeyViews = relevantJourneys.map((j) => {
            const isOwner = ownedIds.has(j.id) || j.primaryTaxonomyNodeId === node.id;
            return {
                journeyId: j.id,
                title: j.title,
                summary: j.summary,
                isOwner,
                steps: j.steps.map((s) => ({
                    stepId: s.stepId || `step-${j.id}-${s.stepNumber}`,
                    stepNumber: s.stepNumber,
                    actor: s.actor,
                    actorTaxonomyId: s.actorTaxonomyId,
                    title: s.title,
                    description: s.description,
                    screenPath: s.screenPath,
                    mutatedDataTypes: s.mutatedDataTypes,
                    triggeredFlow: s.triggeredFlow,
                    handoff: s.handoff,
                    receivedFrom: s.receivedFrom,
                })),
            };
        });
        result.push({
            personaId: node.id,
            personaName: node.name,
            category: node.category,
            roleSummary: node.roleSummary,
            journeys: journeyViews,
        });
    }
    return result;
}
//# sourceMappingURL=user-taxonomy-catalog.js.map