/* pipeline-flowchart.component.ts
 *
 * Interactive visual flowchart diagram component for View 4 Information Flows.
 * Renders multi-tier pipeline stages as graphical flowchart cards with protocol arrows,
 * decision gates, and clickable code reference inspection.
 */

import { Component, ChangeDetectionStrategy, Input, signal, inject } from '@angular/core';
import { ArchFlowEntry, FlowStep, FlowTierType } from '../../../../../../docs/lib/src';
import { DocsDataService } from '../../services/docs-data.service';

export type FlowchartViewMode = 'flowchart' | 'stages' | 'mermaid';

@Component({
  selector: 'doc-pipeline-flowchart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pipeline-flowchart.component.html',
  styleUrl: './pipeline-flowchart.component.scss',
})
export class PipelineFlowchartComponent {
  protected docs = inject(DocsDataService);

  @Input({ required: true }) flow!: ArchFlowEntry;

  readonly viewMode = signal<FlowchartViewMode>('flowchart');
  readonly selectedStep = signal<FlowStep | null>(null);
  readonly copiedMermaid = signal<boolean>(false);

  setViewMode(mode: FlowchartViewMode): void {
    this.viewMode.set(mode);
  }

  selectStep(step: FlowStep): void {
    if (this.selectedStep()?.stepNumber === step.stepNumber) {
      this.selectedStep.set(null);
    } else {
      this.selectedStep.set(step);
    }
  }

  closeStepDetails(): void {
    this.selectedStep.set(null);
  }

  inferTier(sourceTier: string): FlowTierType {
    const s = sourceTier.toLowerCase();
    if (s.includes('angular') || s.includes('component') || s.includes('client') || s.includes('searchable')) {
      return 'client';
    }
    if (s.includes('cloud function') || s.includes('handler') || s.includes('trigger') || s.includes('processmail') || s.includes('unsubscribe')) {
      return 'cloud-functions';
    }
    if (s.includes('firestore') || s.includes('database') || s.includes('cache') || s.includes('store')) {
      return 'database';
    }
    if (s.includes('stripe') || s.includes('transcoder') || s.includes('smtp') || s.includes('pub/sub') || s.includes('third-party')) {
      return 'external';
    }
    return 'user';
  }

  getTierIcon(tierType?: FlowTierType, sourceTier?: string): string {
    const tier = tierType || this.inferTier(sourceTier || '');
    switch (tier) {
      case 'client':
        return '📱';
      case 'cloud-functions':
        return '⚡';
      case 'database':
        return '🗄️';
      case 'external':
        return '☁️';
      case 'user':
        return '👤';
      default:
        return '🔄';
    }
  }

  getTierLabel(tierType?: FlowTierType, sourceTier?: string): string {
    const tier = tierType || this.inferTier(sourceTier || '');
    switch (tier) {
      case 'client':
        return 'Client Tier';
      case 'cloud-functions':
        return 'Functions Tier';
      case 'database':
        return 'Database Tier';
      case 'external':
        return 'External Service';
      case 'user':
        return 'User / Actor';
      default:
        return 'System Tier';
    }
  }

  async copyMermaid(): Promise<void> {
    if (!this.flow.mermaidDiagram) return;
    const ok = await this.docs.copyToClipboard(this.flow.mermaidDiagram);
    if (ok) {
      this.copiedMermaid.set(true);
      setTimeout(() => {
        this.copiedMermaid.set(false);
      }, 2000);
    }
  }
}
