/*
 * Check Counters Script
 *
 * Reads the current system/counters document from Firestore and compares it
 * against all member/school IDs to determine if counters are correctly set.
 * With --fix, updates any counters that are too low.
 *
 * Counters must be strictly greater than the max seen ID so that the next
 * allocated ID is always unique.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/check-counters.ts [--project prod|dev] [--fix]
 *
 * Examples:
 *   pnpm exec ts-node scripts/check-counters.ts              # check prod
 *   pnpm exec ts-node scripts/check-counters.ts --fix        # fix prod
 *   pnpm exec ts-node scripts/check-counters.ts --project dev --fix
 */
import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Counters, Member, School } from '../src/data-model';
import {
  extractCountersFromMember,
  extractCountersFromSchool,
} from '../src/counters';

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    default: 'prod',
    describe: 'Firebase project alias: prod or dev',
  })
  .option('fix', {
    type: 'boolean',
    default: false,
    describe: 'Update counters that are too low',
  })
  .parseSync();

const projectId =
  argv.project === 'dev' ? 'ilc-class-tracker-dev' : 'ilc-paris-class-tracker';

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main() {
  const fix = argv.fix;
  console.log(`\n🔍 Checking counters for project: ${projectId}`);
  if (fix) {
    console.log('🔧 Fix mode: will update counters that are too low');
  }
  console.log('');

  // 1. Read current counters document
  const countersDoc = await db.doc('system/counters').get();
  if (!countersDoc.exists) {
    console.log('❌ No system/counters document found!');
    if (fix) {
      console.log('   Creating a new counters document...');
    } else {
      console.log('   Run with --fix to create one.');
      return;
    }
  }
  const counters: Counters = countersDoc.exists
    ? (countersDoc.data() as Counters)
    : { memberIdCounters: {}, instructorIdCounter: 100, schoolIdCounter: 100 };

  console.log('📊 Current counters in Firestore:');
  console.log(
    '  memberIdCounters:',
    JSON.stringify(counters.memberIdCounters, null, 2),
  );
  console.log('  instructorIdCounter:', counters.instructorIdCounter);
  console.log('  schoolIdCounter:', counters.schoolIdCounter);
  console.log('');

  // 2. Scan all members
  const membersSnap = await db.collection('members').get();
  console.log(`📋 Total members: ${membersSnap.size}`);

  const derivedMemberCounters: { [countryCode: string]: number } = {};
  let derivedInstructorCounter = 0;
  const unparsedMemberIds: string[] = [];
  const unparsedInstructorIds: string[] = [];

  for (const doc of membersSnap.docs) {
    const member = doc.data() as Member;
    const { memberIdCountryCode, memberIdNumber, instructorIdNumber } =
      extractCountersFromMember(member);

    if (member.memberId) {
      if (memberIdCountryCode && memberIdNumber) {
        if (
          !derivedMemberCounters[memberIdCountryCode] ||
          memberIdNumber > derivedMemberCounters[memberIdCountryCode]
        ) {
          derivedMemberCounters[memberIdCountryCode] = memberIdNumber;
        }
      } else {
        unparsedMemberIds.push(member.memberId);
      }
    }

    if (member.instructorId) {
      if (instructorIdNumber) {
        if (instructorIdNumber > derivedInstructorCounter) {
          derivedInstructorCounter = instructorIdNumber;
        }
      } else {
        unparsedInstructorIds.push(member.instructorId);
      }
    }
  }

  // 3. Scan all schools
  const schoolsSnap = await db.collection('schools').get();
  console.log(`🏫 Total schools: ${schoolsSnap.size}`);

  let derivedSchoolCounter = 0;
  const unparsedSchoolIds: string[] = [];

  for (const doc of schoolsSnap.docs) {
    const school = doc.data() as School;
    const { schoolIdNumber } = extractCountersFromSchool(school);

    if (school.schoolId) {
      if (schoolIdNumber) {
        if (schoolIdNumber > derivedSchoolCounter) {
          derivedSchoolCounter = schoolIdNumber;
        }
      } else {
        unparsedSchoolIds.push(school.schoolId);
      }
    }
  }

  // 4. Compare and build fix payload
  console.log('\n📊 Derived counters from actual data (max ID seen):');
  console.log(
    '  memberIdCounters:',
    JSON.stringify(derivedMemberCounters, null, 2),
  );
  console.log('  instructorIdCounter:', derivedInstructorCounter);
  console.log('  schoolIdCounter:', derivedSchoolCounter);

  console.log('\n🔎 Comparison:');

  const allCountryCodes = new Set([
    ...Object.keys(counters.memberIdCounters || {}),
    ...Object.keys(derivedMemberCounters),
  ]);

  let issueCount = 0;
  const fixedCounters: Counters = {
    memberIdCounters: { ...(counters.memberIdCounters || {}) },
    instructorIdCounter: counters.instructorIdCounter || 100,
    schoolIdCounter: counters.schoolIdCounter || 100,
  };

  // Member ID counters
  for (const code of [...allCountryCodes].sort()) {
    const stored = counters.memberIdCounters?.[code] || 0;
    const maxSeen = derivedMemberCounters[code] || 0;
    // Counter should be > maxSeen (it represents the last assigned value,
    // so nextId = counter + 1). We need stored >= maxSeen at minimum.
    // The ensureCountersAreAtLeast function uses calculateNextCounterValue
    // which does Math.max(current, lastSeenId) + 1, meaning the stored
    // counter after processing should be maxSeen + 1.
    const needed = maxSeen + 1;
    if (stored >= needed) {
      console.log(
        `  [${code}] stored=${stored} maxSeen=${maxSeen} needed≥${needed} ✅`,
      );
    } else {
      issueCount++;
      console.log(
        `  [${code}] stored=${stored} maxSeen=${maxSeen} needed≥${needed} ❌ TOO LOW`,
      );
      fixedCounters.memberIdCounters[code] = needed;
    }
  }

  // Instructor counter
  const instrStored = counters.instructorIdCounter || 0;
  const instrNeeded = derivedInstructorCounter + 1;
  if (instrStored >= instrNeeded) {
    console.log(
      `  [instructor] stored=${instrStored} maxSeen=${derivedInstructorCounter} needed≥${instrNeeded} ✅`,
    );
  } else {
    issueCount++;
    console.log(
      `  [instructor] stored=${instrStored} maxSeen=${derivedInstructorCounter} needed≥${instrNeeded} ❌ TOO LOW`,
    );
    fixedCounters.instructorIdCounter = instrNeeded;
  }

  // School counter
  const schoolStored = counters.schoolIdCounter || 0;
  const schoolNeeded = derivedSchoolCounter + 1;
  if (schoolStored >= schoolNeeded) {
    console.log(
      `  [school] stored=${schoolStored} maxSeen=${derivedSchoolCounter} needed≥${schoolNeeded} ✅`,
    );
  } else {
    issueCount++;
    console.log(
      `  [school] stored=${schoolStored} maxSeen=${derivedSchoolCounter} needed≥${schoolNeeded} ❌ TOO LOW`,
    );
    fixedCounters.schoolIdCounter = schoolNeeded;
  }

  // Unparsed IDs
  if (unparsedMemberIds.length > 0) {
    console.log(
      `\n⚠️  ${unparsedMemberIds.length} member IDs could not be parsed:`,
    );
    console.log('  ', unparsedMemberIds.slice(0, 20).join(', '));
    if (unparsedMemberIds.length > 20) console.log('  ... and more');
  }
  if (unparsedInstructorIds.length > 0) {
    console.log(
      `\n⚠️  ${unparsedInstructorIds.length} instructor IDs could not be parsed:`,
    );
    console.log('  ', unparsedInstructorIds.slice(0, 20).join(', '));
  }
  if (unparsedSchoolIds.length > 0) {
    console.log(
      `\n⚠️  ${unparsedSchoolIds.length} school IDs could not be parsed:`,
    );
    console.log('  ', unparsedSchoolIds.slice(0, 20).join(', '));
  }

  // Summary & Fix
  console.log('\n' + '='.repeat(60));
  if (issueCount === 0) {
    console.log(
      '✅ All counters are correctly set (next ID will be unique).',
    );
  } else {
    console.log(`⚠️  ${issueCount} counter(s) need updating.`);

    if (fix) {
      console.log('\n🔧 Applying fix...');
      console.log(
        '  New counters:',
        JSON.stringify(fixedCounters, null, 2),
      );
      await db.doc('system/counters').set(fixedCounters);
      console.log('✅ Counters updated successfully!');
    } else {
      console.log('   Run with --fix to update them.');
      console.log(
        '\n   Would set:',
        JSON.stringify(fixedCounters, null, 2),
      );
    }
  }
  console.log('='.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
