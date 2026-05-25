import { Component, computed, inject, input, output } from '@angular/core';
import { DataManagerService } from '../data-manager.service';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { IconComponent } from '../icons/icon.component';
import { InstructorPublicData } from '../../../functions/src/data-model';

@Component({
  selector: 'app-instructor-selector',
  standalone: true,
  imports: [AutocompleteComponent, IconComponent],
  templateUrl: './instructor-selector.html',
  styleUrl: './instructor-selector.scss',
})
export class InstructorSelectorComponent {
  public dataService = inject(DataManagerService);

  value = input.required<string>();
  valueChange = output<string>();
  instructorSelected = output<InstructorPublicData | null>();

  placeholder = input<string>('Search for an instructor');
  disabled = input<boolean>(false);
  name = input<string>('');

  instructorDisplayFns = {
    toChipId: (i: InstructorPublicData) => i.instructorId,
    toName: (i: InstructorPublicData) => i.instructorId ? `${i.name} [${i.instructorId}]` : i.name,
  };

  selectedInstructor = computed(() => {
    const val = this.value();
    if (!val) return null;
    return this.dataService.instructors.get(val) ?? null;
  });

  updateValue(newValue: string) {
    const match = newValue.match(/\[([^\]]+)\]$/);
    const rawId = match ? match[1] : newValue.trim();
    const inst = this.dataService.instructors.get(rawId);

    if (inst) {
      const formattedName = `${inst.name} [${inst.instructorId}]`.trim();
      const exactMatch = rawId === inst.instructorId || 
                         formattedName === newValue.trim() ||
                         inst.instructorId === newValue.trim();

      if (exactMatch) {
        this.valueChange.emit(inst.instructorId);
        this.instructorSelected.emit(inst);
        return;
      }
    }

    this.valueChange.emit(newValue);
    this.instructorSelected.emit(null);
  }
}
