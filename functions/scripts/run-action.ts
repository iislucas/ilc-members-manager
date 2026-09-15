/* run-action.ts
 *
 * Command-line runner for executing common database actions using the actions library.
 * Useful for agents, administrators, and developers to safely run operations with
 * built-in validation, schema guarantees, and dry-run preview.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/run-action.ts --action <action-name> [options]
 *
 * Examples:
 *   # 1. Lookup member by email or memberId (dry-run not needed for reads):
 *   pnpm exec ts-node scripts/run-action.ts --action get-member --member "jean@example.fr"
 *
 *   # 2. Preview creating a new member (Dry run):
 *   pnpm exec ts-node scripts/run-action.ts --action create-member --name "Jean Dupont" --email "jean@example.fr" --country FR --dry-run
 *
 *   # 3. Create a new member for real:
 *   pnpm exec ts-node scripts/run-action.ts --action create-member --name "Jean Dupont" --email "jean@example.fr" --country FR
 *
 *   # 4. Renew membership:
 *   pnpm exec ts-node scripts/run-action.ts --action renew-member --member <DOC_ID> --expires 2028-12-31
 *
 *   # 5. Create a school:
 *   pnpm exec ts-node scripts/run-action.ts --action create-school --name "ILC Lyon" --country France
 *
 *   # 6. Create and record a grading result:
 *   pnpm exec ts-node scripts/run-action.ts --action create-grading --member <STUDENT_DOC_ID> --level "Level 1"
 *   pnpm exec ts-node scripts/run-action.ts --action record-grading --grading <GRADING_DOC_ID> --pass true --notes "Excellent understanding"
 *
 *   # 7. Grant video access:
 *   pnpm exec ts-node scripts/run-action.ts --action grant-video --video <VIDEO_ID> --member "jean@example.fr"
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  createActionContext,
  getMember,
  getMemberByMemberId,
  getMemberByEmail,
  createMember,
  renewMembership,
  createSchool,
  getSchool,
  createGrading,
  getGrading,
  acceptGrading,
  recordGradingResult,
  grantVideoAccess,
} from '../src/actions';

const argv = yargs(hideBin(process.argv))
  .option('action', {
    type: 'string',
    description: 'Action to execute',
    demandOption: true,
    choices: [
      'get-member',
      'create-member',
      'renew-member',
      'create-school',
      'get-school',
      'create-grading',
      'accept-grading',
      'record-grading',
      'grant-video',
    ],
  })
  .option('dry-run', {
    type: 'boolean',
    description: 'Preview changes without committing to Firestore',
    default: false,
  })
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID (optional)',
  })
  // Member fields
  .option('member', {
    type: 'string',
    description: 'Member docId, memberId (e.g. US402), or email address',
  })
  .option('name', {
    type: 'string',
    description: 'Full name for creating a member or school',
  })
  .option('email', {
    type: 'string',
    description: 'Email address',
  })
  .option('country', {
    type: 'string',
    description: 'Country or 2-letter country code',
  })
  .option('expires', {
    type: 'string',
    description: 'Expiration date (YYYY-MM-DD)',
  })
  // Grading fields
  .option('grading', {
    type: 'string',
    description: 'Grading doc ID',
  })
  .option('level', {
    type: 'string',
    description: 'Grading level (e.g. "Level 1", "Application 2")',
  })
  .option('instructor', {
    type: 'string',
    description: 'Instructor ID (e.g. "INST-1")',
  })
  .option('pass', {
    type: 'boolean',
    description: 'Grading result outcome (true for pass, false for fail)',
  })
  .option('notes', {
    type: 'string',
    description: 'Notes for grading or audit description',
  })
  // Video fields
  .option('video', {
    type: 'string',
    description: 'Video ID',
  })
  .parseSync();

async function resolveMemberDocId(ctx: any, memberArg: string): Promise<string | null> {
  if (!memberArg) return null;
  // Try docId
  const byDoc = await getMember(ctx, memberArg);
  if (byDoc) return byDoc.docId;
  // Try email
  if (memberArg.includes('@')) {
    const byEmail = await getMemberByEmail(ctx, memberArg);
    if (byEmail) return byEmail.docId;
  }
  // Try memberId
  const byId = await getMemberByMemberId(ctx, memberArg);
  if (byId) return byId.docId;

  return null;
}

async function main() {
  const isDryRun = argv['dry-run'];
  const ctx = createActionContext({
    projectId: argv.project,
    dryRun: isDryRun,
    actor: {
      name: 'CLI Action Runner',
      isAdmin: true,
    },
  });

  console.log(`\n🚀 Executing action: "${argv.action}" (Dry Run: ${isDryRun ? 'YES' : 'NO'})`);

  switch (argv.action) {
    case 'get-member': {
      if (!argv.member) {
        console.error('❌ --member is required.');
        process.exit(1);
      }
      const memberDocId = await resolveMemberDocId(ctx, argv.member);
      if (!memberDocId) {
        console.error(`❌ Member "${argv.member}" not found.`);
        process.exit(1);
      }
      const member = await getMember(ctx, memberDocId);
      console.log('✅ Member details:', JSON.stringify(member, null, 2));
      break;
    }

    case 'create-member': {
      if (!argv.name || !argv.email || !argv.country) {
        console.error('❌ --name, --email, and --country are required.');
        process.exit(1);
      }
      const res = await createMember(ctx, {
        name: argv.name,
        email: argv.email,
        countryCode: argv.country,
      });
      if (!res.success) {
        console.error('❌ Failed to create member:', res.error);
        process.exit(1);
      }
      console.log('✅ Member created:', JSON.stringify(res.data, null, 2));
      break;
    }

    case 'renew-member': {
      if (!argv.member || !argv.expires) {
        console.error('❌ --member and --expires (YYYY-MM-DD) are required.');
        process.exit(1);
      }
      const memberDocId = await resolveMemberDocId(ctx, argv.member);
      if (!memberDocId) {
        console.error(`❌ Member "${argv.member}" not found.`);
        process.exit(1);
      }
      const res = await renewMembership(ctx, memberDocId, {
        expirationDate: argv.expires,
      });
      if (!res.success) {
        console.error('❌ Failed to renew membership:', res.error);
        process.exit(1);
      }
      console.log('✅ Membership renewed:', JSON.stringify(res.data, null, 2));
      break;
    }

    case 'create-school': {
      if (!argv.name || !argv.country) {
        console.error('❌ --name and --country are required.');
        process.exit(1);
      }
      const res = await createSchool(ctx, {
        schoolName: argv.name,
        schoolCountry: argv.country,
      });
      if (!res.success) {
        console.error('❌ Failed to create school:', res.error);
        process.exit(1);
      }
      console.log('✅ School created:', JSON.stringify(res.data, null, 2));
      break;
    }

    case 'get-school': {
      if (!argv.name) {
        console.error('❌ School docId or name must be provided via --name.');
        process.exit(1);
      }
      const school = await getSchool(ctx, argv.name);
      console.log('✅ School details:', JSON.stringify(school, null, 2));
      break;
    }

    case 'create-grading': {
      if (!argv.member || !argv.level) {
        console.error('❌ --member and --level are required.');
        process.exit(1);
      }
      const studentDocId = await resolveMemberDocId(ctx, argv.member);
      if (!studentDocId) {
        console.error(`❌ Student "${argv.member}" not found.`);
        process.exit(1);
      }
      const res = await createGrading(ctx, {
        studentMemberDocId: studentDocId,
        level: argv.level,
        gradingInstructorId: argv.instructor,
      });
      if (!res.success) {
        console.error('❌ Failed to create grading:', res.error);
        process.exit(1);
      }
      console.log('✅ Grading created:', JSON.stringify(res.data, null, 2));
      break;
    }

    case 'accept-grading': {
      if (!argv.grading) {
        console.error('❌ --grading <docId> is required.');
        process.exit(1);
      }
      const res = await acceptGrading(ctx, argv.grading);
      if (!res.success) {
        console.error('❌ Failed to accept grading:', res.error);
        process.exit(1);
      }
      console.log('✅ Grading accepted:', JSON.stringify(res.data, null, 2));
      break;
    }

    case 'record-grading': {
      if (!argv.grading || argv.pass === undefined) {
        console.error('❌ --grading and --pass (true|false) are required.');
        process.exit(1);
      }
      const res = await recordGradingResult(ctx, argv.grading, {
        pass: argv.pass,
        resultNotes: argv.notes,
        awardLevel: true,
      });
      if (!res.success) {
        console.error('❌ Failed to record grading result:', res.error);
        process.exit(1);
      }
      console.log('✅ Grading result recorded:', JSON.stringify(res.data, null, 2));
      break;
    }

    case 'grant-video': {
      if (!argv.video || !argv.member) {
        console.error('❌ --video <id> and --member <docId|email> are required.');
        process.exit(1);
      }
      const memberDocId = await resolveMemberDocId(ctx, argv.member);
      if (!memberDocId) {
        console.error(`❌ Member "${argv.member}" not found.`);
        process.exit(1);
      }
      const res = await grantVideoAccess(ctx, {
        videoId: argv.video,
        recipientMemberDocId: memberDocId,
        notes: argv.notes || 'Granted via CLI runner',
      });
      if (!res.success) {
        console.error('❌ Failed to grant video access:', res.error);
        process.exit(1);
      }
      console.log('✅ Video access granted:', JSON.stringify(res.data, null, 2));
      break;
    }

    default:
      console.error(`Unknown action: ${argv.action}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
