import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImportMembersComponent } from './import-members/import-members.component';
import { ImportSchoolsComponent } from './import-schools/import-schools.component';
import { ImportOrdersComponent } from './import-orders/import-orders.component';
import { SpinnerComponent } from '../spinner/spinner.component';

type Tab = 'members' | 'schools' | 'orders';

@Component({
  selector: 'app-import-export',
  standalone: true,
  imports: [CommonModule, ImportMembersComponent, ImportSchoolsComponent, ImportOrdersComponent, SpinnerComponent],
  templateUrl: './import-export.html',
  styleUrl: './import-export.scss',
})
export class ImportExportComponent {
  public activeTab = signal<Tab>('members');

  setActiveTab(tab: Tab) {
    this.activeTab.set(tab);
  }
}
