import { execSync } from 'child_process';
import { Storage } from '@google-cloud/storage';
import { environment } from '../functions/src/environment/environment';

const bucketPath = environment.CLOUD_BUCKET_NAME_AND_PATH;

if (!bucketPath) {
  console.error('CLOUD_BUCKET_NAME_AND_PATH is not defined in environment.ts');
  process.exit(1);
}

const bucketNameMatch = bucketPath.split('/')[0];
const storage = new Storage();
const bucket = storage.bucket(bucketNameMatch);

async function run() {
  try {
    console.log('Building web component...');
    execSync('pnpm run build:wc', { stdio: 'inherit' });

    console.log(`Deploying to gs://${bucketPath}...`);
    const deployCommand = `gcloud storage cp -R ./dist/find-an-instructor-wc/browser/* gs://${bucketPath}`;
    execSync(deployCommand, { stdio: 'inherit' });

    console.log('Deployment successful!');

    console.log('Checking and updating CORS configuration...');

    // Set CORS using @google-cloud/storage
    if ('CORS_CONFIG' in environment) {
      console.log('Setting CORS configuration from environment.ts...');
      await bucket.setCorsConfiguration((environment as any).CORS_CONFIG);

      const [metadata] = await bucket.getMetadata();
      console.log(`Updated CORS Configuration for gs://${bucketNameMatch}:`);
      console.log(JSON.stringify(metadata.cors, null, 2));
    } else {
      console.log('CORS_CONFIG not found in environment.ts, skipping CORS update.');

      const [metadata] = await bucket.getMetadata();
      if (metadata.cors) {
        console.log(`Current CORS Configuration for gs://${bucketNameMatch}:`);
        console.log(JSON.stringify(metadata.cors, null, 2));
      } else {
        console.log(`No CORS Configuration applied to gs://${bucketNameMatch}.`);
      }
    }

  } catch (error) {
    console.error('Deployment failed:', error);
    process.exit(1);
  }
}

run();
