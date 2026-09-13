import { describe, it, expect } from 'vitest';
import { LinkIntegrityChecker } from '../src/validator/link-integrity-checker';
import { DATA_TYPES_CATALOG } from '../src/catalog/data-types-catalog';
import { USER_JOURNEYS_CATALOG } from '../src/catalog/journeys-catalog';
import { PLANS_CATALOG } from '../src/catalog/plans-catalog';
import { FLOWS_CATALOG } from '../src/catalog/flows-catalog';
import { PATTERNS_CATALOG } from '../src/catalog/patterns-catalog';
import { SETUP_CATALOG } from '../src/catalog/setup-catalog';
import { STORIES_CATALOG } from '../src/catalog/stories-catalog';
import {
  USER_TAXONOMY_TREE,
  findTaxonomyNode,
  flattenTaxonomy,
  buildTaxonomyHierarchy,
} from '../src/catalog/user-taxonomy-catalog';

describe('LinkIntegrityChecker', () => {
  it('should have zero broken cross-references between the 5 views', () => {
    const issues = LinkIntegrityChecker.check({
      dataTypes: DATA_TYPES_CATALOG,
      journeys: USER_JOURNEYS_CATALOG,
      plans: PLANS_CATALOG,
      flows: FLOWS_CATALOG,
      patterns: PATTERNS_CATALOG,
      setupGuides: SETUP_CATALOG,
      stories: STORIES_CATALOG,
    });

    expect(issues).toEqual([]);
  });

  it('should have zero broken inter-user interaction handoff links', () => {
    const issues: string[] = [];
    const journeyMap = new Map(USER_JOURNEYS_CATALOG.map((j) => [j.id, j]));

    for (const journey of USER_JOURNEYS_CATALOG) {
      for (const step of journey.steps) {
        if (step.handoff) {
          const targetNode = findTaxonomyNode(step.handoff.targetTaxonomyId);
          if (!targetNode) {
            issues.push(`Journey "${journey.id}" step ${step.stepNumber}: targetTaxonomyId "${step.handoff.targetTaxonomyId}" not found in taxonomy tree`);
          }

          const targetJourney = journeyMap.get(step.handoff.targetJourneyId);
          if (!targetJourney) {
            issues.push(`Journey "${journey.id}" step ${step.stepNumber}: targetJourneyId "${step.handoff.targetJourneyId}" not found in journeys catalog`);
          } else {
            const targetStep = targetJourney.steps.find((s) => s.stepNumber === step.handoff!.targetStepNumber);
            if (!targetStep) {
              issues.push(`Journey "${journey.id}" step ${step.stepNumber}: targetStepNumber ${step.handoff.targetStepNumber} not found in target journey "${step.handoff.targetJourneyId}"`);
            }
          }
        }

        if (step.receivedFrom) {
          const targetNode = findTaxonomyNode(step.receivedFrom.targetTaxonomyId);
          if (!targetNode) {
            issues.push(`Journey "${journey.id}" step ${step.stepNumber}: receivedFrom targetTaxonomyId "${step.receivedFrom.targetTaxonomyId}" not found in taxonomy tree`);
          }

          const targetJourney = journeyMap.get(step.receivedFrom.targetJourneyId);
          if (!targetJourney) {
            issues.push(`Journey "${journey.id}" step ${step.stepNumber}: receivedFrom targetJourneyId "${step.receivedFrom.targetJourneyId}" not found in journeys catalog`);
          } else {
            const targetStep = targetJourney.steps.find((s) => s.stepNumber === step.receivedFrom!.targetStepNumber);
            if (!targetStep) {
              issues.push(`Journey "${journey.id}" step ${step.stepNumber}: receivedFrom targetStepNumber ${step.receivedFrom.targetStepNumber} not found in target journey "${step.receivedFrom.targetJourneyId}"`);
            }
          }
        }
      }
    }

    expect(issues).toEqual([]);
  });

  it('should successfully generate a complete 3-level taxonomy hierarchy for all personas', () => {
    const hierarchy = buildTaxonomyHierarchy(USER_TAXONOMY_TREE, USER_JOURNEYS_CATALOG);
    expect(hierarchy.length).toBe(flattenTaxonomy(USER_TAXONOMY_TREE).length);

    // Verify key personas have mapped journeys and steps
    const candidate = hierarchy.find((p) => p.personaId === 'grading-candidate');
    expect(candidate).toBeDefined();
    expect(candidate?.journeys.some((j) => j.journeyId === 'grading-progression')).toBe(true);

    const sifu = hierarchy.find((p) => p.personaId === 'sifu-instructor');
    expect(sifu).toBeDefined();
    expect(sifu?.journeys.some((j) => j.journeyId === 'grading-progression')).toBe(true);
    expect(sifu?.journeys.some((j) => j.journeyId === 'instructor-licensing')).toBe(true);
  });
});
