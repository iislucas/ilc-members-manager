// Email template functions using TypeScript template literals.

// Common base parameters for all email templates, enabling standardized links and footers.
export interface BaseEmailParams {
  name?: string;
  email?: string;
  // App origin with no trailing slash, e.g. 'https://app.iliqchuan.com'.
  appBase?: string;
  // One-click unsubscribe URL.
  unsubscribeUrl?: string;
  // Clear label of the specific notification kind being unsubscribed from.
  unsubscribeKindName?: string;
  // One-click unsubscribe URL for the class/category of emails.
  unsubscribeCategoryUrl?: string;
  // Clear label of the category/class being unsubscribed from.
  unsubscribeCategoryName?: string;
  // One-click unsubscribe URL for all portal emails.
  unsubscribeAllUrl?: string;
  // Link to account notification preferences page.
  preferencesUrl?: string;
}

export interface MembershipEmailParams extends BaseEmailParams {
  memberId?: string;
}

export interface InstructorEmailParams extends BaseEmailParams {
  memberId?: string;
  instructorId?: string;
  // Absolute URL of the Instructors Area post holding the instructor SOP.
  instructorSopUrl?: string;
}

export interface OrderEmailParams extends BaseEmailParams {
  orderNumber?: string;
  orderDate?: string;
  amount?: string;
  currency?: string;
  itemsSummary?: string;
  receiptUrl?: string;
}

export interface EventRegistrationEmailParams extends BaseEmailParams {
  eventTitle?: string;
  eventDates?: string;
  eventLocation?: string;
  attendanceType?: string;
  onlineJoiningLink?: string;
  specialInstructions?: string;
  amount?: string;
  receiptUrl?: string;
}

export interface VodEmailParams extends BaseEmailParams {
  videoTitle?: string;
  videoUrl?: string;
  amount?: string;
  receiptUrl?: string;
}

export interface VodGiftEmailParams extends BaseEmailParams {
  name?: string;
  giverName?: string;
  videoTitle?: string;
  videoUrl?: string;
  giftMessage?: string;
  appBase?: string;
}

export interface GradingEmailParams extends BaseEmailParams {
  memberId?: string;
  gradingLevel?: string;
  gradingEventName?: string;
  gradingDate?: string;
  amount?: string;
  gradingUrl?: string;
}

export interface GradingWorkflowEmailParams extends BaseEmailParams {
  studentName?: string;
  instructorName?: string;
  gradingLevel?: string;
  gradingEventName?: string;
  gradingDate?: string;
  gradingUrl?: string;
  notes?: string;
}

export interface SubscriptionRenewalEmailParams extends BaseEmailParams {
  planName?: string;
  amount?: string;
  renewalDate?: string;
  nextRenewalDate?: string;
  receiptUrl?: string;
}

export interface EventDigestOverallEmailParams extends BaseEmailParams {
  period?: string;
  eventsCount?: string;
  eventsList?: string;
  calendarUrl?: string;
}

export interface EventDigestItemParams {
  eventTitle?: string;
  eventDates?: string;
  eventLocation?: string;
  eventInstructors?: string;
  eventDetailsUrl?: string;
  eventPrice?: string;
  attendanceType?: string;
  eventSummary?: string;
}

/**
 * Standardized email footer helper providing context, clear 3-tier unsubscribe links
 * (specific alert, entire class/category, and all member portal emails),
 * preferences management link, and organization identity.
 */
export function renderEmailFooter(options: {
  reason: string;
  unsubscribeUrl?: string;
  unsubscribeKindName?: string;
  unsubscribeCategoryUrl?: string;
  unsubscribeCategoryName?: string;
  unsubscribeAllUrl?: string;
  preferencesUrl?: string;
  appBase?: string;
}): string {
  const appBase = options.appBase || '{appBase}';
  const unsubscribeUrl = options.unsubscribeUrl || '{unsubscribeUrl}';
  const unsubscribeKindName = options.unsubscribeKindName || '{unsubscribeKindName}';
  const unsubscribeCategoryUrl = options.unsubscribeCategoryUrl || '{unsubscribeCategoryUrl}';
  const unsubscribeCategoryName = options.unsubscribeCategoryName || '{unsubscribeCategoryName}';
  const unsubscribeAllUrl = options.unsubscribeAllUrl || '{unsubscribeAllUrl}';
  const preferencesUrl = options.preferencesUrl || '{preferencesUrl}';

  return `---
*${options.reason}*  
Unsubscribe: [From ${unsubscribeKindName}](${unsubscribeUrl}) • [From ${unsubscribeCategoryName}](${unsubscribeCategoryUrl}) • [From All Portal Emails](${unsubscribeAllUrl})  
[Notification Preferences](${preferencesUrl}) • [I Liq Chuan Association](${appBase})`;
}

// Subject for membership activation email.
export function membershipActivatedSubject(params?: MembershipEmailParams): string {
  return 'Welcome to the I Liq Chuan Family!';
}

// Body for membership activation email.
export function membershipActivatedBody(params?: MembershipEmailParams): string {
  const name = params?.name || '{name}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email because your I Liq Chuan membership was activated.',
    unsubscribeUrl: params?.unsubscribeUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Welcome to Zhong Xin Dao / I Liq Chuan.

Your membership gives you direct access to the global martial arts community and tools to support your training. 

**Your Digital Passbook: The Member Portal** Log in to your member portal to access exclusive resources:

* **Members-Only Content:** View exclusive articles, updates, and training guides.
* **Grading Requests:** Submit requests for grading directly through your account dashboard.
* **Complimentary Live Classes:** Join weekly online classes included with your membership. Look for announcement in Members Area for log in details.
* **Class Library Subscription:** Missed a live session? Subscribe to the Class Library for a nominal fee to access recordings of weekly classes plus hundreds of private training videos. 

**Your Physical Passbook** Along with your digital account, a physical passbook can also be requested to tracks your journey offline. Use it to record your membership details, instructor licenses, and workshop participation.

**Membership & Billing** Membership automatically renew annually, and cancellation is available at any time through your account settings.

Thank you for joining. Student dedication drives this entire community, and support is available every step of the way.

Sincerely,

Chin Family

${footer}`;
}

// Subject for instructor license activation email.
export function instructorLicenseActivatedSubject(params?: InstructorEmailParams): string {
  return 'Congratulations on your Instructor License!';
}

// Body for instructor license activation email.
export function instructorLicenseActivatedBody(params?: InstructorEmailParams): string {
  const name = params?.name || '{name}';
  const instructorId = params?.instructorId || '{instructorId}';
  const appBase = params?.appBase || '{appBase}';
  const sopUrl = params?.instructorSopUrl || '{instructorSopUrl}';
  const footer = renderEmailFooter({
    reason: 'You received this email because your I Liq Chuan instructor license was issued or renewed.',
    unsubscribeUrl: params?.unsubscribeUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Congratulations on getting your Instructor ID **${instructorId}**!

Please [update your public instructor profile](${appBase}/myProfile) with a bio, photos, and links, and make sure to review the [Instructor Standard Operating Procedures (SOP)](${sopUrl}) in the Instructors Area.

${footer}`;
}

// Subject for general order confirmation email.
export function orderConfirmationSubject(params?: OrderEmailParams): string {
  const orderNumber = params?.orderNumber || '{orderNumber}';
  return `Your I Liq Chuan Order Confirmation (${orderNumber})`;
}

// Body for general order confirmation email.
export function orderConfirmationBody(params?: OrderEmailParams): string {
  const name = params?.name || '{name}';
  const orderNumber = params?.orderNumber || '{orderNumber}';
  const orderDate = params?.orderDate || '{orderDate}';
  const itemsSummary = params?.itemsSummary || '{itemsSummary}';
  const amount = params?.amount || '{amount}';
  const currency = params?.currency || '{currency}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email as a receipt for your order with I Liq Chuan.',
    unsubscribeUrl: params?.unsubscribeUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Thank you for your order **${orderNumber}** placed on ${orderDate}.

**Order Summary:**
${itemsSummary}

**Total:** ${amount} ${currency}

You can view your order history and profile details in your [Account](${appBase}/myProfile).

${footer}`;
}

// Subject for event registration confirmation email.
export function eventRegistrationConfirmationSubject(params?: EventRegistrationEmailParams): string {
  const eventTitle = params?.eventTitle || '{eventTitle}';
  return `Registration Confirmed: ${eventTitle}`;
}

// Body for event registration confirmation email.
export function eventRegistrationConfirmationBody(params?: EventRegistrationEmailParams): string {
  const name = params?.name || '{name}';
  const eventTitle = params?.eventTitle || '{eventTitle}';
  const eventDates = params?.eventDates || '{eventDates}';
  const eventLocation = params?.eventLocation || '{eventLocation}';
  const attendanceType = params?.attendanceType || '{attendanceType}';
  const onlineJoiningLink = params?.onlineJoiningLink || '{onlineJoiningLink}';
  const specialInstructions = params?.specialInstructions || '{specialInstructions}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email because you registered for an I Liq Chuan workshop or event.',
    unsubscribeUrl: params?.unsubscribeUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

You are confirmed for **${eventTitle}**!

**Dates:** ${eventDates}
**Location:** ${eventLocation} (${attendanceType})
**Online Joining Link:** ${onlineJoiningLink}

**Instructions:**
${specialInstructions}

You can find complete workshop schedules and resources on the [Events Page](${appBase}/events).

${footer}`;
}

// Subject for VOD purchase confirmation email.
export function vodPurchaseConfirmationSubject(params?: VodEmailParams): string {
  const videoTitle = params?.videoTitle || '{videoTitle}';
  return `Access Granted: ${videoTitle}`;
}

// Body for VOD purchase confirmation email.
export function vodPurchaseConfirmationBody(params?: VodEmailParams): string {
  const name = params?.name || '{name}';
  const videoTitle = params?.videoTitle || '{videoTitle}';
  const videoUrl = params?.videoUrl || '{videoUrl}';
  const amount = params?.amount || '{amount}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email as a confirmation of your Video on Demand purchase.',
    unsubscribeUrl: params?.unsubscribeUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Thank you for purchasing **${videoTitle}** (${amount}).

You have instant access to watch this video in your account:
[Watch Video Now](${videoUrl})

${footer}`;
}

// Subject for VOD gift received email.
export function vodGiftReceivedSubject(params?: VodGiftEmailParams): string {
  const videoTitle = params?.videoTitle || '{videoTitle}';
  const giverName = params?.giverName || '{giverName}';
  return `You received a gift: ${videoTitle} from ${giverName}`;
}

// Body for VOD gift received email.
export function vodGiftReceivedBody(params?: VodGiftEmailParams): string {
  const name = params?.name || '{name}';
  const giverName = params?.giverName || '{giverName}';
  const videoTitle = params?.videoTitle || '{videoTitle}';
  const videoUrl = params?.videoUrl || '{videoUrl}';
  const giftMessage = params?.giftMessage || '{giftMessage}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email because someone gifted you access to an I Liq Chuan video.',
    unsubscribeUrl: params?.unsubscribeUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

**${giverName}** has gifted you access to **${videoTitle}**!

Personal note from ${giverName}:
${giftMessage}

You have instant access to watch this video in your account:
[Watch Video Now](${videoUrl})

${footer}`;
}

// Subject for grading payment confirmation email.
export function gradingPaymentConfirmationSubject(params?: GradingEmailParams): string {
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  return `Grading Assessment Fee Received: ${gradingLevel}`;
}

// Body for grading payment confirmation email.
export function gradingPaymentConfirmationBody(params?: GradingEmailParams): string {
  const name = params?.name || '{name}';
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  const gradingEventName = params?.gradingEventName || '{gradingEventName}';
  const amount = params?.amount || '{amount}';
  const gradingUrl = params?.gradingUrl || '{gradingUrl}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email because a grading assessment fee was paid.',
    unsubscribeUrl: params?.unsubscribeUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Your assessment fee of **${amount}** for **${gradingLevel}** (${gradingEventName}) has been received.

You can review your assessment details and requirements in the [Grading Portal](${gradingUrl}).

${footer}`;
}

// Subject for subscription renewal receipt email.
export function subscriptionRenewalSubject(params?: SubscriptionRenewalEmailParams): string {
  const planName = params?.planName || '{planName}';
  return `Subscription Renewal Receipt: ${planName}`;
}

// Body for subscription renewal receipt email.
export function subscriptionRenewalBody(params?: SubscriptionRenewalEmailParams): string {
  const name = params?.name || '{name}';
  const planName = params?.planName || '{planName}';
  const amount = params?.amount || '{amount}';
  const renewalDate = params?.renewalDate || '{renewalDate}';
  const nextRenewalDate = params?.nextRenewalDate || '{nextRenewalDate}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this recurring billing receipt for your active subscription.',
    unsubscribeUrl: params?.unsubscribeUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Your subscription for **${planName}** renewed successfully on ${renewalDate}.

**Amount Paid:** ${amount}
**Next Scheduled Renewal:** ${nextRenewalDate}

You can review and manage your subscriptions anytime in your [Account Settings](${appBase}/settings?tab=subscriptions).

${footer}`;
}

// Subject for upcoming events digest overall email.
export function eventDigestOverallSubject(params?: EventDigestOverallEmailParams): string {
  const period = params?.period || '{period}';
  return `Upcoming I Liq Chuan Events - ${period}`;
}

// Body for upcoming events digest overall email.
export function eventDigestOverallBody(params?: EventDigestOverallEmailParams): string {
  const name = params?.name || '{name}';
  const period = params?.period || '{period}';
  const eventsList = params?.eventsList || '{eventsList}';
  const calendarUrl = params?.calendarUrl || '{calendarUrl}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: `You received this email because you opted into ${period} event updates.`,
    unsubscribeUrl: params?.unsubscribeUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Here are the upcoming I Liq Chuan workshops and events for **${period}**:

${eventsList}

Browse the complete calendar anytime at the [Events & Workshops Calendar](${calendarUrl}).

${footer}`;
}

// Template for a single event card within the upcoming events digest {eventsList}.
export function eventDigestItemTemplate(params?: EventDigestItemParams): string {
  const eventTitle = params?.eventTitle || '{eventTitle}';
  const eventDetailsUrl = params?.eventDetailsUrl || '{eventDetailsUrl}';
  const eventDates = params?.eventDates || '{eventDates}';
  const eventLocation = params?.eventLocation || '{eventLocation}';
  const attendanceType = params?.attendanceType || '{attendanceType}';
  const eventInstructors = params?.eventInstructors || '{eventInstructors}';
  const eventSummary = params?.eventSummary || '{eventSummary}';

  return `**[${eventTitle}](${eventDetailsUrl})**
Dates: ${eventDates}
Location: ${eventLocation} (${attendanceType})
Instructors: ${eventInstructors}
${eventSummary}

[View Details & Register](${eventDetailsUrl})`;
}

// Subject for grading request received (sent to instructor/manager)
export function gradingRequestReceivedSubject(params?: GradingWorkflowEmailParams): string {
  const studentName = params?.studentName || '{studentName}';
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  return `New Grading Request: ${studentName} - ${gradingLevel}`;
}

// Body for grading request received (sent to instructor/manager)
export function gradingRequestReceivedBody(params?: GradingWorkflowEmailParams): string {
  const name = params?.name || '{name}';
  const studentName = params?.studentName || '{studentName}';
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  const gradingEventName = params?.gradingEventName || '{gradingEventName}';
  const gradingUrl = params?.gradingUrl || '{gradingUrl}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email because a student requested you to assess their grading.',
    unsubscribeUrl: params?.unsubscribeUrl,
    unsubscribeKindName: params?.unsubscribeKindName || 'Grading Requests',
    unsubscribeCategoryUrl: params?.unsubscribeCategoryUrl,
    unsubscribeCategoryName: params?.unsubscribeCategoryName || 'All Grading Notifications',
    unsubscribeAllUrl: params?.unsubscribeAllUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

**${studentName}** has submitted a grading request for **${gradingLevel}** (${gradingEventName}) and requested you to conduct their assessment.

Please review the student's request in the portal to accept or decline:
[Review Grading Request](${gradingUrl})

${footer}`;
}

// Subject for grading request accepted (sent to student/sifu)
export function gradingRequestAcceptedSubject(params?: GradingWorkflowEmailParams): string {
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  return `Grading Request Accepted: ${gradingLevel}`;
}

// Body for grading request accepted (sent to student/sifu)
export function gradingRequestAcceptedBody(params?: GradingWorkflowEmailParams): string {
  const name = params?.name || '{name}';
  const instructorName = params?.instructorName || '{instructorName}';
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  const gradingEventName = params?.gradingEventName || '{gradingEventName}';
  const gradingDate = params?.gradingDate || '{gradingDate}';
  const gradingUrl = params?.gradingUrl || '{gradingUrl}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email because your grading request was accepted.',
    unsubscribeUrl: params?.unsubscribeUrl,
    unsubscribeKindName: params?.unsubscribeKindName || 'Grading Acceptance Notifications',
    unsubscribeCategoryUrl: params?.unsubscribeCategoryUrl,
    unsubscribeCategoryName: params?.unsubscribeCategoryName || 'All Grading Notifications',
    unsubscribeAllUrl: params?.unsubscribeAllUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Your grading request for **${gradingLevel}** has been accepted by **${instructorName}**!

**Event / Location:** ${gradingEventName}
**Grading Date:** ${gradingDate}

You can view your preparation checklist and grading workflow in your account:
[View Grading Portal](${gradingUrl})

${footer}`;
}

// Subject for grading request declined (sent to student)
export function gradingRequestDeclinedSubject(params?: GradingWorkflowEmailParams): string {
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  return `Grading Request Update: ${gradingLevel}`;
}

// Body for grading request declined (sent to student)
export function gradingRequestDeclinedBody(params?: GradingWorkflowEmailParams): string {
  const name = params?.name || '{name}';
  const instructorName = params?.instructorName || '{instructorName}';
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  const notes = params?.notes || '{notes}';
  const gradingUrl = params?.gradingUrl || '{gradingUrl}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email regarding your grading request.',
    unsubscribeUrl: params?.unsubscribeUrl,
    unsubscribeKindName: params?.unsubscribeKindName || 'Grading Request Updates',
    unsubscribeCategoryUrl: params?.unsubscribeCategoryUrl,
    unsubscribeCategoryName: params?.unsubscribeCategoryName || 'All Grading Notifications',
    unsubscribeAllUrl: params?.unsubscribeAllUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Your grading request for **${gradingLevel}** was not accepted at this time by **${instructorName}**.

**Notes from instructor:**
${notes}

You can choose another instructor or update your grading event details anytime in your portal:
[Select Another Instructor](${gradingUrl})

${footer}`;
}

// Subject for grading passed (sent to student/sifu)
export function gradingPassedSubject(params?: GradingWorkflowEmailParams): string {
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  return `Congratulations! You passed your ${gradingLevel} grading!`;
}

// Body for grading passed (sent to student/sifu)
export function gradingPassedBody(params?: GradingWorkflowEmailParams): string {
  const name = params?.name || '{name}';
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  const gradingEventName = params?.gradingEventName || '{gradingEventName}';
  const notes = params?.notes || '{notes}';
  const gradingUrl = params?.gradingUrl || '{gradingUrl}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email because your grading assessment result was recorded.',
    unsubscribeUrl: params?.unsubscribeUrl,
    unsubscribeKindName: params?.unsubscribeKindName || 'Grading Result Notifications',
    unsubscribeCategoryUrl: params?.unsubscribeCategoryUrl,
    unsubscribeCategoryName: params?.unsubscribeCategoryName || 'All Grading Notifications',
    unsubscribeAllUrl: params?.unsubscribeAllUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Congratulations! You have successfully passed your **${gradingLevel}** grading assessment (${gradingEventName})!

Your member profile and curriculum records have been updated to reflect your new achievement.

**Examiner Feedback & Notes:**
${notes}

You can view your updated digital passbook and certificate records in your account:
[View Digital Passbook](${gradingUrl})

${footer}`;
}

// Subject for grading not passed (sent to student)
export function gradingNotPassedSubject(params?: GradingWorkflowEmailParams): string {
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  return `Grading Assessment Feedback: ${gradingLevel}`;
}

// Body for grading not passed (sent to student)
export function gradingNotPassedBody(params?: GradingWorkflowEmailParams): string {
  const name = params?.name || '{name}';
  const gradingLevel = params?.gradingLevel || '{gradingLevel}';
  const gradingEventName = params?.gradingEventName || '{gradingEventName}';
  const notes = params?.notes || '{notes}';
  const gradingUrl = params?.gradingUrl || '{gradingUrl}';
  const appBase = params?.appBase || '{appBase}';
  const footer = renderEmailFooter({
    reason: 'You received this email with examiner feedback from your grading assessment.',
    unsubscribeUrl: params?.unsubscribeUrl,
    unsubscribeKindName: params?.unsubscribeKindName || 'Grading Result Notifications',
    unsubscribeCategoryUrl: params?.unsubscribeCategoryUrl,
    unsubscribeCategoryName: params?.unsubscribeCategoryName || 'All Grading Notifications',
    unsubscribeAllUrl: params?.unsubscribeAllUrl,
    preferencesUrl: params?.preferencesUrl,
    appBase,
  });

  return `Hi ${name},

Thank you for your effort and dedication during your **${gradingLevel}** grading assessment (${gradingEventName}).

Your result for this attempt was recorded as not passed. Continuous cultivation and patience are central to the art.

**Examiner Feedback & Guidance:**
${notes}

A complimentary follow-up grading has been opened in your account so you can prepare and sit for this level again when you feel ready — no headquarters fee is required:
[View Follow-Up Grading](${gradingUrl})

${footer}`;
}

