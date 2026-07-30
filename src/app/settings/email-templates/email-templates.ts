import { Component, inject, signal, linkedSignal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../../data-manager.service';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { MarkdownEditor, EditorChip, MarkdownFeature } from '../../markdown-editor/markdown-editor';
import { EmailTemplates, initEmailTemplates } from '../../../../functions/src/data-model';
import { findUnsupportedEmailMarkdown, SUPPORTED_EMAIL_MARKDOWN } from '../../../../functions/src/email-markdown';

@Component({
  selector: 'app-email-templates',
  standalone: true,
  imports: [CommonModule, FormsModule, SpinnerComponent, MarkdownEditor],
  templateUrl: './email-templates.html',
  styleUrl: './email-templates.scss',
})
export class EmailTemplatesComponent {
  dataManager = inject(DataManagerService);

  // Placeholder tokens each template supports. Shared as the source of truth for
  // both the reference guide and the markdown editor's insertable chips, so the
  // two never drift. These must match the keys the backend substitutes in
  // sendTemplateEmail (functions/src/on-member-update.ts).
  readonly memberChips: EditorChip[] = [
    { token: '{name}' },
    { token: '{memberId}' },
    { token: '{email}' },
    { token: '{appBase}' },
  ];
  readonly instructorChips: EditorChip[] = [
    { token: '{name}' },
    { token: '{memberId}' },
    { token: '{instructorId}' },
    { token: '{email}' },
    { token: '{appBase}' },
    { token: '{instructorSopUrl}' },
  ];

  // The email renderer only understands a subset of Markdown, so the body
  // editors expose just those actions. Kept in lock-step with what
  // markdownToHtml renders (see functions/src/email-markdown.ts).
  readonly bodyFeatures: MarkdownFeature[] = ['bold', 'link'];
  readonly supportedMarkdown = SUPPORTED_EMAIL_MARKDOWN;

  // Link signal to loaded templates, fall back to default template initial state if not loaded.
  templates = linkedSignal<EmailTemplates>(() =>
    this.dataManager.emailTemplates() || initEmailTemplates()
  );

  // Markdown constructs in each body that the email renderer can't handle and
  // would leak into the email as literal text. Empty when the body is clean.
  memberBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().membershipActivatedBody || '')
  );
  instructorBodyWarnings = computed(() =>
    findUnsupportedEmailMarkdown(this.templates().instructorLicenseActivatedBody || '')
  );

  isSaving = signal(false);
  statusMessage = signal('');

  // The markdown editor emits its full markdown on every change; write it back
  // into the templates model without disturbing the other fields.
  setMemberBody(markdown: string) {
    this.templates.update((t) => ({ ...t, membershipActivatedBody: markdown }));
  }

  setInstructorBody(markdown: string) {
    this.templates.update((t) => ({ ...t, instructorLicenseActivatedBody: markdown }));
  }

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
