import * as admin from 'firebase-admin';

async function main() {
  admin.initializeApp();
  const db = admin.firestore();
  const snap = await db.collection('orders').limit(5).get();
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`Order ${doc.id}: lastUpdated type is ${typeof data.lastUpdated}, value=${data.lastUpdated}`);
    if (data.lastUpdated && typeof data.lastUpdated === 'object') {
      console.log(`  Is Timestamp? ${data.lastUpdated instanceof admin.firestore.Timestamp}`);
    }
  });
}

main().catch(console.error);
