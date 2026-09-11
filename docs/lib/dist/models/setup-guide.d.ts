export declare enum SetupCategory {
    LocalDev = "LocalDev",
    EmulatorSuite = "EmulatorSuite",
    ProductionProvisioning = "ProductionProvisioning",
    ThirdPartyIntegrations = "ThirdPartyIntegrations",
    BackupsDisasterRecovery = "BackupsDisasterRecovery"
}
export interface SetupCommand {
    command: string;
    explanation: string;
}
export interface TestAccount {
    persona: string;
    email: string;
    password: string;
    roles: string;
}
export interface GotchaItem {
    issue: string;
    resolution: string;
}
export interface SetupGuideEntry {
    id: string;
    title: string;
    category: SetupCategory;
    summary: string;
    prerequisites: string[];
    commands: SetupCommand[];
    testAccounts?: TestAccount[];
    commonGotchas?: GotchaItem[];
    verifiedFlows: string[];
}
//# sourceMappingURL=setup-guide.d.ts.map