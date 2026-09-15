"use strict";
/* plans-catalog.ts
 *
 * Authoritative registry of multi-actor collaborative interaction plans (directed node-edge graphs).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANS_CATALOG = void 0;
const interaction_plan_1 = require("../models/interaction-plan");
const user_journey_1 = require("../models/user-journey");
exports.PLANS_CATALOG = [
    {
        id: 'plan-grading-progression',
        title: 'The Grading Examination & Progression Plan',
        summary: 'Multi-actor directed graph capturing student request, Sifu review/approval, event manager linkage, examiner evaluation, and automated level advancement.',
        actors: [user_journey_1.UserActor.Member, user_journey_1.UserActor.Instructor, user_journey_1.UserActor.EventOrganizer, user_journey_1.UserActor.HQAdmin],
        nodes: [
            { id: 'n1', label: 'Check Next Eligible Level', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.Member, description: 'Student inspects progression rule nextGradingPayment()' },
            { id: 'n2', label: 'Submit Request / Pay Fee', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.Member, description: 'Student creates grading request or pays via Stripe' },
            { id: 'n3', label: 'Trigger: onGradingCreated', type: interaction_plan_1.PlanNodeType.SystemTrigger, actor: 'System', description: 'System mirrors record to Sifu and sends GradingCreated notification' },
            { id: 'n4', label: 'Review Student Readiness', type: interaction_plan_1.PlanNodeType.DecisionGate, actor: user_journey_1.UserActor.Instructor, description: 'Primary instructor (Sifu) determines eligibility' },
            { id: 'n5', label: 'Decline Request with Reason', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.Instructor, description: 'Sifu declines and provides training feedback' },
            { id: 'n6', label: 'Accept Request', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.Instructor, description: 'Sifu approves student for examination' },
            { id: 'n7', label: 'Link to Upcoming Event', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.EventOrganizer, description: 'Grading linked to an IlcEvent' },
            { id: 'n8', label: 'Derive Manager Permissions', type: interaction_plan_1.PlanNodeType.SystemTrigger, actor: 'System', description: 'Event managers gain grading management rights via isGradingEventManager()' },
            { id: 'n9', label: 'Conduct Examination', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.Instructor, description: 'Examiner tests student curriculum' },
            { id: 'n10', label: 'Record Exam Result', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.Instructor, description: 'Examiner sets status to Passed, NotPassed, or InReview' },
            { id: 'n11', label: 'Trigger: onGradingUpdate', type: interaction_plan_1.PlanNodeType.SystemTrigger, actor: 'System', description: 'Advances studentLevel, mirrors result, dispatches notification' },
            { id: 'n12', label: 'View Updated Passbook', type: interaction_plan_1.PlanNodeType.StateMilestone, actor: user_journey_1.UserActor.Member, description: 'Student sees new rank badge and certificate milestone' },
        ],
        edges: [
            { fromNodeId: 'n1', toNodeId: 'n2', label: 'Eligible' },
            { fromNodeId: 'n2', toNodeId: 'n3', label: 'Created in Firestore' },
            { fromNodeId: 'n3', toNodeId: 'n4', label: 'Notification received' },
            { fromNodeId: 'n4', toNodeId: 'n5', condition: 'Not Ready' },
            { fromNodeId: 'n4', toNodeId: 'n6', condition: 'Approved' },
            { fromNodeId: 'n6', toNodeId: 'n7', label: 'Schedule exam' },
            { fromNodeId: 'n7', toNodeId: 'n8', label: 'Event docId set' },
            { fromNodeId: 'n8', toNodeId: 'n9', label: 'Authorized' },
            { fromNodeId: 'n9', toNodeId: 'n10', label: 'Exam completed' },
            { fromNodeId: 'n10', toNodeId: 'n11', label: 'Status saved' },
            { fromNodeId: 'n11', toNodeId: 'n12', label: 'Level advanced' },
        ],
        relatedDataTypes: ['grading', 'member', 'ilc-event', 'order'],
        relatedFlows: ['client-reactivity', 'trigger-mirroring'],
        relatedStories: ['grading-sifu-notifications', 'grading-request-acceptance', 'grading-result-recorded', 'grading-event-managers', 'grading-unpaid-request-guard'],
        mermaidGraph: `flowchart TD
    n1[Check Next Eligible Level] --> n2[Submit Request / Pay Fee]
    n2 --> n3[Trigger: onGradingCreated]
    n3 --> n4{Review Student Readiness}
    n4 -- Not Ready --> n5[Decline Request with Reason]
    n4 -- Approved --> n6[Accept Request]
    n6 --> n7[Link to Upcoming Event]
    n7 --> n8[Derive Manager Permissions]
    n8 --> n9[Conduct Examination]
    n9 --> n10[Record Exam Result]
    n10 --> n11[Trigger: onGradingUpdate]
    n11 --> n12[View Updated Passbook]`,
    },
    {
        id: 'plan-event-hosting-ticketing',
        title: 'The Event Hosting, Ticketing & Attendee Management Plan',
        summary: 'Multi-actor directed graph capturing event proposal, admin publication, attendee registration, Stripe payment settlement, and live event check-in.',
        actors: [user_journey_1.UserActor.EventOrganizer, user_journey_1.UserActor.HQAdmin, user_journey_1.UserActor.Member, user_journey_1.UserActor.PublicVisitor],
        nodes: [
            { id: 'e1', label: 'Draft Event Proposal', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.EventOrganizer, description: 'Organizer defines dates, venue, and ticket tiers' },
            { id: 'e2', label: 'Admin Review & Approval', type: interaction_plan_1.PlanNodeType.DecisionGate, actor: user_journey_1.UserActor.HQAdmin, description: 'HQ Admin reviews and publishes event' },
            { id: 'e3', label: 'Publish to Public Calendar', type: interaction_plan_1.PlanNodeType.StateMilestone, actor: 'System', description: 'Event visible on calendar and Web Components' },
            { id: 'e4', label: 'Discover & Select Tier', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.Member, description: 'Attendee selects In-Person or Online ticket tier' },
            { id: 'e5', label: 'Complete Stripe Checkout', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.Member, description: 'Payment completed on Stripe' },
            { id: 'e6', label: 'Webhook Fulfillment', type: interaction_plan_1.PlanNodeType.SystemTrigger, actor: 'System', description: 'stripeWebhook creates EventRegistration and confirmation' },
            { id: 'e7', label: 'Live Attendee Check-In', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.EventOrganizer, description: 'Organizer marks attendee checkedIn on site' },
        ],
        edges: [
            { fromNodeId: 'e1', toNodeId: 'e2', label: 'Submit for review' },
            { fromNodeId: 'e2', toNodeId: 'e3', condition: 'Approved' },
            { fromNodeId: 'e3', toNodeId: 'e4', label: 'Visible to public' },
            { fromNodeId: 'e4', toNodeId: 'e5', label: 'Initiate purchase' },
            { fromNodeId: 'e5', toNodeId: 'e6', label: 'Payment confirmed' },
            { fromNodeId: 'e6', toNodeId: 'e7', label: 'Ticket issued' },
        ],
        relatedDataTypes: ['ilc-event', 'event-registration', 'product', 'order'],
        relatedFlows: ['ecommerce-webhooks', 'micro-frontends'],
        relatedStories: [],
        mermaidGraph: `flowchart TD
    e1[Draft Event Proposal] --> e2{Admin Review & Approval}
    e2 -- Approved --> e3[Publish to Public Calendar]
    e3 --> e4[Discover & Select Tier]
    e4 --> e5[Complete Stripe Checkout]
    e5 --> e6[Webhook Fulfillment]
    e6 --> e7[Live Attendee Check-In]`,
    },
    {
        id: 'plan-school-licensing',
        title: 'The School Affiliation & Licensing Plan',
        summary: 'Collaborative plan connecting school managers, school license renewals, student affiliations, and instructor permissions.',
        actors: [user_journey_1.UserActor.SchoolManager, user_journey_1.UserActor.Instructor, user_journey_1.UserActor.Member, user_journey_1.UserActor.HQAdmin],
        nodes: [
            { id: 'sc1', label: 'School Manager Renews License', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.SchoolManager, description: 'Submits annual school license renewal' },
            { id: 'sc2', label: 'Stripe Webhook Settles Order', type: interaction_plan_1.PlanNodeType.SystemTrigger, actor: 'System', description: 'Fulfillment updates School licenseExpires' },
            { id: 'sc3', label: 'Trigger: onSchoolUpdate', type: interaction_plan_1.PlanNodeType.SystemTrigger, actor: 'System', description: 'Recalculates school manager ACL permissions' },
            { id: 'sc4', label: 'Student Affiliates with School', type: interaction_plan_1.PlanNodeType.ActorAction, actor: user_journey_1.UserActor.Member, description: 'Student selects school on member profile' },
            { id: 'sc5', label: 'Mirror Student to School Roster', type: interaction_plan_1.PlanNodeType.SystemTrigger, actor: 'System', description: 'Trigger mirrors member into /schools/{id}/members' },
            { id: 'sc6', label: 'School Manager Monitors Roster', type: interaction_plan_1.PlanNodeType.StateMilestone, actor: user_journey_1.UserActor.SchoolManager, description: 'School manager tracks student levels and pass rates' },
        ],
        edges: [
            { fromNodeId: 'sc1', toNodeId: 'sc2', label: 'Checkout complete' },
            { fromNodeId: 'sc2', toNodeId: 'sc3', label: 'School updated' },
            { fromNodeId: 'sc4', toNodeId: 'sc5', label: 'Profile saved' },
            { fromNodeId: 'sc5', toNodeId: 'sc6', label: 'Roster synced' },
        ],
        relatedDataTypes: ['school', 'member', 'acl', 'order'],
        relatedFlows: ['trigger-mirroring', 'ecommerce-webhooks'],
        relatedStories: [],
        mermaidGraph: `flowchart TD
    sc1[School Manager Renews License] --> sc2[Stripe Webhook Settles Order]
    sc2 --> sc3[Trigger: onSchoolUpdate]
    sc4[Student Affiliates with School] --> sc5[Mirror Student to School Roster]
    sc5 --> sc6[School Manager Monitors Roster]`,
    },
];
//# sourceMappingURL=plans-catalog.js.map