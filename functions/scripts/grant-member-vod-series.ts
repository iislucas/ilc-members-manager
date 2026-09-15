/* grant-member-vod-series.ts
 *
 * Utility script to analyze, match, preview, and grant VOD series access to a member.
 *
 * Usage:
 *   cd functions
 *
 *   # 1. Search / analyze series by title or keyword:
 *   pnpm exec ts-node scripts/grant-member-vod-series.ts --search "spinning hands"
 *
 *   # 2. Match a list of series queries against the catalog:
 *   pnpm exec ts-node scripts/grant-member-vod-series.ts --match "Meet and Match; Finding the Center; Butterfly form"
 *
 *   # 3. Dry-run grant series to a member:
 *   pnpm exec ts-node scripts/grant-member-vod-series.ts --member US658 --series 504000,36073 --dry-run
 *
 *   # 4. Live grant series to a member:
 *   pnpm exec ts-node scripts/grant-member-vod-series.ts --member US658 --series 504000,36073
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  createActionContext,
  getMember,
  getMemberByEmail,
  getMemberByMemberId,
  grantVideoAccess,
  listVideoSeries,
  listMemberVideoGrants,
  VideoGrantKind,
} from '../src/actions';

const argv = yargs(hideBin(process.argv))
  .option('member', {
    type: 'string',
    description: 'Member docId, memberId (e.g. US658), or email address',
  })
  .option('series', {
    type: 'string',
    description: 'Comma-separated series IDs (e.g. "504000,36073,143555")',
  })
  .option('search', {
    type: 'string',
    description: 'Search catalog series by keyword',
  })
  .option('match', {
    type: 'string',
    description: 'Semicolon- or newline-separated list of series queries to match against catalog',
  })
  .option('notes', {
    type: 'string',
    description: 'Administrative notes for the grant',
    default: 'Manual VOD series grant',
  })
  .option('dry-run', {
    type: 'boolean',
    description: 'Preview operations without persisting writes to Firestore',
    default: false,
  })
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID (optional)',
  })
  .parseSync();

async function resolveMember(ctx: any, memberArg: string) {
  if (!memberArg) return null;
  // By docId
  const byDoc = await getMember(ctx, memberArg);
  if (byDoc) return byDoc;
  // By email
  if (memberArg.includes('@')) {
    const byEmail = await getMemberByEmail(ctx, memberArg);
    if (byEmail) return byEmail;
  }
  // By memberId
  const byId = await getMemberByMemberId(ctx, memberArg);
  if (byId) return byId;
  return null;
}

async function main() {
  const isDryRun = argv['dry-run'];
  const ctx = createActionContext({
    projectId: argv.project,
    dryRun: isDryRun,
    actor: {
      name: 'VOD Admin Tool',
      email: 'admin@iliqchuan.com',
      isAdmin: true,
    },
  });

  // 1. Search mode
  if (argv.search) {
    const results = await listVideoSeries(ctx, { searchTerm: argv.search });
    console.log(`\n🔍 Found ${results.length} series matching "${argv.search}":\n`);
    for (const s of results) {
      const priceStr = typeof s.priceCents === 'number' ? `$${(s.priceCents / 100).toFixed(2)}` : 'N/A';
      console.log(`  [Series ID: ${s.seriesId}] "${s.title}"`);
      console.log(`    Videos (${s.videoCount}): Price: ${priceStr} | Tier: ${s.accessTier}`);
      for (const v of s.videos) {
        console.log(`      - Part ${v.seriesPartIndex ?? '?'}: [${v.docId}] "${v.title}"`);
      }
    }
    return;
  }

  // 2. Batch Match mode
  if (argv.match) {
    const allSeries = await listVideoSeries(ctx);
    const queries = argv.match.split(/[;\n]+/).map((q) => q.trim()).filter(Boolean);
    console.log(`\n📋 Matching ${queries.length} queries against ${allSeries.length} catalog series:\n`);

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const qLower = q.toLowerCase();
      const words = qLower.split(/[\s\-:]+/).filter((w) => w.length > 2 && !['and', 'the', 'for', 'liq', 'chuan', 'ilc', 'zxd'].includes(w));

      const matches = allSeries.filter((s) => {
        const titleLower = s.title.toLowerCase();
        const descLower = (s.description || '').toLowerCase();
        return titleLower.includes(qLower) || words.every((w) => titleLower.includes(w) || descLower.includes(w));
      });

      console.log(`${i + 1}. "${q}"`);
      if (matches.length === 0) {
        console.log(`   ❌ No direct matches found.`);
      } else {
        for (const m of matches) {
          console.log(`   ✅ [Series ID: ${m.seriesId}] "${m.title}" (${m.videoCount} videos)`);
        }
      }
    }
    return;
  }

  // 3. Grant Series mode
  if (!argv.member || !argv.series) {
    console.error('❌ Usage error: either provide --search, --match, or BOTH --member and --series.');
    process.exit(1);
  }

  const member = await resolveMember(ctx, argv.member);
  if (!member) {
    console.error(`❌ Member "${argv.member}" could not be found.`);
    process.exit(1);
  }

  console.log(`\n👤 Target Member: ${member.name} (${member.memberId || 'No Member ID'})`);
  console.log(`   Email:   ${member.emails[0] || 'N/A'}`);
  console.log(`   Doc ID:  ${member.docId}`);
  if (isDryRun) {
    console.log(`\n--- 🔍 DRY-RUN MODE: No database changes will be committed ---\n`);
  }

  const seriesIds = argv.series.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  console.log(`Targeting ${seriesIds.length} Series:`, seriesIds);

  // Check current grants
  const currentGrants = await listMemberVideoGrants(ctx, member.docId);
  const currentGrantIds = new Set(currentGrants.map((g) => g.videoId));
  console.log(`Member currently holds ${currentGrants.length} video grant(s).\n`);

  let totalGrantedVideos = 0;
  const grantedSeriesSummary: Array<{ seriesId: string; title: string; count: number; videoIds: string[] }> = [];

  for (const sId of seriesIds) {
    const res = await grantVideoAccess(ctx, {
      seriesId: sId,
      recipientMemberDocId: member.docId,
      grantKind: VideoGrantKind.AdminGrant,
      notes: argv.notes,
    });

    if (!res.success) {
      console.error(`❌ Failed to grant series "${sId}":`, res.error);
      continue;
    }

    const videoIds = res.data?.videoIds || [];
    totalGrantedVideos += videoIds.length;
    grantedSeriesSummary.push({
      seriesId: sId,
      title: sId,
      count: videoIds.length,
      videoIds,
    });

    console.log(`✅ Series [${sId}]: Granted ${videoIds.length} targets (video IDs: ${videoIds.join(', ')})`);
  }

  console.log(`\n======================================================`);
  console.log(`Summary:`);
  console.log(`  Member:              ${member.name} (${member.memberId})`);
  console.log(`  Series Processed:    ${grantedSeriesSummary.length} of ${seriesIds.length}`);
  console.log(`  Total Targets:       ${totalGrantedVideos}`);
  console.log(`  Mode:                ${isDryRun ? 'DRY RUN (0 writes performed)' : 'LIVE COMMITTED'}`);
  console.log(`  Admin Verification:  https://app.iliqchuan.com/members/${member.docId}`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
