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
    taxonomyNodeId?: string;
    codeReferences: CodeReference[];
    testReferences: TestReference[];
}
//# sourceMappingURL=user-story.d.ts.map