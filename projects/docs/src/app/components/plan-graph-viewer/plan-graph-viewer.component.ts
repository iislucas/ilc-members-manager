/* plan-graph-viewer.component.ts
 *
 * Interactive visual directed graph viewer for multi-actor collaborative interaction plans.
 * Highlights nodes belonging to the selected user taxonomy node and allows inspecting node data.
 */

import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { DocsDataService } from '../../services/docs-data.service';
import { InteractionPlanEntry, PlanNode, PlanNodeType } from '../../../../../../docs/lib/src';

@Component({
  selector: 'doc-plan-graph-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-graph-viewer.component.html',
  styleUrl: './plan-graph-viewer.component.scss',
})
export class PlanGraphViewerComponent {
  protected docs = inject(DocsDataService);

  readonly selectedNodeDetails = signal<PlanNode | null>(null);

  readonly activePlan = computed<InteractionPlanEntry>(() => {
    const id = this.docs.selectedPlanId();
    return this.docs.plansCatalog.find((p) => p.id === id) || this.docs.plansCatalog[0];
  });

  isNodeBelongingToSelectedActor(node: PlanNode): boolean {
    const selectedActor = this.docs.selectedTaxonomyNode();
    if (!selectedActor || !node.actor) return false;

    // Check direct match
    const actorLower = node.actor.toLowerCase();
    const nameLower = selectedActor.name.toLowerCase();
    const idLower = selectedActor.id.toLowerCase();

    if (idLower === 'grading-candidate' || idLower === 'student-practitioner' || idLower === 'active-member') {
      return actorLower.includes('member') || actorLower.includes('student');
    }
    if (idLower === 'sifu-instructor' || idLower === 'grading-examiner' || idLower === 'apprentice-instructor') {
      return actorLower.includes('instructor') || actorLower.includes('sifu') || actorLower.includes('examiner');
    }
    if (idLower === 'school-manager') {
      return actorLower.includes('school');
    }
    if (idLower === 'event-organizer') {
      return actorLower.includes('event') || actorLower.includes('organizer');
    }
    if (idLower === 'hq-admin') {
      return actorLower.includes('admin') || actorLower.includes('hq');
    }
    if (idLower === 'system-automation') {
      return actorLower.includes('system') || actorLower.includes('trigger');
    }

    return actorLower.includes(nameLower);
  }

  selectNode(node: PlanNode): void {
    this.selectedNodeDetails.set(node);
  }

  getNodeTypeBadgeClass(type: PlanNodeType): string {
    switch (type) {
      case PlanNodeType.ActorAction:
        return 'badge-action';
      case PlanNodeType.SystemTrigger:
        return 'badge-trigger';
      case PlanNodeType.DecisionGate:
        return 'badge-decision';
      case PlanNodeType.StateMilestone:
        return 'badge-milestone';
      default:
        return 'badge-action';
    }
  }
}
