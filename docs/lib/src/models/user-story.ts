/* user-story.ts
 *
 * Model defining a user story with Given/When/Then acceptance criteria and code/test links.
 */

export interface StoryScenario {
  name: string;
  given: string;
  when: string;
  then: string;
}

export interface CodeReference {
  file: string;
  symbol?: string;
  line?: number;
}

export interface TestReference {
  file: string;
  testSuite: string;
}

export interface UserStoryEntry {
  id: string;
  title: string;
  status: 'Draft' | 'Implemented' | 'Retired';
  area: string;
  role: string;
  capability: string;
  benefit: string;
  scenarios: StoryScenario[];
  codeReferences: CodeReference[];
  testReferences: TestReference[];
}
