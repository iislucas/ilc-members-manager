import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'fs';

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'ilc-paris-class-tracker-manager',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
    },
  });

  // Setup Admin, 2 Schools, 2 Members
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    
    // School A (Owned by Lucas)
    await adminDb.collection('schools').doc('schoolA').set({
      ownerEmail: 'moilucasdixon@gmail.com',
      managerEmails: []
    });

    // School B (Owned by someone else)
    await adminDb.collection('schools').doc('schoolB').set({
      ownerEmail: 'other@school.com',
      managerEmails: []
    });
    
    // Member in School A
    await adminDb.collection('members').doc('memberA').set({
      name: 'Student A',
      primarySchoolDocId: 'schoolA',
      lastUpdated: 'old'
    });

    // Member in School B
    await adminDb.collection('members').doc('memberB').set({
      name: 'Student B',
      primarySchoolDocId: 'schoolB',
      lastUpdated: 'old'
    });
  });

  // Lucas tries to edit
  const lucasAuth = testEnv.authenticatedContext('lucasId', {
    email: 'moilucasdixon@gmail.com'
  });
  const db = lucasAuth.firestore();

  try {
    const time = new Date().toISOString();
    await db.collection('members').doc('memberA').update({ lastUpdated: 'time' }); // Mock time match or let it fail on time?
    // Wait, the rule is request.resource.data.lastUpdated == request.time;
    // We can't easily mock request.time in simple dummy SDK updates without ServerValue.timestamp
  } catch (e: any) {
    console.log("Error:", e.message);
  }

  await testEnv.cleanup();
}
run();
