import * as admin from 'firebase-admin';

async function main() {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'ilc-membership-manager' });
  const db = admin.firestore();
  
  const snap1 = await db.collection('orders').where('ilcAppOrderKind', '==', 'ilc-2005-sheets-db-import').limit(5).get();
  console.log('--- SHEET IMPORTS ---');
  snap1.forEach(doc => {
    const data = doc.data();
    console.log(`Order ${doc.id}: lastUpdated type is ${typeof data.lastUpdated}, value=${data.lastUpdated}`);
  });

  const snap2 = await db.collection('orders').where('ilcAppOrderKind', '==', 'https://api.squarespace.com/1.0/commerce/orders').limit(5).get();
  console.log('--- SQUARESPACE ORDERS ---');
  snap2.forEach(doc => {
    const data = doc.data();
    console.log(`Order ${doc.id}: lastUpdated type is ${typeof data.lastUpdated}, value=${data.lastUpdated}`);
  });
}

main().catch(console.error);
