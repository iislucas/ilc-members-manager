import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { DocsDataService } from '../../services/docs-data.service';
import { PipelineFlowchartComponent } from '../../components/pipeline-flowchart/pipeline-flowchart.component';

@Component({
  selector: 'doc-view-architecture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PipelineFlowchartComponent],
  templateUrl: './view-architecture.component.html',
  styleUrl: './view-architecture.component.scss',
})
export class ViewArchitectureComponent {
  protected docs = inject(DocsDataService);

  readonly copiedFlowId = signal<string | null>(null);

  async copyDiagram(diagram: string, id: string): Promise<void> {
    const ok = await this.docs.copyToClipboard(diagram);
    if (ok) {
      this.copiedFlowId.set(id);
      setTimeout(() => {
        this.copiedFlowId.set(null);
      }, 2000);
    }
  }
}
