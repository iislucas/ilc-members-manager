import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { AppPathPatterns } from '../app.config';
import { MemberDetailsComponent } from '../member-details/member-details';
import { IconComponent } from '../icons/icon.component';
import { initMember, Member } from '../../../functions/src/data-model';

@Component({
  selector: 'app-member-create',
  standalone: true,
  imports: [CommonModule, MemberDetailsComponent, IconComponent],
  templateUrl: './member-create.html',
  styleUrl: './member-create.scss',
})
export class MemberCreateComponent implements OnInit {
  routingService = inject(RoutingService<AppPathPatterns>);
  dataService = inject(DataManagerService);

  basePath = input.required<string>();

  backLabel = computed(() => {
    const path = this.basePath();
    if (path.startsWith('school/')) return 'School Members';
    if (path.startsWith('instructor/')) return 'Students List';
    if (path === 'my-students') return 'My Students';
    return 'Members List';
  });

  newMember = signal<Member>(initMember());

  ngOnInit() {
    window.scrollTo(0, 0);
  }

  goBack() {
    this.routingService.navigateToParts([`/${this.basePath()}`]);
  }
}
