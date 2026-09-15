export declare enum DataDomainGroup {
    IdentityAuth = "IdentityAuth",
    OrganizationSchool = "OrganizationSchool",
    CurriculumGrading = "CurriculumGrading",
    EventsTicketing = "EventsTicketing",
    MediaVod = "MediaVod",
    CommerceFulfillment = "CommerceFulfillment",
    CommunityContent = "CommunityContent",
    SystemInfrastructure = "SystemInfrastructure"
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
    summary: string;
    cardinality: string;
    ownership: string;
    keyRelations: DataTypeKeyRelation[];
    readRoles: string[];
    writeRoles: string[];
    rulesSummary: string;
    affectedTriggers: string[];
    mirrorTargets: string[];
    relatedJourneys: string[];
    relatedFlows: string[];
    tsInterface: string;
    initDefaults: string;
    converterFunction: string;
    fields: DataTypeField[];
}
//# sourceMappingURL=data-type.d.ts.map