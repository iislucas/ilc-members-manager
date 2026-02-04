/*
Usage: 

NOTE: GOOGLE_APPLICATION_CREDENTIALS should be set in your environment if not using default credentials.

pnpm exec ts-node functions/scripts/admin.ts set ${EMAIL_ADDRESS}

*/

import * as firebase from 'firebase-admin';
import { UserRecord } from 'firebase-admin/auth';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs';

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    demandOption: false,
  })
  .help(false) // We handle help later with yargs command setup
  .parseSync();

const projectId = (argv as any).project || process.env.GCLOUD_PROJECT;

// Initialize Firebase Admin SDK
const app = firebase.initializeApp({
  projectId,
});
const auth = firebase.auth();

async function setAdmin(email: string) {
  try {
    let user: UserRecord;
    try {
      user = await auth.getUserByEmail(email);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        console.log(`User with email ${email} not found. Creating a new user.`);
        user = await auth.createUser({
          email: email,
          emailVerified: true, // You might want to adjust this
        });
        console.log(`Successfully created new user: ${user.uid}`);
      } else {
        throw error; // Re-throw other errors
      }
    }

    await auth.setCustomUserClaims(user.uid, { admin: true });
    console.log(`Successfully set admin privileges for ${email}`);
  } catch (error) {
    console.error(`Error setting admin privileges for ${email}:`, error);
    if ((error as any).code === 'auth/configuration-not-found') {
      console.error(
        '\nFirebase authentication credentials not found. Please ensure you have set the GOOGLE_APPLICATION_CREDENTIALS environment variable or are logged in with `gcloud auth application-default login`.',
      );
    }
    process.exit(1);
  }
}

async function unsetAdmin(email: string) {
  try {
    const user = await auth.getUserByEmail(email);
    await auth.setCustomUserClaims(user.uid, null);
    console.log(`Successfully removed admin privileges from ${email}`);
  } catch (error) {
    console.error(`Error removing admin privileges from ${email}:`, error);
    process.exit(1);
  }
}

async function listAdmins() {
  try {
    const listUsersResult = await auth.listUsers();
    console.log('Admin users:');
    for (const user of listUsersResult.users) {
      if (user.customClaims?.['admin']) {
        console.log(`- ${user.email} (${user.uid})`);
      }
    }
  } catch (error) {
    console.error('Error listing admin users:', error);
    process.exit(1);
  }
}

async function checkAdminStatus(email: string) {
  try {
    const user = await auth.getUserByEmail(email);
    if (user.customClaims?.['admin']) {
      console.log(`${email} is an admin.`);
    } else {
      console.log(`${email} is not an admin.`);
    }
  } catch (error) {
    console.error(`Error checking admin status for ${email}:`, error);
    process.exit(1);
  }
}

async function main() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const creds = JSON.parse(
        fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'),
      );
      console.log(`Running admin script for project: ${creds.project_id}`);
    } catch (e) {
      console.log('Could not read project ID from credentials file.');
    }
  } else {
    console.log(
      'GOOGLE_APPLICATION_CREDENTIALS not set, depending on application default credentials',
    );
  }

  console.log(`GCLOUD_PROJECT: ${process.env.GCLOUD_PROJECT}`);

  console.log(
    `app.appCheck().app.options.projectId;: ${
      app.appCheck().app.options.projectId
    }`,
  );

  // const projectConfig = await auth.projectConfigManager().getProjectConfig();
  console.log(`Running command for project: ${auth.app.options.projectId}`);
  console.log(
    `Running command for remote project: ${
      app.remoteConfig().app.options.projectId
    }`,
  );

  yargs(hideBin(process.argv))
    .command(
      'set <email>',
      'Set a user as an admin',
      (yargs) => {
        return yargs.positional('email', {
          describe: 'Email of the user to make an admin',
          type: 'string',
          demandOption: true,
        });
      },
      async (argv) => {
        if (argv.email) {
          await setAdmin(argv.email);
        }
      },
    )
    .command(
      'unset <email>',
      'Remove admin privileges from a user',
      (yargs) => {
        return yargs.positional('email', {
          describe: 'Email of the user to remove admin privileges from',
          type: 'string',
          demandOption: true,
        });
      },
      async (argv) => {
        if (argv.email) {
          await unsetAdmin(argv.email);
        }
      },
    )
    .command('list', 'List all admin users', async () => {
      await listAdmins();
    })
    .command(
      'status <email>',
      'Check if a user is an admin',
      (yargs) => {
        return yargs.positional('email', {
          describe: 'Email of the user to check',
          type: 'string',
          demandOption: true,
        });
      },
      async (argv) => {
        if (argv.email) {
          await checkAdminStatus(argv.email);
        }
      },
    )
    .demandCommand(1, 'You need to provide a command')
    .help().argv;
}

main();
