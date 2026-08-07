import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoutingService } from '../routing.service';
import { DataManagerService } from '../data-manager.service';
import { AppPathPatterns } from '../app.config';
import { MemberDetailsComponent } from '../member-details/member-details';
import { BackLinkComponent } from '../back-link/back-link';
import { NavigationTreeService } from '../navigation-tree';
import { initMember, Member } from '../../../functions/src/data-model';

@Component({
  selector: 'app-member-create',
  standalone: true,
  imports: [CommonModule, MemberDetailsComponent, BackLinkComponent],
  templateUrl: './member-create.html',
  styleUrl: './member-create.scss',
})
export class MemberCreateComponent implements OnInit {
  routingService = inject(RoutingService<AppPathPatterns>);
  dataService = inject(DataManagerService);
  private navTree = inject(NavigationTreeService);

  basePath = input.required<string>();

  newMember = signal<Member>(initMember());

  ngOnInit() {
    window.scrollTo(0, 0);
  }

  goBack() {
    this.routingService.navigateTo(
      this.navTree.parent()?.url ?? `/${this.basePath()}`,
    );
  }
}
