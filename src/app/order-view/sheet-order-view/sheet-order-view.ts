import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SheetsImportOrder } from '../../../../functions/src/data-model';
import { IconComponent } from '../../icons/icon.component';

@Component({
  selector: 'app-sheet-order-view',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './sheet-order-view.html',
  styleUrl: './sheet-order-view.scss'
})
export class SheetOrderView {
  order = input.required<SheetsImportOrder>();
}
