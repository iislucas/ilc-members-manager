# Squarespace Orders Polling

This directory contains information on how to configure continuous synchronization of Squarespace orders to integrate with our system. We use a Firebase Scheduled Function to poll the Squarespace Commerce API periodically for new or updated orders.

## Setup Instructions

1.  **Get a Squarespace Developer API Key**:
    This API key is used by the deployed Firebase function to fetch order details.
    - Go to your Squarespace Developer Settings > Developer API Keys.
    - Click "Generate Key".
    - Give it a name like "ILC Members Manager Webhooks".
    - Under Permissions, you must select **Orders**.
    - Copy the generated API Key.

2.  **Configure Firebase Environment Variables**:
    You must configure the Firebase environment with the API Key so the cloud function can access it securely.

    ```bash
    firebase functions:secrets:set SQUARESPACE_API_KEY
    # Now enter your API key when prompted, and hit return.
    ```

3.  **Deploy the Cloud Functions**:
    Once the key is set, deploy the updated Cloud Functions:

    ```bash
    pnpm run deploy:functions
    ```

    The `syncSquarespaceOrders` function will be created and will run automatically on its schedule (every 15 minutes).

## How it works for the Class Video Library

When a user purchases the "online class video library" subscription:

1. The Firebase scheduled function runs every 15 minutes.
2. It fetches the `lastSyncTimestamp` from the `system/squarespaceSync` Firestore document. Be default, it goes back 30 days.
3. It uses the `SQUARESPACE_API_KEY` to query the Orders API for any orders that have been updated since that timestamp via `modifiedAfter`.
4. It iterates over the fetched orders and checks their line items to verify if the "online class video library" was purchased.
5. It looks in the custom checkout form fields for a `Member ID`.
6. If a Member ID is found, it updates that member's document in Firestore (`classVideoLibrarySubscription: true`).
7. If no Member ID is found, it falls back to looking up the member by the purchaser's email address.
8. It records the latest `modifiedOn` date seen across the fetched orders and updates `systemInfo/squarespaceSync` to ensure the next run only pulls newly updated orders.
