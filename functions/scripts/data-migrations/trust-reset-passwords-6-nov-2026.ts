/*
 * Trust passwords reset via Firebase's hosted reset flow (one-time repair, 6 Nov 2026)
 *
 * Between 21 Oct 2026 and 6 Nov 2026, clicking "Forgotten your password?" in the
 * portal called Firebase's client `sendPasswordResetEmail()`, whose hosted reset
 * page updated `passwordHash` and set `emailVerified = true` without granting the
 * `passwordTrusted` custom claim required by `beforeSignInHandler`.
 *
 * This script grants `passwordTrusted: true` ONLY to accounts that:
 *   1. Have `emailVerified === true`
 *   2. Actually have a `passwordHash` in `listUsers()` (excludes passwordless email-link accounts)
 *   3. Do not yet have `customClaims.passwordTrusted === true`
 *   4. Have `tokensValidAfterTime > metadata.creationTime`, proving the password was
 *      changed/reset after account creation (and is not an untouched pre-verification
 *      sign-up password).
 *
 * Idempotent; existing custom claims are preserved.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/data-migrations/trust-reset-passwords-6-nov-2026.ts [--project <PROJECT_ID>] [--dry-run]
 *
 * Examples:
 *   pnpm exec ts-node scripts/data-migrations/trust-reset-passwords-6-nov-2026.ts --project ilc-paris-class-tracker --dry-run
 *   pnpm exec ts-node scripts/data-migrations/trust-reset-passwords-6-nov-2026.ts --project ilc-paris-class-tracker
 */
import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { TRUSTED_PASSWORD_CLAIM } from '../../src/data-model/auth';

const argv = yargs(hideBin(process.argv))
  .option('project', { type: 'string', description: 'Firebase Project ID' })
  .option('dry-run', { type: 'boolean', default: false, describe: 'Preview without writing' })
  .parseSync();

const projectId = argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
admin.initializeApp(projectId ? { projectId } : undefined);

async function main(): Promise<void> {
  const dryRun = argv['dry-run'];
  let total = 0;
  let granted = 0;
  let alreadyTrusted = 0;
  let skippedEmailLinkOnly = 0;
  let skippedUnverified = 0;
  let skippedPreVerificationPassword = 0;
  let pageToken: string | undefined;

  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const user of page.users) {
      total++;
      if (!user.passwordHash) {
        if (user.providerData.some((p) => p.providerId === 'password')) {
          skippedEmailLinkOnly++;
        }
        continue;
      }
      if (!user.emailVerified) {
        skippedUnverified++;
        continue;
      }
      if (user.customClaims?.[TRUSTED_PASSWORD_CLAIM] === true) {
        alreadyTrusted++;
        continue;
      }
      const createdMs = user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : NaN;
      const tokensValidAfterMs = user.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) : NaN;
      if (!Number.isFinite(createdMs) || !Number.isFinite(tokensValidAfterMs) || tokensValidAfterMs <= createdMs) {
        skippedPreVerificationPassword++;
        console.log(
          `[SKIP untrusted initial password] ${user.email || user.uid} (created=${user.metadata.creationTime}, tokensValidAfter=${user.tokensValidAfterTime})`,
        );
        continue;
      }

      granted++;
      console.log(
        `${dryRun ? '[DRY RUN] Would grant' : 'Granting'} ${TRUSTED_PASSWORD_CLAIM} to ${user.email || user.uid} ` +
        `(uid=${user.uid}, created=${user.metadata.creationTime}, reset=${user.tokensValidAfterTime})`,
      );
      if (!dryRun) {
        await admin.auth().setCustomUserClaims(user.uid, {
          ...(user.customClaims || {}),
          [TRUSTED_PASSWORD_CLAIM]: true,
        });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(
    `${dryRun ? '[DRY RUN] ' : ''}users: ${total}; ` +
    `${dryRun ? 'would grant' : 'granted'} ${TRUSTED_PASSWORD_CLAIM}: ${granted}; ` +
    `already trusted: ${alreadyTrusted}; ` +
    `email-link-only skipped: ${skippedEmailLinkOnly}; ` +
    `unverified skipped: ${skippedUnverified}; ` +
    `pre-verification password skipped: ${skippedPreVerificationPassword}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
