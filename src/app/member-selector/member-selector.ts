import { Component, computed, inject, input, output } from '@angular/core';
import { DataManagerService } from '../data-manager.service';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { IconComponent } from '../icons/icon.component';
import { Member } from '../../../functions/src/data-model';

@Component({
  selector: 'app-member-selector',
  standalone: true,
  imports: [AutocompleteComponent, IconComponent],
  templateUrl: './member-selector.html',
  styleUrl: './member-selector.scss',
})
export class MemberSelectorComponent {
  public dataService = inject(DataManagerService);

  value = input.required<string>();
  valueChange = output<string>();
  memberSelected = output<Member | null>();

  placeholder = input<string>('Search for a member');
  disabled = input<boolean>(false);
  name = input<string>('');

  memberDisplayFns = {
    toChipId: (m: Member) => m.memberId,
    toName: (m: Member) => m.memberId ? `(${m.memberId}) ${m.name}` : m.name,
  };

  selectedMember = computed(() => {
    const val = this.value();
    if (!val) return null;
    return this.dataService.getMemberByMemberId(val) ?? null;
  });

  updateValue(newValue: string) {
    const match = newValue.match(/^\(([^)]+)\)/);
    const rawId = match ? match[1] : newValue.trim();
    const member = this.dataService.getMemberByMemberId(rawId);

    if (member) {
      const formattedName = `(${member.memberId || 'No ID'}) ${member.name}`.trim();
      const exactMatch = rawId === member.memberId || 
                         formattedName === newValue.trim() ||
                         member.memberId === newValue.trim();

      if (exactMatch) {
        this.valueChange.emit(member.memberId);
        this.memberSelected.emit(member);
        return;
      }
    }

    this.valueChange.emit(newValue);
    this.memberSelected.emit(null);
  }
}
