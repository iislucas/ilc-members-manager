import { DataTypeEntry } from '../models/data-type';
import { UserJourneyEntry } from '../models/user-journey';
import { InteractionPlanEntry } from '../models/interaction-plan';
import { ArchFlowEntry } from '../models/arch-flow';
import { PatternEntry } from '../models/pattern-doc';
import { SetupGuideEntry } from '../models/setup-guide';
import { CodeFileEntry } from '../models/code-file';
export interface InterlinkRelations {
    relatedSetup: Array<{
        id: string;
        title: string;
    }>;
    relatedJourneys: Array<{
        id: string;
        title: string;
    }>;
    relatedPlans: Array<{
        id: string;
        title: string;
    }>;
    relatedDataTypes: Array<{
        id: string;
        name: string;
    }>;
    relatedFlows: Array<{
        id: string;
        title: string;
    }>;
    relatedPatterns: Array<{
        id: string;
        name: string;
    }>;
    relatedFiles: Array<{
        path: string;
        responsibility: string;
    }>;
}
export declare class InterlinkResolver {
    private dataTypes;
    private journeys;
    private plans;
    private flows;
    private patterns;
    private setupGuides;
    private files;
    constructor(catalogs?: {
        dataTypes?: DataTypeEntry[];
        journeys?: UserJourneyEntry[];
        plans?: InteractionPlanEntry[];
        flows?: ArchFlowEntry[];
        patterns?: PatternEntry[];
        setupGuides?: SetupGuideEntry[];
        files?: CodeFileEntry[];
    });
    /**
     * Resolves all forward and inverse relationships for a specific data type.
     */
    resolveForDataType(typeId: string): InterlinkRelations;
}
//# sourceMappingURL=interlink-resolver.d.ts.map