import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SheetsImportOrder } from '../../../../functions/src/data-model';

@Component({
  selector: 'app-sheet-order-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sheet-order-view.html',
  styleUrl: './sheet-order-view.scss'
})
export class SheetOrderView {
  order = input.required<SheetsImportOrder>();
}
