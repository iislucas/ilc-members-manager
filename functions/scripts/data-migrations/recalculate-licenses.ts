/*
Usage: 

NOTE: GOOGLE_APPLICATION_CREDENTIALS should be set in your environment if not using default credentials.

pnpm exec ts-node functions/scripts/recalculate-licenses.ts --project <PROJECT_ID> [--dry-run]
*/

import * as firebase from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Provide basic Date logic because we can't easily import date-fns without ensuring it's in package.json
function pad(n: number) {
  return n < 10 ? '0' + n : String(n);
}

function parseToDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isValid(date: any): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

function ensureLaterDate(oldDate: string | undefined | null, newDate: string | undefined | null): string | undefined {
  if (!newDate) return oldDate || undefined;
  if (!oldDate) return newDate;
  if (newDate > oldDate) {
    return newDate;
  }
  return oldDate;
}

function ensureHigherStudentLevel(
  oldLevel: string | undefined | null,
  newLevel: string | undefined | null
): string | undefined {
  if (!newLevel) return oldLevel || undefined;
  if (!oldLevel) return newLevel;

  const score = (lvl: string) => {
    if (lvl === 'Entry') return 0.5;
    const n = parseInt(lvl, 10);
    return isNaN(n) ? 0 : n;
  };

  return score(newLevel) > score(oldLevel) ? newLevel : oldLevel;
}

function calculateNewExpiry(
  currentExpiryStr: string | undefined | null,
  paidDate: Date,
  startDateStr: string | undefined | null
): Date {
  const dates: number[] = [];

  if (paidDate && isValid(paidDate)) {
    dates.push(paidDate.getTime());
  }

  if (startDateStr) {
    const startDate = parseToDate(startDateStr);
    if (startDate && isValid(startDate)) {
      dates.push(startDate.getTime());
    }
  }

  if (currentExpiryStr) {
    const currentExpiry = parseToDate(currentExpiryStr);
    if (currentExpiry && isValid(currentExpiry)) {
      dates.push(currentExpiry.getTime());
    }
  }

  if (dates.length === 0) {
    return addYears(paidDate, 1);
  }

  const maxTime = Math.max(...dates);
  return addYears(new Date(maxTime), 1);
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('project', {
      type: 'string',
      description: 'Firebase Project ID',
      demandOption: false,
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Preview changes without executing them',
      default: false,
    })
    .help()
    .parseSync();

  const projectId = argv.project || process.env.GCLOUD_PROJECT;
  const dryRun = argv['dry-run'];

  console.log(`Project ID: ${projectId}`);
  console.log(`Dry Run: ${dryRun}`);

  const app = firebase.initializeApp({
    projectId,
  });
  const db = firebase.firestore();

  try {
    console.log('Fetching members...');
    const membersSnap = await db.collection('members').get();
    const membersList = membersSnap.docs.map(doc => ({ ...(doc.data() as any), id: doc.id }));
    const membersById = new Map<string, any>();
    const membersByEmail = new Map<string, any[]>();

    for (const m of membersList) {
      if (m.memberId) membersById.set(m.memberId, m);
      if (m.emails) {
        for (const e of m.emails) {
          const lowerE = String(e).toLowerCase();
          if (!membersByEmail.has(lowerE)) membersByEmail.set(lowerE, []);
          membersByEmail.get(lowerE)!.push(m);
        }
      }
    }

    console.log('Fetching schools...');
    const schoolsSnap = await db.collection('schools').get();
    const schoolsList = schoolsSnap.docs.map(doc => ({ ...(doc.data() as any), id: doc.id }));

    console.log('Fetching orders...');
    const ordersSnap = await db.collection('orders').get();
    let ordersList = ordersSnap.docs.map(doc => ({ ...(doc.data() as any), id: doc.id }));

    // Sort orders chronologically by datePaid so earlier orders don't incorrectly overwrite logic
    ordersList.sort((a, b) => {
      const dA = parseToDate(a.datePaid)?.getTime() || 0;
      const dB = parseToDate(b.datePaid)?.getTime() || 0;
      return dA - dB;
    });

    const memberUpdates = new Map<string, any>();
    const schoolUpdates = new Map<string, any>();

    console.log(`Processing ${ordersList.length} orders...`);

    for (const order of ordersList) {
      const paymentType = (order.paidFor || '').trim();
      const paidDate = parseToDate(order.datePaid);

      if (!paidDate || !isValid(paidDate)) {
        continue;
      }

      // 1. School License
      if (paymentType.includes('School License')) {
        let school: any = undefined;
        if (order.externalId) {
          school = schoolsList.find(s => s.schoolId === order.externalId);
        }
        if (!school) continue;

        let changed = false;
        const newSchool = schoolUpdates.get(school.id) || { ...school };

        const potentialNewRenewal = ensureLaterDate(newSchool.schoolLicenseRenewalDate, order.datePaid);
        if (potentialNewRenewal && potentialNewRenewal !== newSchool.schoolLicenseRenewalDate) {
          newSchool.schoolLicenseRenewalDate = potentialNewRenewal;
          changed = true;
        }

        const finalExpiry = calculateNewExpiry(newSchool.schoolLicenseExpires, paidDate, order.startDate);
        const finalExpiryStr = formatDate(finalExpiry);
        if (finalExpiryStr !== newSchool.schoolLicenseExpires) {
          newSchool.schoolLicenseExpires = finalExpiryStr;
          changed = true;
        }

        if (changed) {
          schoolUpdates.set(newSchool.id, newSchool);
        }
        continue;
      }

      // Member Matching
      let member: any = undefined;

      if (order.externalId) {
        member = membersById.get(order.externalId);
      }

      if (!member && order.email) {
        const matches = membersByEmail.get(order.email.toLowerCase()) || [];
        if (matches.length === 1) {
          member = matches[0];
        }
      }

      if (!member) continue;

      const newMember = memberUpdates.get(member.id) || { ...member };
      let changed = false;

      const isMembership = [
        'Member Dues - Annual',
        'Member Dues - Life',
        'Member Dues - Life (Partner)',
        'Member Dues - Senior',
        'Member Dues - Student',
        'Member Dues - Minor'
      ].some(t => paymentType === t || paymentType === 'Member Dues - Annual');

      const isInstructorLicense = paymentType.includes("Instructor's License") || paymentType === 'Instructor License';

      if (isMembership && !paymentType.includes('Life')) {
        const potentialNewRenewal = ensureLaterDate(newMember.lastRenewalDate, order.datePaid);
        if (potentialNewRenewal && potentialNewRenewal !== newMember.lastRenewalDate) {
          newMember.lastRenewalDate = potentialNewRenewal;
          changed = true;
        }

        const finalExpiry = calculateNewExpiry(newMember.currentMembershipExpires, paidDate, order.startDate);
        const finalExpiryStr = formatDate(finalExpiry);
        if (finalExpiryStr !== newMember.currentMembershipExpires) {
          newMember.currentMembershipExpires = finalExpiryStr;
          changed = true;
        }
      }

      if (isInstructorLicense) {
        const potentialInstRenewal = ensureLaterDate(newMember.instructorLicenseRenewalDate, order.datePaid);
        let updatedRenewalDate = newMember.instructorLicenseRenewalDate;
        if (potentialInstRenewal && potentialInstRenewal !== newMember.instructorLicenseRenewalDate) {
          newMember.instructorLicenseRenewalDate = potentialInstRenewal;
          updatedRenewalDate = potentialInstRenewal;
          changed = true;
        }

        let renewalDateObj = parseToDate(updatedRenewalDate);
        if (!renewalDateObj || !isValid(renewalDateObj)) {
          renewalDateObj = paidDate;
        }
        const newExpiryObj = addDays(addYears(renewalDateObj, 1), 1);

        const prevExpiryObj = parseToDate(member.instructorLicenseExpires);
        const prevExpiryTime = (prevExpiryObj && isValid(prevExpiryObj)) ? prevExpiryObj.getTime() : 0;

        const finalExpiryTime = Math.max(prevExpiryTime, newExpiryObj.getTime());
        const finalExpiryStr = formatDate(new Date(finalExpiryTime));

        if (finalExpiryStr !== newMember.instructorLicenseExpires) {
          newMember.instructorLicenseExpires = finalExpiryStr;
          changed = true;
        }

        if (newMember.instructorLicenseType !== 'Annual') {
          newMember.instructorLicenseType = 'Annual';
          changed = true;
        }
      }

      const isGrading = order.orderType?.toLowerCase() === 'grading' || paymentType.toLowerCase().includes('student level');
      if (isGrading) {
        const levelMatch = paymentType.match(/Student Level\s*(\d+)/i);
        if (levelMatch) {
          const newLevel = levelMatch[1];
          const higherLevel = ensureHigherStudentLevel(newMember.studentLevel, newLevel);
          if (higherLevel !== undefined && higherLevel !== newMember.studentLevel) {
            newMember.studentLevel = higherLevel;
            changed = true;
          }
        }
      }

      if (changed) {
        memberUpdates.set(newMember.id, newMember);
      }
    }

    console.log(`Found ${memberUpdates.size} members to update.`);
    console.log(`Found ${schoolUpdates.size} schools to update.`);

    if (dryRun) {
      console.log('\n[DRY RUN] No changes were made to the database.');
    } else {
      let batchedWrites = 0;
      let batch = db.batch();

      for (const m of memberUpdates.values()) {
        const { id, ...data } = m;
        batch.set(db.collection('members').doc(id), {
          ...data,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        batchedWrites++;

        if (batchedWrites >= 450) {
          await batch.commit();
          batch = db.batch();
          batchedWrites = 0;
        }
      }

      for (const s of schoolUpdates.values()) {
        const { id, ...data } = s;
        batch.set(db.collection('schools').doc(id), {
          ...data,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        batchedWrites++;

        if (batchedWrites >= 450) {
          await batch.commit();
          batch = db.batch();
          batchedWrites = 0;
        }
      }

      if (batchedWrites > 0) {
        await batch.commit();
      }

      console.log('\nSuccessfully saved computed dates.');
    }
  } catch (error) {
    console.error('Error computing licenses:', error);
  } finally {
    await app.delete();
  }
}

main();
