export declare enum TaxonomyCategory {
    PublicAndProspective = "Public & Prospective",
    MembersAndPractitioners = "Members & Practitioners",
    CertifiedInstructors = "Certified Instructors",
    InstitutionalAndEvents = "Institutional & Events",
    GovernanceAndSystem = "Governance & System"
}
export interface StartingRoute {
    path: string;
    title: string;
    description: string;
}
import { StepHandoff } from './user-journey';
export interface UserTaxonomyNode {
    id: string;
    name: string;
    category: TaxonomyCategory;
    roleSummary: string;
    responsibilities: string[];
    permissionsSnapshot: string[];
    startingJourneyIds: string[];
    ownedJourneyIds?: string[];
    participatingJourneyIds?: string[];
    planIds: string[];
    storyIds: string[];
    startingRoutes: StartingRoute[];
    children?: UserTaxonomyNode[];
}
export interface TaxonomyStepView {
    stepId: string;
    stepNumber: number;
    actor: string;
    actorTaxonomyId?: string;
    title: string;
    description: string;
    screenPath?: string;
    mutatedDataTypes?: string[];
    triggeredFlow?: string;
    handoff?: StepHandoff;
    receivedFrom?: StepHandoff;
}
export interface TaxonomyJourneyView {
    journeyId: string;
    title: string;
    summary: string;
    isOwner: boolean;
    steps: TaxonomyStepView[];
}
export interface PersonaTaxonomyHierarchy {
    personaId: string;
    personaName: string;
    category: TaxonomyCategory;
    roleSummary: string;
    journeys: TaxonomyJourneyView[];
}
//# sourceMappingURL=user-taxonomy.d.ts.map