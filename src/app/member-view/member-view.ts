import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { AppPathPatterns } from '../app.config';
import { MemberEditComponent } from '../member-edit/member-edit';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-member-view',
  standalone: true,
  imports: [CommonModule, MemberEditComponent, IconComponent],
  templateUrl: './member-view.html',
  styleUrl: './member-view.scss',
})
export class MemberViewComponent {
  routingService = inject(RoutingService<AppPathPatterns>);
  dataService = inject(DataManagerService);

  memberId = input.required<string>();
  basePath = input.required<string>();
  backLabel = input.required<string>();

  member = computed(() => {
    return this.dataService.members.get(this.memberId());
  });

  goBack() {
    this.routingService.navigateToParts([`/${this.basePath()}?jumpTo=${this.memberId()}`]);
  }
}
