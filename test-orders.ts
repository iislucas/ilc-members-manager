import * as admin from 'firebase-admin';
admin.initializeApp({ projectId: 'ilc-members-manager-dev' });
const db = admin.firestore();
async function run() {
  const orders = await db.collection('orders').limit(10).get();
  orders.docs.forEach(d => console.log(JSON.stringify(d.data(), null, 2)));
}
run();
