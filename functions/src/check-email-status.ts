/* Pre-auth cloud function: checks an email's status to guide the login flow.
 *
 * This is intentionally callable WITHOUT authentication. It determines:
 * 1. Whether the email has a member record (via the ACL collection).
 * 2. Whether a Firebase Auth account already exists.
 * 3. Whether the email appears to be Google-managed.
 *
 * Security note: this reveals whether an email is in the member database.
 * For a membership organisation this is an acceptable trade-off to provide
 * a much clearer login UX.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import * as dns from 'dns';
import { allowedOrigins } from './common';
import { CheckEmailStatusResult } from './data-model/system';
import { normalizeEmail } from './data-model/email';

export const GOOGLE_EMAIL_DOMAINS = ['gmail.com', 'googlemail.com'];

export const GOOGLE_MX_SUFFIXES = [
  'google.com',
  'googlemail.com',
  'smtp.goog',
];

interface DomainMxCacheEntry {
  isGoogle: boolean;
  expiresAt: number;
}

const domainMxCache = new Map<string, DomainMxCacheEntry>();
export const DOMAIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DNS_TIMEOUT_MS = 1500; // 1.5 seconds

export function clearDomainMxCache(): void {
  domainMxCache.clear();
}

/**
 * Checks whether a domain is powered by Google (e.g. standard @gmail.com or
 * custom Google Workspace with Google MX records).
 */
export async function isGoogleWorkspaceDomain(domain: string, timeoutMs = DNS_TIMEOUT_MS): Promise<boolean> {
  const cleanDomain = domain.trim().toLowerCase();
  if (!cleanDomain) return false;
  if (GOOGLE_EMAIL_DOMAINS.includes(cleanDomain)) return true;

  const now = Date.now();
  const cached = domainMxCache.get(cleanDomain);
  if (cached && cached.expiresAt > now) {
    return cached.isGoogle;
  }

  try {
    const resolvePromise = dns.promises.resolveMx(cleanDomain);
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<dns.MxRecord[]>((_, reject) => {
      timer = setTimeout(() => reject(new Error('DNS lookup timeout')), timeoutMs);
    });

    try {
      const records = await Promise.race([resolvePromise, timeoutPromise]);
      const isGoogle = records.some((r) => {
        const exchange = (r.exchange || '').toLowerCase().trim();
        return GOOGLE_MX_SUFFIXES.some((suffix) =>
          exchange === suffix || exchange.endsWith('.' + suffix)
        );
      });

      domainMxCache.set(cleanDomain, {
        isGoogle,
        expiresAt: now + DOMAIN_CACHE_TTL_MS,
      });
      return isGoogle;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    // If DNS query fails (e.g. NXDOMAIN, timeout, ENODATA), fail safe to false
    logger.warn(`MX resolution failed for domain ${cleanDomain}:`, error);
    return false;
  }
}

// In-memory sliding-window rate limiter per client IP to hinder automated email enumeration
const ipRequests = new Map<string, number[]>();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30;

export function isCheckEmailRateLimited(ip: string, now = Date.now()): boolean {
  if (!ip || ip === 'unknown') return false;
  const timestamps = ipRequests.get(ip) || [];
  const validTimestamps = timestamps.filter((t) => now - t < WINDOW_MS);
  if (validTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    ipRequests.set(ip, validTimestamps);
    return true;
  }
  validTimestamps.push(now);
  ipRequests.set(ip, validTimestamps);
  if (ipRequests.size > 5000) {
    for (const [k, times] of ipRequests.entries()) {
      if (times.every((t) => now - t >= WINDOW_MS)) {
        ipRequests.delete(k);
      }
    }
  }
  return false;
}

export async function checkEmailStatusHandler(
  request: CallableRequest<{ email: string }>,
): Promise<CheckEmailStatusResult> {
  const clientIp = request.rawRequest?.ip || 'unknown';
  if (isCheckEmailRateLimited(clientIp)) {
    logger.warn('checkEmailStatus: rate limit exceeded', { ip: clientIp });
    throw new HttpsError('resource-exhausted', 'Too many requests. Please try again later.');
  }

  const email = normalizeEmail(request.data?.email);
  if (!email) {
    return { hasMemberRecord: false, hasAuthAccount: false, isGoogleManaged: false };
  }

  logger.info('checkEmailStatus called', { email });

  const db = admin.firestore();

  // 1. Check ACL collection for a member record.
  const aclDoc = await db.collection('acl').doc(email).get();
  let hasMemberRecord =
    aclDoc.exists &&
    ((aclDoc.data() as { memberDocIds?: string[] })?.memberDocIds?.length ?? 0) > 0;

  // Fallback: Check members collection directly if not found in ACL
  if (!hasMemberRecord) {
    const rawEmail = request.data?.email?.trim();
    let memberQuery = await db.collection('members')
      .where('emails', 'array-contains', email)
      .limit(1)
      .get();

    if (memberQuery.empty && rawEmail && rawEmail !== email) {
      memberQuery = await db.collection('members')
        .where('emails', 'array-contains', rawEmail)
        .limit(1)
        .get();
    }

    if (!memberQuery.empty) {
      hasMemberRecord = true;
    }
  }

  // 2. Check Firebase Auth for an existing account and providers.
  let hasAuthAccount = false;
  let hasGoogleProvider = false;
  let hasPasswordProvider = false;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    hasAuthAccount = true;
    hasGoogleProvider = userRecord.providerData.some(
      (p) => p.providerId === 'google.com',
    );
    hasPasswordProvider =
      userRecord.providerData.some((p) => p.providerId === 'password') ||
      !!userRecord.passwordHash;
  } catch {
    // User not found in Firebase Auth — expected for new members.
  }

  // 3. Determine if the email is Google-managed (via known domains, Google Workspace MX, or provider).
  const domain = email.split('@')[1] || '';
  const isGoogleDomain = await isGoogleWorkspaceDomain(domain);
  const isGoogleManaged = isGoogleDomain || hasGoogleProvider;

  return {
    hasMemberRecord,
    hasAuthAccount,
    isGoogleManaged,
    hasPasswordProvider,
    hasGoogleProvider,
  };
}

export const checkEmailStatus = onCall<
  { email: string },
  Promise<CheckEmailStatusResult>
>({ cors: allowedOrigins }, async (request) => checkEmailStatusHandler(request));
