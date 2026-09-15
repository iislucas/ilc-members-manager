import { DataTypeEntry } from '../models/data-type';
import { UserJourneyEntry } from '../models/user-journey';
import { InteractionPlanEntry } from '../models/interaction-plan';
import { ArchFlowEntry } from '../models/arch-flow';
import { PatternEntry } from '../models/pattern-doc';
import { SetupGuideEntry } from '../models/setup-guide';
import { UserStoryEntry } from '../models/user-story';
export interface IntegrityIssue {
    sourceType: string;
    sourceId: string;
    field: string;
    brokenTargetId: string;
}
export declare class LinkIntegrityChecker {
    static check(catalogs: {
        dataTypes: DataTypeEntry[];
        journeys: UserJourneyEntry[];
        plans: InteractionPlanEntry[];
        flows: ArchFlowEntry[];
        patterns: PatternEntry[];
        setupGuides: SetupGuideEntry[];
        stories: UserStoryEntry[];
    }): IntegrityIssue[];
}
//# sourceMappingURL=link-integrity-checker.d.ts.map