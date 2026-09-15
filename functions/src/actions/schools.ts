/* schools.ts
 *
 * School domain actions for creating, managing, and inspecting ILC schools,
 * maintaining manager roles and atomic school ID counters.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreCollection } from '../data-model/collections';
import { School, initSchool, firestoreDocToSchool } from '../data-model/schools';
import { assignNextSchoolId } from '../counters';
import { ActionContext, ActionResult } from './types';

/** Parameters for creating a new school record. */
export interface CreateSchoolInput {
  schoolName: string;
  schoolCountry: string;
  schoolId?: string;
  schoolCity?: string;
  schoolAddress?: string;
  schoolZipCode?: string;
  schoolCountyOrState?: string;
  schoolWebsite?: string;
  ownerInstructorId?: string;
  ownerMemberDocId?: string;
  managerInstructorIds?: string[];
  publicBioMarkdown?: string;
  customDocId?: string;
}

/** Search/filter parameters for querying schools. */
export interface SchoolSearchOptions {
  searchTerm?: string;
  country?: string;
  managerInstructorId?: string;
  ownerInstructorId?: string;
  limitCount?: number;
}

/**
 * Retrieves a single school by document ID.
 */
export async function getSchool(
  ctx: ActionContext,
  schoolDocId: string,
): Promise<School | null> {
  if (!schoolDocId) return null;
  const docRef = ctx.db.collection(FirestoreCollection.Schools).doc(schoolDocId);
  const snap = await docRef.get();
  if (!snap.exists) return null;
  return firestoreDocToSchool(snap);
}

/**
 * Looks up a school by its ILC-issued school ID (e.g. 'SCH-100').
 */
export async function getSchoolBySchoolId(
  ctx: ActionContext,
  schoolId: string,
): Promise<School | null> {
  if (!schoolId) return null;
  const snap = await ctx.db
    .collection(FirestoreCollection.Schools)
    .where('schoolId', '==', schoolId.trim())
    .limit(1)
    .get();

  if (snap.empty) return null;
  return firestoreDocToSchool(snap.docs[0]);
}

/**
 * Lists schools with optional filtering.
 */
export async function listSchools(
  ctx: ActionContext,
  options?: SchoolSearchOptions,
): Promise<School[]> {
  let q = ctx.db.collection(FirestoreCollection.Schools).limit(options?.limitCount || 100);

  if (options?.country) {
    q = q.where('schoolCountry', '==', options.country);
  }
  if (options?.ownerInstructorId) {
    q = q.where('ownerInstructorId', '==', options.ownerInstructorId);
  }

  const snap = await q.get();
  let schools = snap.docs.map(firestoreDocToSchool);

  if (options?.managerInstructorId) {
    schools = schools.filter(
      (s) =>
        s.managerInstructorIds?.includes(options.managerInstructorId!) ||
        s.ownerInstructorId === options.managerInstructorId,
    );
  }

  if (options?.searchTerm) {
    const term = options.searchTerm.toLowerCase().trim();
    schools = schools.filter(
      (s) =>
        s.schoolName.toLowerCase().includes(term) ||
        s.schoolId.toLowerCase().includes(term) ||
        s.schoolCity.toLowerCase().includes(term) ||
        s.schoolCountry.toLowerCase().includes(term),
    );
  }

  return schools;
}

/**
 * Creates a new School record with atomic schoolId generation.
 */
export async function createSchool(
  ctx: ActionContext,
  input: CreateSchoolInput,
): Promise<ActionResult<School>> {
  if (!input.schoolName?.trim()) {
    return { success: false, error: 'School name is required.' };
  }
  if (!input.schoolCountry?.trim()) {
    return { success: false, error: 'School country is required.' };
  }

  let schoolId = input.schoolId?.trim();
  if (!schoolId) {
    if (ctx.dryRun) {
      schoolId = 'SCH-999_DRYRUN';
    } else {
      schoolId = await assignNextSchoolId(ctx.db);
    }
  }

  const nowIso = new Date().toISOString();
  const baseDefaults = initSchool();

  const newSchool: School = {
    ...baseDefaults,
    ...input,
    schoolId,
    schoolName: input.schoolName.trim(),
    schoolCountry: input.schoolCountry.trim(),
    managerInstructorIds: input.managerInstructorIds || [],
    lastUpdated: nowIso,
  };

  const colRef = ctx.db.collection(FirestoreCollection.Schools);
  const docRef = input.customDocId ? colRef.doc(input.customDocId) : colRef.doc();
  newSchool.docId = docRef.id;

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Created school: ${newSchool.schoolName} (${newSchool.schoolId}) at /schools/${docRef.id}`);
    return { success: true, data: newSchool, dryRun: true };
  }

  const payload = {
    ...newSchool,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete (payload as { docId?: string }).docId;

  await docRef.set(payload);
  ctx.logger?.(`Created school ${newSchool.schoolName} (${newSchool.schoolId}) with docId: ${docRef.id}`);

  return { success: true, data: newSchool };
}

/**
 * Updates an existing school document and handles schoolId renaming across members if changed.
 */
export async function updateSchool(
  ctx: ActionContext,
  schoolDocId: string,
  patch: Partial<School>,
): Promise<ActionResult<School>> {
  if (!schoolDocId) {
    return { success: false, error: 'schoolDocId is required.' };
  }

  const existing = await getSchool(ctx, schoolDocId);
  if (!existing) {
    return { success: false, error: `School with docId "${schoolDocId}" not found.` };
  }

  const updated: School = {
    ...existing,
    ...patch,
    docId: schoolDocId,
    lastUpdated: new Date().toISOString(),
  };

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Updated school ${schoolDocId}:`, patch);
    return { success: true, data: updated, dryRun: true };
  }

  const batch = ctx.db.batch();
  const schoolRef = ctx.db.collection(FirestoreCollection.Schools).doc(schoolDocId);

  const payload: Record<string, unknown> = {
    ...patch,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete payload['docId'];
  batch.set(schoolRef, payload, { merge: true });

  // If schoolId was changed, update all members pointing to the old schoolId
  if (patch.schoolId && patch.schoolId !== existing.schoolId) {
    const membersSnap = await ctx.db
      .collection(FirestoreCollection.Members)
      .where('primarySchoolId', '==', existing.schoolId)
      .get();

    for (const memberDoc of membersSnap.docs) {
      batch.update(memberDoc.ref, {
        primarySchoolId: patch.schoolId,
        lastUpdated: FieldValue.serverTimestamp(),
      });
    }
    ctx.logger?.(`Updated ${membersSnap.size} members pointing from old schoolId ${existing.schoolId} to ${patch.schoolId}`);
  }

  await batch.commit();
  ctx.logger?.(`Updated school ${existing.schoolName} (${schoolDocId})`);

  return { success: true, data: updated };
}

/**
 * Adds an instructor to the manager list of a school.
 */
export async function addSchoolManager(
  ctx: ActionContext,
  schoolDocId: string,
  instructorId: string,
): Promise<ActionResult<School>> {
  const school = await getSchool(ctx, schoolDocId);
  if (!school) {
    return { success: false, error: `School "${schoolDocId}" not found.` };
  }

  const cleanInstId = instructorId.trim();
  if (school.managerInstructorIds.includes(cleanInstId)) {
    return { success: true, data: school };
  }

  const updatedManagers = [...school.managerInstructorIds, cleanInstId];
  return updateSchool(ctx, schoolDocId, { managerInstructorIds: updatedManagers });
}

/**
 * Removes an instructor from the manager list of a school.
 */
export async function removeSchoolManager(
  ctx: ActionContext,
  schoolDocId: string,
  instructorId: string,
): Promise<ActionResult<School>> {
  const school = await getSchool(ctx, schoolDocId);
  if (!school) {
    return { success: false, error: `School "${schoolDocId}" not found.` };
  }

  const cleanInstId = instructorId.trim();
  const updatedManagers = school.managerInstructorIds.filter((id) => id !== cleanInstId);
  return updateSchool(ctx, schoolDocId, { managerInstructorIds: updatedManagers });
}

/**
 * Deletes a school document.
 */
export async function deleteSchool(
  ctx: ActionContext,
  schoolDocId: string,
): Promise<ActionResult<void>> {
  const school = await getSchool(ctx, schoolDocId);
  if (!school) {
    return { success: false, error: `School "${schoolDocId}" not found.` };
  }

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Deleted school ${schoolDocId} (${school.schoolName})`);
    return { success: true, dryRun: true };
  }

  await ctx.db.collection(FirestoreCollection.Schools).doc(schoolDocId).delete();
  ctx.logger?.(`Deleted school ${school.schoolName} (${schoolDocId})`);

  return { success: true };
}
