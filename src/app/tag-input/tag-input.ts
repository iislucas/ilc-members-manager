/* tag-input.ts
 *
 * Standalone reusable TagInputComponent combining autocomplete suggestions,
 * an inline '+' adder button, Enter key handling, and interactive tag chips.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  model,
  output,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { DataManagerService } from '../data-manager.service';
import { IconComponent } from '../icons/icon.component';
import { TagItem } from '../../../functions/src/data-model';

@Component({
  selector: 'app-tag-input',
  standalone: true,
  imports: [CommonModule, AutocompleteComponent, IconComponent],
  templateUrl: './tag-input.html',
  styleUrl: './tag-input.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagInputComponent {
  public dataService = inject(DataManagerService);

  // Two-way model for tags array
  tags = model<string[]>([]);

  placeholder = input<string>('Add a tag (type #tag)...');
  disabled = input<boolean>(false);

  tagAdded = output<string>();
  tagRemoved = output<string>();

  // Current text inside the autocomplete input
  inputText = signal('');

  // Autocomplete display helper
  tagDisplayFns: DisplayFns<TagItem> = {
    toChipId: (t) => t.tag,
    toName: (t) => (t.description ? `#${t.tag} (${t.description})` : '#' + t.tag),
  };

  canAddCurrentText = computed(() => {
    const raw = this.inputText().trim().replace(/^#+/, '').trim().toLowerCase();
    return raw.length > 0 && !this.tags().includes(raw);
  });

  getTagTooltip(tag: string): string {
    const meta = this.dataService.getTagMeta(tag);
    if (meta?.description) {
      return `#${tag}: ${meta.description}`;
    }
    return `#${tag}`;
  }

  onTextUpdated(text: string) {
    this.inputText.set(text);
  }

  onTagSelected(item: TagItem) {
    this.addTag(item.tag);
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.addCurrentText();
    }
  }

  addCurrentText() {
    const raw = this.inputText().trim();
    if (!raw) return;
    this.addTag(raw);
  }

  addTag(rawTag: string) {
    const clean = rawTag.trim().replace(/^#+/, '').trim().toLowerCase();
    if (!clean) return;

    const current = this.tags();
    if (!current.includes(clean)) {
      const updated = [...current, clean];
      this.tags.set(updated);
      this.tagAdded.emit(clean);
      // Persist to system video tags if not already present
      void this.dataService.saveSystemTags([clean]);
    }

    this.inputText.set('');
  }

  removeTag(tagToRemove: string) {
    if (this.disabled()) return;
    const current = this.tags();
    const updated = current.filter((t) => t !== tagToRemove);
    this.tags.set(updated);
    this.tagRemoved.emit(tagToRemove);
  }
}
