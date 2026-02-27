import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SquareSpaceOrder } from '../../../../functions/src/data-model';

@Component({
  selector: 'app-squarespace-order-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './squarespace-order-view.html',
  styleUrl: './squarespace-order-view.scss'
})
export class SquarespaceOrderView {
  order = input.required<SquareSpaceOrder>();
}
