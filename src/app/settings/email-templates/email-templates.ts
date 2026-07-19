import { Component, inject, signal, linkedSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../../data-manager.service';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { EmailTemplates, initEmailTemplates } from '../../../../functions/src/data-model';

@Component({
  selector: 'app-email-templates',
  standalone: true,
  imports: [CommonModule, FormsModule, SpinnerComponent],
  templateUrl: './email-templates.html',
  styleUrl: './email-templates.scss',
})
export class EmailTemplatesComponent {
  dataManager = inject(DataManagerService);

  // Link signal to loaded templates, fall back to default template initial state if not loaded.
  templates = linkedSignal<EmailTemplates>(() =>
    this.dataManager.emailTemplates() || initEmailTemplates()
  );

  isSaving = signal(false);
  statusMessage = signal('');

  async saveTemplates() {
    this.isSaving.set(true);
    this.statusMessage.set('');
    try {
      await this.dataManager.saveEmailTemplates(this.templates());
      this.statusMessage.set('Templates saved successfully.');
    } catch (err: any) {
      this.statusMessage.set(`Error: ${err.message}`);
    } finally {
      this.isSaving.set(false);
    }
  }
}
