import { Injectable, inject } from '@angular/core';
import { Member } from '../../functions/src/data-model';
import { FirebaseStateService } from './firebase-state.service';
import { RoutingService } from './routing.service';
import { AppPathPatterns, Views } from './app.config';

/**
 * Builds a link to a member's profile that is appropriate for — and only
 * present for — the current viewer. Each audience reaches a member through a
 * different, permission-scoped page, so the route depends on the relationship:
 *
 *   - admins                          → the member management view
 *   - the member's primary instructor → their "my students" student view
 *   - an owner/manager of the member's primary school → the school member view
 *
 * Returns null when the viewer has no permitted view of the member (e.g. a
 * grading instructor who isn't the student's sifu, or the student themselves).
 * Factored out here because the same "who can see whom, and where" logic is
 * needed in several places across the app.
 */
@Injectable({ providedIn: 'root' })
export class MemberProfileLinkService {
  private firebaseState = inject(FirebaseStateService);
  private routing = inject(RoutingService<AppPathPatterns>);

  profileLink(member: Member | undefined | null): string | null {
    const user = this.firebaseState.user();
    if (!user || !member) return null;
    // The member-view routes accept the human memberId, falling back to the
    // Firestore doc ID (the views resolve either).
    const memberId = member.memberId || member.docId;
    if (!memberId) return null;

    if (user.isAdmin) {
      return this.routing.hrefForView(Views.ManageMemberView, { memberId });
    }
    if (
      user.member.instructorId &&
      member.primaryInstructorId === user.member.instructorId
    ) {
      return this.routing.hrefForView(Views.MyStudentView, { memberId });
    }
    if (member.primarySchoolId && user.schoolsManaged.includes(member.primarySchoolId)) {
      return this.routing.hrefForView(Views.SchoolMemberView, {
        schoolId: member.primarySchoolId,
        memberId,
      });
    }
    return null;
  }
}
