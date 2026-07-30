// Email template functions using TypeScript template literals.

// Links in email must be absolute, so every body that links back into the app
// takes the app's origin as a parameter rather than hardcoding a host. The
// caller supplies the real values from environment.links (sendTemplateEmail);
// initEmailTemplates passes the `{token}` form instead, so the editable
// template defaults shown in Settings keep the placeholders visible.
export interface MembershipEmailParams {
  name?: string;
  memberId?: string;
  email?: string;
  // App origin with no trailing slash, e.g. 'https://app.iliqchuan.com'.
  appBase?: string;
}

export interface InstructorEmailParams {
  name?: string;
  memberId?: string;
  instructorId?: string;
  email?: string;
  // App origin with no trailing slash, e.g. 'https://app.iliqchuan.com'.
  appBase?: string;
  // Absolute URL of the Instructors Area post holding the instructor SOP.
  instructorSopUrl?: string;
}

// Subject for membership activation email.
export function membershipActivatedSubject(params?: MembershipEmailParams): string {
  return 'Welcome to the I Liq Chuan Family!';
}

// Body for membership activation email.
export function membershipActivatedBody(params?: MembershipEmailParams): string {
  const appBase = params?.appBase || '';
  return `Welcome to the I Liq Chuan family! Your membership is now active.

You can now access the [Active Members Area](${appBase}/members-area) to read the blog, view classes, and more.`;
}

// Subject for instructor license activation email.
export function instructorLicenseActivatedSubject(params?: InstructorEmailParams): string {
  return 'Congratulations on your Instructor License!';
}

// Body for instructor license activation email.
export function instructorLicenseActivatedBody(params?: InstructorEmailParams): string {
  const instructorId = params?.instructorId || '';
  const appBase = params?.appBase || '';
  const sopUrl = params?.instructorSopUrl || '';
  return `Congratulations on getting your Instructor ID **${instructorId}**!

Please [update your public instructor profile](${appBase}/myProfile) with a bio, photos, and links, and make sure to review the [Instructor Standard Operating Procedures (SOP)](${sopUrl}) in the Instructors Area.`;
}
