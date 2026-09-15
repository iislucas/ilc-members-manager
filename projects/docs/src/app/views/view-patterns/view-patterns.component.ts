import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { DocsDataService } from '../../services/docs-data.service';

@Component({
  selector: 'doc-view-patterns',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './view-patterns.component.html',
  styleUrl: './view-patterns.component.scss',
})
export class ViewPatternsComponent {
  protected docs = inject(DocsDataService);
}
