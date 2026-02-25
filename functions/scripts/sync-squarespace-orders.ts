/*
Usage: 

NOTE: GOOGLE_APPLICATION_CREDENTIALS should be set in your environment if not using default credentials.
SQUARESPACE_API_KEY must be set in your environment.

pnpm run sync-squarespace-orders [--project <PROJECT_ID>] [--dry-run] [--force-timestamp <ISO_DATE_STRING>]

*/
import * as admin from 'firebase-admin';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { fetchAndSyncOrders } from '../src/squarespace-orders';

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  const projectIndex = args.indexOf('--project');
  let projectId: string | undefined;
  if (projectIndex !== -1 && args.length > projectIndex + 1) {
    projectId = args[projectIndex + 1];
  } else {
    projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  }

  admin.initializeApp(projectId ? { projectId } : undefined);
  const db = admin.firestore();

  let apiKey = process.env.SQUARESPACE_API_KEY;

  if (!apiKey) {
    if (!projectId) {
      console.error('Error: Cannot fetch SQUARESPACE_API_KEY from Secret Manager because the project ID could not be determined.');
      console.error('Please provide a project ID via --project <PROJECT_ID> or set the SQUARESPACE_API_KEY environment variable.');
      process.exit(1);
    }

    console.log(`SQUARESPACE_API_KEY environment variable not set. Attempting to fetch from Secret Manager for project ${projectId}...`);
    try {
      const client = new SecretManagerServiceClient();
      const name = `projects/${projectId}/secrets/SQUARESPACE_API_KEY/versions/latest`;
      const [version] = await client.accessSecretVersion({ name });
      apiKey = version.payload?.data?.toString();
    } catch (err) {
      console.error('Failed to fetch SQUARESPACE_API_KEY from Secret Manager:', err);
    }
  }

  if (!apiKey || typeof apiKey !== 'string') {
    console.error('Error: Squarespace API key could not be retrieved.');
    process.exit(1);
  }

  const forceTimestampIndex = args.indexOf('--force-timestamp');
  let forceTimestampStr: string | undefined;
  if (forceTimestampIndex !== -1 && args.length > forceTimestampIndex + 1) {
    forceTimestampStr = args[forceTimestampIndex + 1];
  }

  console.log(`Starting Squarespace orders sync...`);
  if (isDryRun) {
    console.log(`*** DRY RUN MODE ***`);
    console.log(`Changes will not be written to Firestore`);
  }

  try {
    await fetchAndSyncOrders(db, apiKey, {
      dryRun: isDryRun,
      forceTimestamp: forceTimestampStr
    });
    console.log('Finished syncing Squarespace orders.');
    process.exit(0);
  } catch (err) {
    console.error('An error occurred during sync:', err);
    process.exit(1);
  }
}

main();
