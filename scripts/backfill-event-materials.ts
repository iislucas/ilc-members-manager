/* backfill-event-materials.ts
 *
 * One-off migration script to scan past event materials stored in Cloud Storage
 * (`events/{eventId}/materials/originals/{folder}/original`) and backfill their
 * indexed metadata records into Firestore under the event creator/owner's subcollection:
 * `/members/{ownerDocId}/uploads/{uploadDocId}`.
 *
 * Association logic:
 *   - Each material file lives in Storage under prefix: `events/{eventId}/materials/...`
 *   - The script loads the canonical event from Firestore: `events/{eventId}` to resolve:
 *       - title, start (date), location
 *       - ownerDocId (creator / owner of the event; falls back to first managerDocIds entry)
 *   - The script loads the member document: `members/{ownerDocId}` to resolve:
 *       - name, memberId, instructorId, contactEmail
 *   - The material is associated with and stored under `/members/{ownerDocId}/uploads/{uploadDocId}`
 *
 * URLs & Previews:
 *   - Retrieves `firebaseStorageDownloadTokens` from Cloud Storage object metadata.
 *   - Generates and persists valid tokenized download URLs for both `url` (original) and
 *     `previewUrl` (320px thumbnail preview) so that browsers can display them seamlessly.
 *
 * Idempotent: safe to run multiple times. If an upload document with the same
 * `storagePath` already exists, it verifies and refreshes missing download tokens.
 *
 * Usage:
 *   # Dry run (default): scan and report without writing:
 *   pnpm run backfill:event-materials
 *
 *   # Commit: write missing upload documents and update tokenized URLs in Firestore:
 *   pnpm run backfill:event-materials --commit
 *
 *   # Specify project:
 *   pnpm run backfill:event-materials --project=<project-id> --commit
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UploadItem } from '../functions/src/data-model';

const COMMIT = process.argv.includes('--commit');
const DEFAULT_PROJECT = 'ilc-paris-class-tracker';
const projectArg = process.argv.find((a) => a.startsWith('--project='));
const PROJECT_ID = projectArg ? projectArg.split('=')[1] : DEFAULT_PROJECT;
const bucketArg = process.argv.find((a) => a.startsWith('--bucket='));
const BUCKET_NAME = bucketArg ? bucketArg.split('=')[1] : `${PROJECT_ID}.firebasestorage.app`;

async function getFileDownloadUrl(file: ReturnType<typeof admin.storage.prototype.bucket>['file']): Promise<{
  url: string;
  token: string;
  metadata: any;
}> {
  const [meta] = await file.getMetadata().catch(() => [null]);
  if (!meta) {
    return { url: '', token: '', metadata: {} };
  }

  let token = meta.metadata?.['firebaseStorageDownloadTokens'];
  if (!token) {
    token = crypto.randomUUID();
    if (COMMIT) {
      await file.setMetadata({
        metadata: {
          ...(meta.metadata || {}),
          firebaseStorageDownloadTokens: token,
        },
      });
    }
  }

  const url = `https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`;
  return { url, token, metadata: meta };
}

async function main() {
  console.log('====================================================');
  console.log('  Backfill Event Materials to Members Uploads');
  console.log('====================================================');
  console.log(`Using Project: ${PROJECT_ID}`);
  console.log(`Using Storage Bucket: ${BUCKET_NAME}`);
  console.log(COMMIT ? 'MODE: COMMIT (writes enabled)' : 'MODE: DRY RUN (no writes will be made)');
  console.log('----------------------------------------------------');

  admin.initializeApp({
    projectId: PROJECT_ID,
    storageBucket: BUCKET_NAME,
  });

  const db = admin.firestore();
  const bucket = admin.storage().bucket(BUCKET_NAME);

  // 1. Fetch all events from Firestore for fast lookup
  console.log('Fetching events from Firestore...');
  const eventsSnap = await db.collection('events').get();
  console.log(`Found ${eventsSnap.size} total events in Firestore.`);

  const eventMap = new Map<string, FirebaseFirestore.DocumentData>();
  for (const doc of eventsSnap.docs) {
    eventMap.set(doc.id, doc.data());
  }

  // 2. Cache members for owner/creator details
  const memberCache = new Map<string, FirebaseFirestore.DocumentData>();
  async function getMemberData(memberDocId: string) {
    if (!memberDocId) return null;
    if (memberCache.has(memberDocId)) {
      return memberCache.get(memberDocId)!;
    }
    const snap = await db.collection('members').doc(memberDocId).get();
    const data = snap.exists ? snap.data() || null : null;
    if (data) memberCache.set(memberDocId, data);
    return data;
  }

  // 3. Scan Storage for all files under prefix `events/`
  console.log('Scanning Cloud Storage bucket for event materials...');
  let files: ReturnType<typeof bucket.file>[];
  try {
    const [retrievedFiles] = await bucket.getFiles({ prefix: 'events/' });
    files = retrievedFiles;
  } catch (err) {
    console.error('Failed to list files from Cloud Storage bucket:', err);
    process.exit(1);
  }

  console.log(`Found ${files.length} total file objects under "events/".`);

  // Group files by eventId and folder
  // Storage structure:
  //   events/{eventId}/materials/originals/{folder}/original
  //   events/{eventId}/materials/previews/{folder}.jpg
  const materialRegex = /^events\/([^/]+)\/materials\/originals\/([^/]+)\/(.+)$/;
  const previewRegex = /^events\/([^/]+)\/materials\/previews\/([^/]+)\.jpg$/;

  const eventMaterials = new Map<string, Map<string, { originalPath: string; previewPath?: string }>>();

  for (const file of files) {
    const origMatch = file.name.match(materialRegex);
    if (origMatch) {
      const [, eventId, folderKey] = origMatch;
      if (!eventMaterials.has(eventId)) {
        eventMaterials.set(eventId, new Map());
      }
      const eventItems = eventMaterials.get(eventId)!;
      const existing = eventItems.get(folderKey) || { originalPath: file.name };
      existing.originalPath = file.name;
      eventItems.set(folderKey, existing);
      continue;
    }

    const prevMatch = file.name.match(previewRegex);
    if (prevMatch) {
      const [, eventId, folderKey] = prevMatch;
      if (!eventMaterials.has(eventId)) {
        eventMaterials.set(eventId, new Map());
      }
      const eventItems = eventMaterials.get(eventId)!;
      const existing = eventItems.get(folderKey) || { originalPath: '' };
      existing.previewPath = file.name;
      eventItems.set(folderKey, existing);
    }
  }

  console.log(`Found ${eventMaterials.size} event(s) containing uploaded materials in Storage.`);

  let totalMaterialsFound = 0;
  let totalAlreadyIndexed = 0;
  let totalUpdated = 0;
  let totalBackfilled = 0;
  let totalSkippedNoOwner = 0;

  for (const [eventId, items] of eventMaterials.entries()) {
    const eventData = eventMap.get(eventId);
    const eventTitle = (eventData?.['title'] as string) || `Event ${eventId}`;
    const eventDate = (eventData?.['start'] as string) || '';
    const dateFormatted = eventDate ? eventDate.split('T')[0] : '';
    const location = (eventData?.['location'] as string) || '';

    // Determine the creator/owner of the event
    const ownerDocId =
      (eventData?.['ownerDocId'] as string) ||
      (Array.isArray(eventData?.['managerDocIds']) && eventData?.['managerDocIds'][0]) ||
      '';

    if (!ownerDocId) {
      console.warn(`[SKIP] Event ${eventId} ("${eventTitle}") has no ownerDocId or managerDocIds. Skipping ${items.size} file(s).`);
      totalSkippedNoOwner += items.size;
      totalMaterialsFound += items.size;
      continue;
    }

    // Resolve creator's member record
    const memberData = await getMemberData(ownerDocId);
    const memberName = memberData?.['name'] || (eventData?.['ownerName'] as string) || 'Unknown Name';
    const memberEmail =
      memberData?.['email'] ||
      memberData?.['contactEmail'] ||
      (Array.isArray(eventData?.['ownerEmails']) && eventData?.['ownerEmails'][0]) ||
      'No email on record';
    const memberId = memberData?.['memberId'] || (eventData?.['ownerMemberId'] as string) || 'N/A';
    const instructorId = memberData?.['instructorId'] || (eventData?.['ownerInstructorId'] as string) || '';

    // Check existing uploads in the member's subcollection by storagePath
    const existingUploadsSnap = await db
      .collection('members')
      .doc(ownerDocId)
      .collection('uploads')
      .where('eventDocId', '==', eventId)
      .get();

    const existingDocsByStoragePath = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const doc of existingUploadsSnap.docs) {
      const data = doc.data();
      if (data['storagePath']) {
        existingDocsByStoragePath.set(data['storagePath'], doc);
      }
    }

    console.log(`\n----------------------------------------------------`);
    console.log(`Event: "${eventTitle}" (ID: ${eventId})`);
    console.log(`  Date: ${dateFormatted || 'None'} | Location: ${location || 'None'}`);
    console.log(`  Creator / Owner: ${memberName} <${memberEmail}>`);
    console.log(`  Member ID: ${memberId} | Instructor ID: ${instructorId || 'None'} | Member DocId: ${ownerDocId}`);
    console.log(`  Target Subcollection: /members/${ownerDocId}/uploads/`);
    console.log(`  Found ${items.size} material file(s) in Storage for this event:`);

    for (const [folderKey, paths] of items.entries()) {
      totalMaterialsFound++;
      if (!paths.originalPath) continue;

      // 1. Resolve original file download URL and metadata
      const origFile = bucket.file(paths.originalPath);
      const { url: origUrl, metadata } = await getFileDownloadUrl(origFile);

      // 2. Resolve preview file download URL
      let previewUrl = '';
      if (paths.previewPath) {
        const previewFile = bucket.file(paths.previewPath);
        const prevRes = await getFileDownloadUrl(previewFile);
        previewUrl = prevRes.url;
      }

      const customName = metadata.metadata?.['name'] || origFile.name.split('/').pop() || folderKey;
      const contentType = metadata.contentType || 'application/octet-stream';
      const size = Number(metadata.size) || 0;
      const sizeStr =
        size > 1024 * 1024
          ? `${(size / (1024 * 1024)).toFixed(2)} MB`
          : `${(size / 1024).toFixed(1)} KB`;
      const createdAt = metadata.timeCreated || new Date().toISOString();
      const lastUpdated = metadata.updated || createdAt;
      const itemDate = dateFormatted || createdAt.split('T')[0];

      // Check if already indexed in Firestore
      const existingDoc = existingDocsByStoragePath.get(paths.originalPath);
      if (existingDoc) {
        const data = existingDoc.data();
        const needsUrlUpdate = (!data['url']?.includes('token=') && origUrl.includes('token=')) ||
                               (previewUrl && (!data['previewUrl']?.includes('token=') && previewUrl.includes('token=')));

        if (needsUrlUpdate) {
          console.log(`    ${COMMIT ? '[UPDATE TOKENS]' : '[PLAN UPDATE TOKENS]'} "${customName}" (DocId: ${existingDoc.id})`);
          console.log(`           URL:        ${origUrl}`);
          console.log(`           PreviewURL: ${previewUrl}`);

          if (COMMIT) {
            await existingDoc.ref.update({
              url: origUrl,
              previewUrl,
              lastUpdated: new Date().toISOString(),
            });
          }
          totalUpdated++;
        } else {
          console.log(`    [ALREADY INDEXED & VALID] "${customName}" (DocId: ${existingDoc.id})`);
          console.log(`           PreviewURL: ${data['previewUrl'] ? 'OK (Tokenized)' : '(None)'}`);
        }
        totalAlreadyIndexed++;
        continue;
      }

      const uploadItemPayload: Omit<UploadItem, 'docId'> = {
        memberDocId: ownerDocId,
        memberId: memberId === 'N/A' ? '' : memberId,
        memberName,
        instructorId,
        name: customName,
        contentType,
        size,
        url: origUrl,
        previewUrl,
        storagePath: paths.originalPath,
        previewStoragePath: paths.previewPath || '',
        date: itemDate,
        location,
        eventDocId: eventId,
        eventTitle,
        notes: '',
        tags: [],
        source: 'event',
        createdAt,
        lastUpdated,
      };

      console.log(`    ${COMMIT ? '[WRITE]' : '[PLAN]'} "${customName}"`);
      console.log(`           Type: ${contentType} | Size: ${sizeStr} | Item Date: ${itemDate}`);
      console.log(`           Storage Path: ${paths.originalPath}`);
      console.log(`           Thumbnail:    ${paths.previewPath ? previewUrl : '(none)'}`);

      if (COMMIT) {
        await db
          .collection('members')
          .doc(ownerDocId)
          .collection('uploads')
          .add(uploadItemPayload);
      }

      totalBackfilled++;
    }
  }

  console.log('----------------------------------------------------');
  console.log('Summary:');
  console.log(`  Total material items discovered in Storage: ${totalMaterialsFound}`);
  console.log(`  Already indexed in Firestore uploads:       ${totalAlreadyIndexed}`);
  console.log(`  Updated tokenized URLs:                    ${totalUpdated}`);
  console.log(`  Skipped (no owner member docId found):     ${totalSkippedNoOwner}`);
  console.log(`  ${COMMIT ? 'Successfully backfilled:' : 'Would backfill (dry run):'}           ${totalBackfilled}`);
  console.log('====================================================');
  if (!COMMIT && (totalBackfilled > 0 || totalUpdated > 0)) {
    console.log('To apply these changes, re-run with `--commit`.');
  }
}

main().catch((err) => {
  console.error('Fatal error during backfill:', err);
  process.exit(1);
});
