/* view-user-journeys.component.ts
 *
 * View 2: Users, Key Journeys & Multi-Actor Plans.
 * Houses the interactive D3 User Taxonomy Tree, Journey Starting Points, Plan Graph Viewer,
 * and Taxonomy-Indexed User Stories.
 */

import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { DocsDataService } from '../../services/docs-data.service';
import { UserTaxonomyTreeComponent } from '../../components/user-taxonomy-tree/user-taxonomy-tree.component';
import { PlanGraphViewerComponent } from '../../components/plan-graph-viewer/plan-graph-viewer.component';
import {
  UserJourneyEntry,
  UserStoryEntry,
  StepHandoff,
  PermissionEntry,
  findPermission,
} from '../../../../../../docs/lib/src';

export type JourneySubTab =
  | 'starting-points'
  | 'taxonomy-tree'
  | 'plans'
  | 'stories'
  | 'surface-map'
  | 'permissions';

@Component({
  selector: 'doc-view-user-journeys',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UserTaxonomyTreeComponent, PlanGraphViewerComponent],
  templateUrl: './view-user-journeys.component.html',
  styleUrl: './view-user-journeys.component.scss',
})
export class ViewUserJourneysComponent {
  protected docs = inject(DocsDataService);

  readonly activeSubTab = signal<JourneySubTab>('starting-points');
  readonly storyFilterTaxonomyId = signal<string>('all');
  readonly surfaceRoleFilter = signal<string>('all');
  readonly expandedPersonaId = signal<string | null>('grading-candidate');

  // Permission Glossary state
  readonly activePermissionModal = signal<PermissionEntry | null>(null);
  readonly permissionSearchQuery = signal<string>('');
  readonly permissionCategoryFilter = signal<string>('all');
  readonly permissionAccessTypeFilter = signal<string>('all');

  readonly selectedPersona = computed(() => this.docs.selectedTaxonomyNode());

  constructor() {
    // When a permission highlight is triggered from another view, automatically switch to permissions sub-tab
    effect(() => {
      const permId = this.docs.activeHighlightedPermissionId();
      if (permId) {
        this.activeSubTab.set('permissions');
      }
    });
  }

  // Journeys that involve, are owned by, or have handoffs with the selected persona
  readonly relevantJourneys = computed<UserJourneyEntry[]>(() => {
    const persona = this.selectedPersona();
    if (!persona) return this.docs.journeysCatalog;

    const owned = persona.ownedJourneyIds || [];
    const part = persona.participatingJourneyIds || [];
    const start = persona.startingJourneyIds || [];

    return this.docs.journeysCatalog.filter((j) => {
      return (
        owned.includes(j.id) ||
        part.includes(j.id) ||
        start.includes(j.id) ||
        j.primaryTaxonomyNodeId === persona.id ||
        j.participatingTaxonomyNodeIds?.includes(persona.id) ||
        j.primaryActor.toLowerCase().includes(persona.id.toLowerCase()) ||
        j.participatingActors.some((a) => a.toLowerCase().includes(persona.id.toLowerCase())) ||
        j.steps.some(
          (s) =>
            s.actorTaxonomyId === persona.id ||
            s.handoff?.targetTaxonomyId === persona.id ||
            s.receivedFrom?.targetTaxonomyId === persona.id
        )
      );
    });
  });

  // User stories indexed by taxonomy
  readonly filteredStories = computed<UserStoryEntry[]>(() => {
    const filter = this.storyFilterTaxonomyId();
    if (filter === 'all') {
      const persona = this.selectedPersona();
      if (persona?.id && persona.storyIds.length > 0) {
        return this.docs.storiesCatalog.filter(
          (s) => s.taxonomyNodeId === persona.id || persona.storyIds.includes(s.id)
        );
      }
      return this.docs.storiesCatalog;
    }
    return this.docs.storiesCatalog.filter((s) => s.taxonomyNodeId === filter);
  });

  // Filtered Site Surface Map
  readonly filteredSurfaceMap = computed(() => {
    const filter = this.surfaceRoleFilter().toLowerCase();
    if (filter === 'all') return this.docs.surfaceMap;
    return this.docs.surfaceMap.filter((item) =>
      item.permittedRoles.some((a) => (a as string).toLowerCase().includes(filter))
    );
  });

  // Unique categories of permissions for filter dropdown
  readonly permissionCategories = computed<string[]>(() => {
    const set = new Set<string>();
    this.docs.permissionsCatalog.forEach((p) => set.add(p.category));
    return Array.from(set).sort();
  });

  // Filtered Permissions for Glossary
  readonly filteredPermissions = computed<PermissionEntry[]>(() => {
    const q = this.permissionSearchQuery().toLowerCase().trim();
    const cat = this.permissionCategoryFilter();
    const access = this.permissionAccessTypeFilter();

    return this.docs.permissionsCatalog.filter((p) => {
      if (cat !== 'all' && p.category !== cat) return false;
      if (access !== 'all' && p.accessType !== access) return false;
      if (!q) return true;
      return (
        p.id.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.securityRulesMechanism.toLowerCase().includes(q) ||
        p.targetDataTypes.some((dt) => dt.toLowerCase().includes(q)) ||
        p.grantedPersonas.some((gp) => gp.toLowerCase().includes(q))
      );
    });
  });

  setSubTab(tab: JourneySubTab): void {
    this.activeSubTab.set(tab);
  }

  togglePersonaAccordion(personaId: string): void {
    this.expandedPersonaId.update((curr) => (curr === personaId ? null : personaId));
  }

  navigateToHandoff(handoff: StepHandoff): void {
    this.activeSubTab.set('starting-points');
    this.docs.navigateToUserJourneyStep(
      handoff.targetTaxonomyId,
      handoff.targetJourneyId,
      handoff.targetStepNumber
    );
  }

  openPermissionsGlossary(): void {
    this.activeSubTab.set('permissions');
    setTimeout(() => {
      const el = document.getElementById('permissionsGlossary');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  }

  selectPermission(permId: string): void {
    const found = findPermission(permId) || this.docs.permissionsCatalog.find((p) => p.id === permId);
    if (found) {
      this.activePermissionModal.set(found);
    }
  }

  closePermissionModal(): void {
    this.activePermissionModal.set(null);
  }

  viewPermissionInGlossary(permId: string): void {
    this.closePermissionModal();
    this.activeSubTab.set('permissions');
    this.docs.navigateToPermission(permId);
  }
}
