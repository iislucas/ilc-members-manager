/*
 * Audit: Squarespace orders vs duplicate member IDs  (READ-ONLY)
 *
 * The Squarespace order processors (membership, life membership, instructor
 * licence, video library, grading) looked members up with
 *   where('memberId', '==', X).limit(1)
 * so when X was shared by several member docs, only one was ever considered.
 *
 * This script:
 *   1. Loads all members and finds memberIds shared by >1 member doc.
 *   2. Loads all Squarespace orders and, for each line item handled by a
 *      memberId lookup, computes the effective memberId exactly as the
 *      processors did (admin override `ilcAppMemberIdInferred` wins, else the
 *      form's "Member ID" field). Life-membership spouse IDs are checked too.
 *   3. Reports every line item whose effective memberId is currently shared,
 *      which candidate matches the order's email/name, and which doc the
 *      `limit(1)` query would have returned (lowest docId — Firestore's
 *      default ordering for an equality query).
 *
 * Caveat: duplicates are evaluated against the CURRENT member collection.
 * A clash that existed at order time but has since been fixed won't show up
 * here (though orders that errored with a name/email mismatch are listed
 * separately as possible historical clashes).
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/audit-squarespace-duplicate-member-ids.ts [--project <PROJECT_ID>] [--json out.json]
 */
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Member } from '../src/data-model/members';
import { OrderKind, SquareSpaceOrder, SquareSpaceLineItem } from '../src/data-model/orders';
import { parseMembershipPurchaseInfo } from '../src/squarespace-orders/common';

const argv = yargs(hideBin(process.argv))
  .option('project', { type: 'string', description: 'Firebase Project ID' })
  .option('json', { type: 'string', description: 'Write full results to this JSON file' })
  .parseSync();

const projectId = argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

const norm = (s: string | undefined) => (s || '').trim().toUpperCase();
const lower = (s: string | undefined) => (s || '').trim().toLowerCase();

function category(sku: string): string | null {
  if (sku.startsWith('MEM-LIFE-')) return 'life-membership';
  if (sku.startsWith('MEM-YEAR-')) return 'annual-membership';
  if (sku === 'VID-LIBRARY') return 'video-library';
  if (sku.startsWith('LIS-YEAR-')) return 'instructor-license';
  if (sku.startsWith('GRA-')) return 'grading';
  return null;
}

interface Candidate {
  docId: string;
  name: string;
  emails: string[];
  emailMatch: boolean;
  nameMatch: boolean;
  lastRenewalDate: string;
  currentMembershipExpires: string;
}

interface Finding {
  orderDocId: string;
  orderNumber: string;
  createdOn: string;
  sku: string;
  category: string;
  role: 'member' | 'spouse';
  memberId: string;
  memberIdSource: 'admin-override' | 'form';
  orderName: string;
  orderEmail: string;
  processingStatus: string;
  processingIssue: string;
  newExpiry: string;
  queryPickedDocId: string;
  likelyIntendedDocIds: string[];
  verdict: string;
  candidates: Candidate[];
}

async function main() {
  console.log(`Project: ${projectId || '(default credentials)'}\n`);

  const membersSnap = await db.collection('members').get();
  const byMemberId = new Map<string, { docId: string; m: Member }[]>();
  for (const doc of membersSnap.docs) {
    const m = doc.data() as Member;
    const id = norm(m.memberId);
    if (!id) continue;
    const list = byMemberId.get(id) || [];
    list.push({ docId: doc.id, m });
    byMemberId.set(id, list);
  }
  const dupIds = new Map([...byMemberId].filter(([, v]) => v.length > 1));
  console.log(`Members: ${membersSnap.size}; memberIds shared by >1 doc: ${dupIds.size}`);
  for (const [id, list] of dupIds) {
    console.log(`  ${id}: ${list.map((x) => `${x.docId} (${x.m.name})`).join(' | ')}`);
  }

  const ordersSnap = await db.collection('orders')
    .where('ilcAppOrderKind', '==', OrderKind.Squarespace).get();
  console.log(`\nSquarespace orders: ${ordersSnap.size}`);

  const findings: Finding[] = [];
  const mismatchErrors: { orderNumber: string; createdOn: string; sku: string; issue: string }[] = [];
  const lookupItemCounts: Record<string, number> = {};

  for (const doc of ordersSnap.docs) {
    const order = doc.data() as SquareSpaceOrder;
    for (const li of (order.lineItems || []) as SquareSpaceLineItem[]) {
      const cat = category(li.sku || '');
      if (!cat) continue;
      lookupItemCounts[cat] = (lookupItemCounts[cat] || 0) + 1;

      const issue = li.ilcAppProcessingIssue || '';
      if (/mismatch/i.test(issue)) {
        mismatchErrors.push({ orderNumber: order.orderNumber, createdOn: (order.createdOn || '').slice(0, 10), sku: li.sku, issue });
      }

      const roles: ('member' | 'spouse')[] = cat === 'life-membership' ? ['member', 'spouse'] : ['member'];
      for (const role of roles) {
        const info = parseMembershipPurchaseInfo(li.customizations || [], order, role === 'spouse' ? 'Spouse' : '');
        let memberId = norm(info.memberId);
        let source: Finding['memberIdSource'] = 'form';
        if (role === 'member' && li.ilcAppMemberIdInferred) {
          memberId = norm(li.ilcAppMemberIdInferred);
          source = 'admin-override';
        }
        if (!memberId || !dupIds.has(memberId)) continue;

        const cands = dupIds.get(memberId)!;
        const candidates: Candidate[] = cands.map(({ docId, m }) => {
          const emails = (m.emails || []).map(lower);
          return {
            docId,
            name: m.name || '',
            emails,
            emailMatch: !!info.email && emails.includes(lower(info.email)),
            nameMatch: !!info.name && lower(m.name) === lower(info.name),
            lastRenewalDate: m.lastRenewalDate || '',
            currentMembershipExpires: m.currentMembershipExpires || '',
          };
        });
        const picked = [...cands].map((c) => c.docId).sort()[0];
        const intended = candidates.filter((c) => c.emailMatch || c.nameMatch).map((c) => c.docId);

        let verdict: string;
        if (intended.length === 0) verdict = 'UNKNOWN: no candidate matches order email/name';
        else if (intended.length > 1) verdict = 'AMBIGUOUS: several candidates match order email/name';
        else if (intended[0] === picked) verdict = 'OK: query would have picked the intended member';
        else if (li.ilcAppProcessingStatus === 'processed' && source === 'admin-override') verdict = 'WRONG MEMBER LIKELY UPDATED (admin override skipped validation)';
        else if (li.ilcAppProcessingStatus === 'processed') verdict = 'CHECK: processed, but query picks a different doc than the intended one';
        else verdict = 'BLOCKED: query picks the other member; buyer not credited';

        findings.push({
          orderDocId: doc.id,
          orderNumber: order.orderNumber,
          createdOn: (order.createdOn || '').slice(0, 10),
          sku: li.sku,
          category: cat,
          role,
          memberId,
          memberIdSource: source,
          orderName: info.name,
          orderEmail: info.email,
          processingStatus: li.ilcAppProcessingStatus || '',
          processingIssue: issue,
          newExpiry: li.ilcAppNewExpiryDate || '',
          queryPickedDocId: picked,
          likelyIntendedDocIds: intended,
          verdict,
          candidates,
        });
      }
    }
  }

  console.log('Line items handled by a memberId lookup:', lookupItemCounts);
  console.log(`\n=== Line items whose memberId is currently shared: ${findings.length} ===`);
  findings.sort((a, b) => a.createdOn.localeCompare(b.createdOn));
  for (const f of findings) {
    console.log(`\n#${f.orderNumber} ${f.createdOn} ${f.sku} [${f.role}] memberId=${f.memberId} (${f.memberIdSource})`);
    console.log(`  order: name="${f.orderName}" email="${f.orderEmail}"  status=${f.processingStatus}${f.newExpiry ? ` newExpiry=${f.newExpiry}` : ''}`);
    if (f.processingIssue) console.log(`  issue: ${f.processingIssue}`);
    for (const c of f.candidates) {
      const tags = [c.docId === f.queryPickedDocId ? 'PICKED' : '', c.emailMatch ? 'email✓' : '', c.nameMatch ? 'name✓' : ''].filter(Boolean).join(',');
      console.log(`    - ${c.docId} "${c.name}" [${c.emails.join(', ')}] exp=${c.currentMembershipExpires} ${tags}`);
    }
    console.log(`  => ${f.verdict}`);
  }

  const byVerdict: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  for (const f of findings) {
    const v = f.verdict.split(':')[0].split(' (')[0];
    byVerdict[v] = (byVerdict[v] || 0) + 1;
    byCat[f.category] = (byCat[f.category] || 0) + 1;
  }
  console.log('\n=== Summary ===');
  console.log('By category:', byCat);
  console.log('By verdict:', byVerdict);
  console.log(`Distinct orders affected: ${new Set(findings.map((f) => f.orderDocId)).size}`);
  console.log(`Line items with name/email mismatch errors (possible historical clashes): ${mismatchErrors.length}`);

  if (argv.json) {
    fs.writeFileSync(argv.json, JSON.stringify({ duplicateIds: Object.fromEntries([...dupIds].map(([k, v]) => [k, v.map((x) => ({ docId: x.docId, name: x.m.name }))])), findings, mismatchErrors }, null, 2));
    console.log(`\nWrote ${argv.json}`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
