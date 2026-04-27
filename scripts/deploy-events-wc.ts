/* deploy-events-wc.ts
 *
 * Deployment script for the Events Viewer web component.
 * Builds the events-viewer-wc project and uploads the output to
 * gs://<CLOUD_BUCKET_NAME_AND_ROOT_PATH>/calendar-viewer/ for serving
 * as a standalone embeddable widget.
 *
 * Usage:
 *   pnpm run deploy:events-wc
 */

import { execSync } from 'child_process';
import { Storage } from '@google-cloud/storage';
import { environment } from '../functions/src/environment/environment';

const bucketRootPath = environment.CLOUD_BUCKET_NAME_AND_ROOT_PATH;

if (!bucketRootPath) {
  console.error('CLOUD_BUCKET_NAME_AND_ROOT_PATH is not defined in environment.ts');
  process.exit(1);
}

const bucketName = bucketRootPath.split('/')[0];
const deployPath = `${bucketRootPath}/calendar-viewer`;
const storage = new Storage();
const bucket = storage.bucket(bucketName);

async function run() {
  try {
    console.log('Building events viewer web component...');
    execSync('pnpm run build:events-wc', { stdio: 'inherit' });

    console.log(`Deploying to gs://${deployPath}...`);
    const deployCommand = `gcloud storage cp -R ./dist/events-viewer-wc/browser/* gs://${deployPath}`;
    execSync(deployCommand, { stdio: 'inherit' });

    console.log('Deployment successful!');

    console.log('Checking and updating CORS configuration...');

    // Set CORS using @google-cloud/storage
    if ('CORS_CONFIG' in environment) {
      console.log('Setting CORS configuration from environment.ts...');
      await bucket.setCorsConfiguration((environment as any).CORS_CONFIG);

      const [metadata] = await bucket.getMetadata();
      console.log(`Updated CORS Configuration for gs://${bucketName}:`);
      console.log(JSON.stringify(metadata.cors, null, 2));
    } else {
      console.log('CORS_CONFIG not found in environment.ts, skipping CORS update.');

      const [metadata] = await bucket.getMetadata();
      if (metadata.cors) {
        console.log(`Current CORS Configuration for gs://${bucketName}:`);
        console.log(JSON.stringify(metadata.cors, null, 2));
      } else {
        console.log(`No CORS Configuration applied to gs://${bucketName}.`);
      }
    }

  } catch (error) {
    console.error('Deployment failed:', error);
    process.exit(1);
  }
}

run();
