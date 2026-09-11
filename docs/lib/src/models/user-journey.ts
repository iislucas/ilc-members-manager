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

export interface JourneyStep {
  stepNumber: number;
  actor: UserActor;
  title: string;
  description: string;
  screenViewId?: string;
  screenPath?: string;
  mutatedDataTypes?: string[];
  triggeredFlow?: string;
}

export interface UserJourneyEntry {
  id: string;
  title: string;
  primaryActor: UserActor;
  participatingActors: UserActor[];
  summary: string;
  steps: JourneyStep[];
  relatedStories: string[];
  relatedDataTypes: string[];
  relatedFlows: string[];
  relatedPatterns: string[];
  setupPrerequisites: string[];
}
