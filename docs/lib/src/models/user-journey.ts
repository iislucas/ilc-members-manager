/* user-journey.ts
 *
 * Models defining user personas, the 97+ view site surface map, and user journeys.
 */

export enum UserActor {
  HQAdmin = 'HQAdmin',
  SchoolManager = 'SchoolManager',
  Instructor = 'Instructor',
  Member = 'Member',
  EventOrganizer = 'EventOrganizer',
  PublicVisitor = 'PublicVisitor',
}

export interface SiteSurfaceEntry {
  viewId: string;
  pathPattern: string;
  permittedRoles: UserActor[];
  objective: string;
  actions: string[];
  componentFile: string;
}

export type InteractionType =
  | 'approval_request'
  | 'fulfillment'
  | 'notification'
  | 'handoff'
  | 'evaluation'
  | 'settlement';

export interface StepHandoff {
  targetTaxonomyId: string;
  targetTaxonomyName: string;
  targetJourneyId: string;
  targetJourneyTitle: string;
  targetStepNumber: number;
  targetStepTitle: string;
  interactionType: InteractionType;
  description: string;
}

export interface JourneyStep {
  stepId?: string;
  stepNumber: number;
  actor: UserActor;
  actorTaxonomyId?: string;
  title: string;
  description: string;
  screenViewId?: string;
  screenPath?: string;
  mutatedDataTypes?: string[];
  triggeredFlow?: string;
  handoff?: StepHandoff;
  receivedFrom?: StepHandoff;
}

export interface UserJourneyEntry {
  id: string;
  title: string;
  primaryActor: UserActor;
  primaryTaxonomyNodeId?: string;
  participatingActors: UserActor[];
  participatingTaxonomyNodeIds?: string[];
  summary: string;
  steps: JourneyStep[];
  relatedStories: string[];
  relatedDataTypes: string[];
  relatedFlows: string[];
  relatedPatterns: string[];
  setupPrerequisites: string[];
}
