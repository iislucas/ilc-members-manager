/* link-integrity-checker.ts
 *
 * Traverses all documentation catalogs and asserts that zero dead links or dangling
 * cross-references exist between the 5 views.
 */

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

export class LinkIntegrityChecker {
  public static check(catalogs: {
    dataTypes: DataTypeEntry[];
    journeys: UserJourneyEntry[];
    plans: InteractionPlanEntry[];
    flows: ArchFlowEntry[];
    patterns: PatternEntry[];
    setupGuides: SetupGuideEntry[];
    stories: UserStoryEntry[];
  }): IntegrityIssue[] {
    const issues: IntegrityIssue[] = [];

    const dataTypeIds = new Set(catalogs.dataTypes.map((d) => d.id));
    const journeyIds = new Set(catalogs.journeys.map((j) => j.id));
    const flowIds = new Set(catalogs.flows.map((f) => f.id));
    const patternIds = new Set(catalogs.patterns.map((p) => p.id));
    const storyIds = new Set(catalogs.stories.map((s) => s.id));

    // Validate journeys
    catalogs.journeys.forEach((j) => {
      j.relatedDataTypes.forEach((dt) => {
        if (!dataTypeIds.has(dt)) {
          issues.push({ sourceType: 'UserJourney', sourceId: j.id, field: 'relatedDataTypes', brokenTargetId: dt });
        }
      });
      j.relatedFlows.forEach((fl) => {
        if (!flowIds.has(fl)) {
          issues.push({ sourceType: 'UserJourney', sourceId: j.id, field: 'relatedFlows', brokenTargetId: fl });
        }
      });
      j.relatedStories.forEach((st) => {
        if (!storyIds.has(st)) {
          issues.push({ sourceType: 'UserJourney', sourceId: j.id, field: 'relatedStories', brokenTargetId: st });
        }
      });
      j.relatedPatterns.forEach((pt) => {
        if (!patternIds.has(pt)) {
          issues.push({ sourceType: 'UserJourney', sourceId: j.id, field: 'relatedPatterns', brokenTargetId: pt });
        }
      });
    });

    // Validate plans
    catalogs.plans.forEach((p) => {
      p.relatedDataTypes.forEach((dt) => {
        if (!dataTypeIds.has(dt)) {
          issues.push({ sourceType: 'InteractionPlan', sourceId: p.id, field: 'relatedDataTypes', brokenTargetId: dt });
        }
      });
      p.relatedFlows.forEach((fl) => {
        if (!flowIds.has(fl)) {
          issues.push({ sourceType: 'InteractionPlan', sourceId: p.id, field: 'relatedFlows', brokenTargetId: fl });
        }
      });
      p.relatedStories.forEach((st) => {
        if (!storyIds.has(st)) {
          issues.push({ sourceType: 'InteractionPlan', sourceId: p.id, field: 'relatedStories', brokenTargetId: st });
        }
      });
    });

    // Validate data types
    catalogs.dataTypes.forEach((d) => {
      d.relatedJourneys.forEach((j) => {
        if (!journeyIds.has(j)) {
          issues.push({ sourceType: 'DataType', sourceId: d.id, field: 'relatedJourneys', brokenTargetId: j });
        }
      });
      d.relatedFlows.forEach((f) => {
        if (!flowIds.has(f)) {
          issues.push({ sourceType: 'DataType', sourceId: d.id, field: 'relatedFlows', brokenTargetId: f });
        }
      });
    });

    return issues;
  }
}
