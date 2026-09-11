/* data-type.ts
 *
 * Model defining a domain entity with 3 hierarchical levels of detail:
 * Level 1: Executive & Domain Summary
 * Level 2: Data Flow & Security Rules
 * Level 3: Full Technical Schema & Field Dictionary
 */

export enum DataDomainGroup {
  IdentityAuth = 'IdentityAuth',
  OrganizationSchool = 'OrganizationSchool',
  CurriculumGrading = 'CurriculumGrading',
  EventsTicketing = 'EventsTicketing',
  MediaVod = 'MediaVod',
  CommerceFulfillment = 'CommerceFulfillment',
  CommunityContent = 'CommunityContent',
  SystemInfrastructure = 'SystemInfrastructure',
}

export interface DataTypeField {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  constraints?: string;
  description: string;
}

export interface DataTypeKeyRelation {
  targetTypeId: string;
  targetTypeName: string;
  relation: string;
}

export interface DataTypeEntry {
  id: string;
  name: string;
  domain: DataDomainGroup;
  collectionPath: string;
  isSubcollection: boolean;
  parentCollection?: string;
  sourceFile: string;

  // Level 1: Executive Summary
  summary: string;
  cardinality: string;
  ownership: string;
  keyRelations: DataTypeKeyRelation[];

  // Level 2: Data Flow & Security Rules
  readRoles: string[];
  writeRoles: string[];
  rulesSummary: string;
  affectedTriggers: string[];
  mirrorTargets: string[];
  relatedJourneys: string[];
  relatedFlows: string[];

  // Level 3: Full Technical Schema & Specification
  tsInterface: string;
  initDefaults: string;
  converterFunction: string;
  fields: DataTypeField[];
}
