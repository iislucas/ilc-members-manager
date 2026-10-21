/*
 * Trust existing verified passwords (one-time migration for email-first sign-in)
 *
 * Password sign-in now requires the `passwordTrusted` custom claim (see
 * functions/src/auth-blocking.ts). This grants it to every account that is
 * ALREADY a verified email/password account, so nobody who signs in with a
 * password today is locked out when the blocking functions are deployed.
 *
 * Unverified accounts are deliberately skipped: their password was chosen
 * before anyone proved the email, possibly by someone else. Their owners sign
 * in with an email link and choose a new password in the app.
 *
 * MUST run before the blocking functions are deployed. Idempotent; existing
 * custom claims are preserved.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/data-migrations/trust-verified-passwords-21-oct-2026.ts [--project <PROJECT_ID>] [--dry-run]
 *
 * Examples:
 *   pnpm exec ts-node scripts/data-migrations/trust-verified-passwords-21-oct-2026.ts --project ilc-paris-class-tracker --dry-run
 *   pnpm exec ts-node scripts/data-migrations/trust-verified-passwords-21-oct-2026.ts --project ilc-paris-class-tracker
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

async function main() {
  const dryRun = argv['dry-run'];
  let total = 0;
  let granted = 0;
  let alreadyTrusted = 0;
  let skippedUnverified = 0;
  let pageToken: string | undefined;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const user of page.users) {
      total++;
      const hasPassword = user.providerData.some((p) => p.providerId === 'password');
      if (!hasPassword) continue;
      if (!user.emailVerified) {
        skippedUnverified++;
        continue;
      }
      if (user.customClaims?.[TRUSTED_PASSWORD_CLAIM] === true) {
        alreadyTrusted++;
        continue;
      }
      granted++;
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
    `already trusted: ${alreadyTrusted}; unverified password accounts skipped: ${skippedUnverified}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
