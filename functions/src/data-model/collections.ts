/* collections.ts
 *
 * Enums representing top-level Firestore collections and subcollections.
 * Avoids raw string literals and centralizes database schema paths.
 */

export enum FirestoreCollection {
  Members = 'members',
  Schools = 'schools',
  Instructors = 'instructors',
  Products = 'products',
  Gradings = 'gradings',
  Orders = 'orders',
  Acl = 'acl',
  System = 'system',
  Events = 'events',
  Videos = 'videos',
  VideoGrants = 'video_grants',
  Statistics = 'statistics',
  MembersPost = 'members-post',
  ArticlesPost = 'articles-post',
  NewsPost = 'news-post',
}

export enum FirestoreSubcollection {
  Registrations = 'registrations',
  Events = 'events',
  Orders = 'orders',
  Notifications = 'notifications',
  Uploads = 'uploads',
  VideoProgress = 'videoProgress',
  VideoGrants = 'videoGrants',
  PushSubscriptions = 'pushSubscriptions',
  Gradings = 'gradings',
  Members = 'members',
  Deletions = 'deletions',
  VideoTimeRanges = 'videoTimeRanges',
}
