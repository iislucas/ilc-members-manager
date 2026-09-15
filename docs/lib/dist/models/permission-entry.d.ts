export type PermissionAccessType = 'read' | 'write' | 'read-write' | 'admin' | 'system';
export interface PermissionEntry {
    id: string;
    title: string;
    category: string;
    description: string;
    accessType: PermissionAccessType;
    targetDataTypes: string[];
    securityRulesMechanism: string;
    ruleCodeSnippet?: string;
    grantedPersonas: string[];
}
//# sourceMappingURL=permission-entry.d.ts.map