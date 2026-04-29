import { Component, input, model, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';
import { NavigationMenuComponent } from '../navigation-menu/navigation-menu.component';
import { ProfileMenuComponent } from '../profile-menu/profile-menu';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';

export interface Breadcrumb {
  label: string;
  shortLabel?: string;
  url?: string;
  isRoute?: boolean; // If true, treats url as a hash route, or standard href
  isLoading?: boolean;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    NavigationMenuComponent,
    ProfileMenuComponent,
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent {
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  breadcrumbs = input<Breadcrumb[]>([]);
  abbreviateParents = input<boolean>(true);
  isLoggedIn = input<boolean>(false);
  isPublicPage = input<boolean>(false);
  menuOpen = model<boolean>(false);
}
