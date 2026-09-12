/* view-user-journeys.component.ts
 *
 * View 2: Users, Key Journeys & Multi-Actor Plans.
 * Houses the interactive D3 User Taxonomy Tree, Journey Starting Points, Plan Graph Viewer,
 * and Taxonomy-Indexed User Stories.
 */

import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { DocsDataService } from '../../services/docs-data.service';
import { UserTaxonomyTreeComponent } from '../../components/user-taxonomy-tree/user-taxonomy-tree.component';
import { PlanGraphViewerComponent } from '../../components/plan-graph-viewer/plan-graph-viewer.component';
import { UserJourneyEntry, UserStoryEntry } from '../../../../../../docs/lib/src';

export type JourneySubTab = 'starting-points' | 'plans' | 'stories' | 'surface-map';

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

  readonly selectedPersona = computed(() => this.docs.selectedTaxonomyNode());

  // Journeys that involve or are initiated by the selected persona
  readonly relevantJourneys = computed<UserJourneyEntry[]>(() => {
    const persona = this.selectedPersona();
    if (!persona) return this.docs.journeysCatalog;

    return this.docs.journeysCatalog.filter((j) => {
      return (
        persona.startingJourneyIds.includes(j.id) ||
        j.primaryActor.toLowerCase().includes(persona.id.toLowerCase()) ||
        j.participatingActors.some((a) => a.toLowerCase().includes(persona.id.toLowerCase()))
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

  setSubTab(tab: JourneySubTab): void {
    this.activeSubTab.set(tab);
  }
}
