import { describe, it, expect } from 'vitest';
import { LinkIntegrityChecker } from '../src/validator/link-integrity-checker';
import { DATA_TYPES_CATALOG } from '../src/catalog/data-types-catalog';
import { USER_JOURNEYS_CATALOG } from '../src/catalog/journeys-catalog';
import { PLANS_CATALOG } from '../src/catalog/plans-catalog';
import { FLOWS_CATALOG } from '../src/catalog/flows-catalog';
import { PATTERNS_CATALOG } from '../src/catalog/patterns-catalog';
import { SETUP_CATALOG } from '../src/catalog/setup-catalog';
import { STORIES_CATALOG } from '../src/catalog/stories-catalog';

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
});
