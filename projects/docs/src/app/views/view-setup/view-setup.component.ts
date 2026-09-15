import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { DocsDataService } from '../../services/docs-data.service';

@Component({
  selector: 'doc-view-setup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './view-setup.component.html',
  styleUrl: './view-setup.component.scss',
})
export class ViewSetupComponent {
  protected docs = inject(DocsDataService);

  readonly copiedCommandIndex = signal<string | null>(null);

  async copyCommand(cmd: string, id: string): Promise<void> {
    const ok = await this.docs.copyToClipboard(cmd);
    if (ok) {
      this.copiedCommandIndex.set(id);
      setTimeout(() => {
        this.copiedCommandIndex.set(null);
      }, 2000);
    }
  }
}
