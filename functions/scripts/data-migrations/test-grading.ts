import * as admin from 'firebase-admin';
import { processGradingOrder } from '../../src/squarespace-orders';

admin.initializeApp({ projectId: 'ilc-paris-class-tracker' });
const db = admin.firestore();

async function main() {
  const orderId = '699b9753b4562909908cae78';
  const orderDoc = await db.collection('orders').doc(orderId).get();

  if (!orderDoc.exists) {
    console.error(`Order ${orderId} not found`);
    process.exit(1);
  }

  const orderData = orderDoc.data();
  console.log(`Loaded order ${orderId}`);

  const lineItems = orderData?.lineItems || [];
  const gradingItems = lineItems.filter((item: any) => {
    const title = item.productName || item.title || '';
    return title.toLowerCase().includes('grading');
  });

  console.log(`Found ${gradingItems.length} grading items in order.`);

  for (const gradingItem of gradingItems) {
    console.log(`Processing grading item: ${gradingItem.productName}`);
    await processGradingOrder(orderData, orderId, gradingItem, db);
  }

  console.log('Done!');
  process.exit(0);
}

main().catch(console.error);
