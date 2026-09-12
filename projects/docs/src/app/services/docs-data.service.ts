/* docs-data.service.ts
 *
 * Centralized reactive data service providing catalogs, search, and navigation state.
 */

import { Injectable, signal, computed } from '@angular/core';
import {
  FILES_CATALOG,
  DATA_TYPES_CATALOG,
  USER_JOURNEYS_CATALOG,
  SITE_SURFACE_MAP,
  PLANS_CATALOG,
  STORIES_CATALOG,
  FLOWS_CATALOG,
  SETUP_CATALOG,
  PATTERNS_CATALOG,
  USER_TAXONOMY_TREE,
  UserTaxonomyNode,
  findTaxonomyNode,
  flattenTaxonomy,
  CodeLinkResolver,
  DocsSearchIndex,
  SearchDoc,
} from '../../../../../docs/lib/src';

export type DocsViewId = 'setup' | 'journeys' | 'datatypes' | 'architecture' | 'patterns' | 'files';

export interface SearchResultItem {
  id: string;
  view: DocsViewId;
  title: string;
  subtitle?: string;
  url: string;
}

@Injectable({ providedIn: 'root' })
export class DocsDataService {
  // Catalogs
  readonly setupCatalog = SETUP_CATALOG;
  readonly journeysCatalog = USER_JOURNEYS_CATALOG;
  readonly surfaceMap = SITE_SURFACE_MAP;
  readonly plansCatalog = PLANS_CATALOG;
  readonly dataTypesCatalog = DATA_TYPES_CATALOG;
  readonly flowsCatalog = FLOWS_CATALOG;
  readonly patternsCatalog = PATTERNS_CATALOG;
  readonly storiesCatalog = STORIES_CATALOG;
  readonly filesCatalog = FILES_CATALOG;
  readonly filesCount = FILES_CATALOG.length;
  readonly taxonomyTree = USER_TAXONOMY_TREE;
  readonly flatTaxonomy = flattenTaxonomy(USER_TAXONOMY_TREE);

  // File layers summary
  readonly filesSummary = {
    total: FILES_CATALOG.length,
    layers: FILES_CATALOG.reduce((acc, f) => {
      acc[f.layer] = (acc[f.layer] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };

  // State Signals
  readonly currentView = signal<DocsViewId>('journeys');
  readonly selectedTaxonomyNode = signal<UserTaxonomyNode | null>(
    findTaxonomyNode('grading-candidate') || this.flatTaxonomy[0] || null
  );
  readonly selectedPlanId = signal<string>('plan-grading-progression');
  readonly isDarkTheme = signal<boolean>(false);
  readonly searchOpen = signal<boolean>(false);
  readonly searchQuery = signal<string>('');

  // Resolvers & Search Index
  private readonly codeResolver = new CodeLinkResolver({ repoRoot: '/Users/ldixon/code/zxd/ilc-members-manager' });
  private readonly searchIndex = new DocsSearchIndex();

  constructor() {
    this.buildSearchIndex();
  }

  private buildSearchIndex(): void {
    const docs: SearchDoc[] = [];

    // Setup
    this.setupCatalog.forEach((s) => {
      docs.push({
        id: `setup-${s.id}`,
        view: 'setup',
        title: s.title,
        subtitle: s.category,
        content: `${s.summary} ${s.commands.map((c) => `${c.command} ${c.explanation}`).join(' ')}`,
        tags: ['setup', 'emulator', s.category],
        url: `#setup-${s.id}`,
      });
    });

    // Journeys
    this.journeysCatalog.forEach((j) => {
      docs.push({
        id: `journey-${j.id}`,
        view: 'journeys',
        title: j.title,
        subtitle: j.primaryActor,
        content: `${j.summary} ${j.steps.map((st) => `${st.title} ${st.description}`).join(' ')}`,
        tags: ['journey', j.primaryActor, ...j.participatingActors],
        url: `#journey-${j.id}`,
      });
    });

    // Taxonomy Nodes
    this.flatTaxonomy.forEach((node) => {
      docs.push({
        id: `taxonomy-${node.id}`,
        view: 'journeys',
        title: node.name,
        subtitle: node.category,
        content: `${node.roleSummary} ${node.responsibilities.join(' ')} ${node.permissionsSnapshot.join(' ')}`,
        tags: ['persona', 'taxonomy', 'actor', node.category, node.name],
        url: `#taxonomy-${node.id}`,
      });
    });

    // Plans
    this.plansCatalog.forEach((p) => {
      docs.push({
        id: `plan-${p.id}`,
        view: 'journeys',
        title: p.title,
        subtitle: p.actors.join(', '),
        content: `${p.summary} ${p.nodes.map((n) => `${n.label} ${n.description}`).join(' ')}`,
        tags: ['plan', 'graph', ...p.actors, ...p.relatedDataTypes],
        url: `#plan-${p.id}`,
      });
    });

    // Data Types
    this.dataTypesCatalog.forEach((d) => {
      docs.push({
        id: `datatype-${d.id}`,
        view: 'datatypes',
        title: `${d.name} (${d.collectionPath})`,
        subtitle: d.domain,
        content: `${d.summary} ${d.fields.map((f) => `${f.name} ${f.description}`).join(' ')}`,
        tags: ['data', 'firestore', d.domain, d.name],
        url: `#datatype-${d.id}`,
      });
    });

    // Flows
    this.flowsCatalog.forEach((f) => {
      docs.push({
        id: `flow-${f.id}`,
        view: 'architecture',
        title: f.title,
        subtitle: f.category,
        content: `${f.summary} ${f.trigger} ${f.steps.map((st) => `${st.action} ${st.payloadDescription}`).join(' ')}`,
        tags: ['architecture', 'flow', f.category, ...f.cloudFunctions],
        url: `#flow-${f.id}`,
      });
    });

    // Patterns
    this.patternsCatalog.forEach((p) => {
      docs.push({
        id: `pattern-${p.id}`,
        view: 'patterns',
        title: p.name,
        subtitle: p.tagline,
        content: `${p.problem} ${p.solution} ${p.consequences}`,
        tags: ['pattern', 'architecture', ...p.relatedDataTypes],
        url: `#pattern-${p.id}`,
      });
    });

    // Stories
    this.storiesCatalog.forEach((st) => {
      docs.push({
        id: `story-${st.id}`,
        view: 'journeys',
        title: st.title,
        subtitle: `${st.area} (${st.status})`,
        content: `${st.role} ${st.capability} ${st.benefit} ${st.scenarios.map((sc) => `${sc.name} ${sc.given} ${sc.when} ${sc.then}`).join(' ')}`,
        tags: ['story', st.area, st.status],
        url: `#story-${st.id}`,
      });
    });

    this.searchIndex.addDocuments(docs);
  }

  readonly searchResults = computed<SearchResultItem[]>(() => {
    const q = this.searchQuery().trim();
    if (!q) return [];
    return this.searchIndex.search(q, 10).map((r) => ({
      id: r.id,
      view: ((r as any)['view'] as DocsViewId) || 'journeys',
      title: (r as any)['title'] || r.id,
      subtitle: (r as any)['subtitle'],
      url: (r as any)['url'] || `#${r.id}`,
    }));
  });

  // Actions
  switchView(view: DocsViewId): void {
    this.currentView.set(view);
    window.location.hash = view;
  }

  selectTaxonomyNode(node: UserTaxonomyNode | string): void {
    if (typeof node === 'string') {
      const found = findTaxonomyNode(node, this.taxonomyTree);
      if (found) this.selectedTaxonomyNode.set(found);
    } else {
      this.selectedTaxonomyNode.set(node);
    }
  }

  selectPlan(planId: string): void {
    this.selectedPlanId.set(planId);
  }

  toggleTheme(): void {
    this.isDarkTheme.update((dark) => {
      const next = !dark;
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
      return next;
    });
  }

  openSearch(): void {
    this.searchOpen.set(true);
  }

  closeSearch(): void {
    this.searchOpen.set(false);
    this.searchQuery.set('');
  }

  getVsCodeLink(file: string, line?: number): string {
    return this.codeResolver.resolveVsCodeUrl(file, line);
  }

  getGitHubLink(file: string, line?: number): string {
    return this.codeResolver.resolveGitHubUrl(file, line);
  }

  async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
