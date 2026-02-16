import { onCall, HttpsError } from 'firebase-functions/v2/https';
import axios from 'axios';
import * as logger from 'firebase-functions/logger';
import { allowedOrigins } from './common';

// TODO: Replace with the actual Squarespace site URL when available or use an environment variable.
// For now using a placeholder that clearly indicates it needs to be set.
const SQUARESPACE_BASE_URL = 'https://lute-denim-99n2.squarespace.com';

// Mapping of paths to their respective Squarespace page passwords
const PAGE_PASSWORDS: Record<string, string> = {
    '/members-area': 'FQ8GoyeJ3MSchz1WkIUs',
    '/instructors-area': 'np3PWptlU14bKA1eRF1v0',
};

interface SquarespaceContentRequest {
    path: string;
}

export const getSquarespaceContent = onCall<SquarespaceContentRequest>(
    { cors: allowedOrigins }, // Enable CORS for all origins
    async (request) => {
        // Basic authentication/authorization check could go here if needed in the future.
        // For now, we allow any callable request, but the frontend will handle role-based access control.

        const { path } = request.data;
        if (!path) {
            throw new HttpsError('invalid-argument', 'The function must be called with a "path" argument.');
        }

        const password = PAGE_PASSWORDS[path];

        // Ensure path starts with / to avoid malformed URLs
        const cleanPath = path.startsWith('/') ? path : `/${path}`;

        // Fetch content from Squarespace.
        // Using ?format=json to get the JSON representation of the page.
        // Documentation indicates ?password=YOUR_PASSWORD can bypass password protection.
        let targetUrl = `${SQUARESPACE_BASE_URL}${cleanPath}?format=json`;
        if (password) {
            targetUrl += `&password=${encodeURIComponent(password)}`;
        }

        logger.info(`Fetching Squarespace content from: ${targetUrl}`, { structuredData: true });

        try {
            const response = await axios.get(targetUrl);

            // Return the data. We might want to filter this down to just the 'mainContent' 
            // or whatever specific part of the JSON is needed to avoid sending too much data.
            // For now, sending back the whole response body gives the frontend maximum flexibility.
            return response.data;

        } catch (error: unknown) {
            logger.error('Error fetching from Squarespace', error);

            if (axios.isAxiosError(error)) {
                if (error.response) {
                    // The request was made and the server responded with a status code
                    // that falls out of the range of 2xx
                    throw new HttpsError('internal', `Squarespace returned error: ${error.response.status}`, error.response.data);
                } else if (error.request) {
                    // The request was made but no response was received
                    throw new HttpsError('unavailable', 'No response received from Squarespace.');
                }
            }

            throw new HttpsError('internal', 'Unable to fetch content.', (error as Error).message);
        }
    }
);
