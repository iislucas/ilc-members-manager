/* login.ts
 *
 * The standalone login page. The guided sign-in flow itself lives in
 * <app-inline-auth>, which the purchase pages embed too — this component is
 * only the page-level wrapper around it.
 *
 * `showNoMemberOption` is what distinguishes this from the embedded uses: an
 * email with no membership record is a dead end here, so the flow offers
 * "Become a Member" and "create an account without a membership". On the
 * purchase pages that prompt would be circular, since those pages are already
 * where an account gets created.
 */

import { Component } from '@angular/core';
import { InlineAuthComponent } from '../inline-auth/inline-auth.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [InlineAuthComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent {}
