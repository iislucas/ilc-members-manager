/* user-taxonomy.ts
 *
 * Strongly-typed data models for the hierarchical User Taxonomy in ILC Members Manager.
 */

export enum TaxonomyCategory {
  PublicAndProspective = 'Public & Prospective',
  MembersAndPractitioners = 'Members & Practitioners',
  CertifiedInstructors = 'Certified Instructors',
  InstitutionalAndEvents = 'Institutional & Events',
  GovernanceAndSystem = 'Governance & System',
}

export interface StartingRoute {
  path: string;
  title: string;
  description: string;
}

export interface UserTaxonomyNode {
  id: string;
  name: string;
  category: TaxonomyCategory;
  roleSummary: string;
  responsibilities: string[];
  permissionsSnapshot: string[];
  startingJourneyIds: string[];
  planIds: string[];
  storyIds: string[];
  startingRoutes: StartingRoute[];
  children?: UserTaxonomyNode[];
}
