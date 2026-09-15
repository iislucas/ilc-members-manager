export declare enum ArchitecturalLayer {
    ClientCoreService = "ClientCoreService",
    ClientUIComponent = "ClientUIComponent",
    ClientRouting = "ClientRouting",
    ClientState = "ClientState",
    CloudFunction = "CloudFunction",
    DataModel = "DataModel",
    Script = "Script",
    TestFixture = "TestFixture",
    Tool = "Tool",
    Configuration = "Configuration",
    SecurityRules = "SecurityRules"
}
export interface CodeFileEntry {
    /** Relative path from repository root (e.g. 'src/app/data-manager.service.ts') */
    path: string;
    layer: ArchitecturalLayer;
    responsibility: string;
    keySymbols: string[];
    relatedJourneys: string[];
    relatedDataTypes: string[];
    relatedStories: string[];
    relatedFlows: string[];
    relatedPatterns: string[];
}
//# sourceMappingURL=code-file.d.ts.map