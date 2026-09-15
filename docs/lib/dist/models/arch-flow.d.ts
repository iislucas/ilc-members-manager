export declare enum FlowCategory {
    ClientReactivity = "ClientReactivity",
    TriggerMirroring = "TriggerMirroring",
    ECommerceWebhooks = "ECommerceWebhooks",
    MediaTranscoding = "MediaTranscoding",
    MicroFrontends = "MicroFrontends",
    EmailAndNotifications = "EmailAndNotifications"
}
export type FlowTierType = 'client' | 'cloud-functions' | 'database' | 'external' | 'user';
export interface FlowStep {
    stepNumber: number;
    sourceTier: string;
    targetTier: string;
    action: string;
    payloadDescription: string;
    codePointers: string[];
    tierType?: FlowTierType;
    protocol?: string;
}
export interface ArchFlowEntry {
    id: string;
    title: string;
    category: FlowCategory;
    summary: string;
    trigger: string;
    steps: FlowStep[];
    inputDataTypes: string[];
    outputDataTypes: string[];
    cloudFunctions: string[];
    clientServices: string[];
    diagramId?: string;
    mermaidDiagram?: string;
}
//# sourceMappingURL=arch-flow.d.ts.map