import { Component } from '@angular/core';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-unauthorized',
  standalone: true,
  imports: [],
  templateUrl: './unauthorized.html',
  styleUrl: './unauthorized.scss',
})
export class UnauthorizedComponent {
  adminEmail = environment.adminEmail;
}
