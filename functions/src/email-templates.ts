// Email template functions using TypeScript template literals.

export interface MembershipEmailParams {
  name?: string;
  memberId?: string;
  email?: string;
}

export interface InstructorEmailParams {
  name?: string;
  memberId?: string;
  instructorId?: string;
  email?: string;
}

// Subject for membership activation email.
export function membershipActivatedSubject(params?: MembershipEmailParams): string {
  return 'Welcome to the I Liq Chuan Family!';
}

// Body for membership activation email.
export function membershipActivatedBody(params?: MembershipEmailParams): string {
  return `Welcome to the I Liq Chuan family! Your membership is now active.

You can now access the [Active Members Area](https://members.iliqchuan.com/#/members-area) to read the blog, view classes, and more.`;
}

// Subject for instructor license activation email.
export function instructorLicenseActivatedSubject(params?: InstructorEmailParams): string {
  return 'Congratulations on your Instructor License!';
}

// Body for instructor license activation email.
export function instructorLicenseActivatedBody(params?: InstructorEmailParams): string {
  const instructorId = params?.instructorId || '';
  return `Congratulations on getting your Instructor ID **${instructorId}**!

Please [update your public instructor profile](https://members.iliqchuan.com/#/myProfile) with a bio, photos, and links, and make sure to review the [Instructor Standard Operating Procedures (SOP)](https://members.iliqchuan.com/#/instructors-area/post/sop) in the Instructors Area.`;
}
