import { onCall, HttpsError } from 'firebase-functions/v2/https';
import axios from 'axios';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { allowedOrigins, getMemberByEmail } from './common';

// TODO: Replace with the actual Squarespace site URL when available or use an environment variable.
// For now using a placeholder that clearly indicates it needs to be set.
const SQUARESPACE_BASE_URL = 'https://lute-denim-99n2.squarespace.com';

enum AccessLevel {
    Member = 'member',
    Instructor = 'instructor',
}

// Mapping of paths to their respective Squarespace page passwords
const accessLevels: Record<string, AccessLevel> = {
    '/membersareablog': AccessLevel.Member,
    '/instructorsareablog': AccessLevel.Instructor,
};

// Mapping of paths to their respective Squarespace page passwords
const PAGE_PASSWORDS: Record<string, string> = {
    // '/members-area': 'FQ8GoyeJ3MSchz1WkIUs',
    // '/instructorsareablog': 'np3PWptlU14bKA1eRF1v0',
};

interface SquarespaceContentRequest {
    path: string;
}

export const getSquarespaceContent = onCall<SquarespaceContentRequest>(
    { cors: allowedOrigins }, // Enable CORS for all origins
    async (request) => {
        const { path } = request.data;
        if (!path) {
            throw new HttpsError('invalid-argument', 'The function must be called with a "path" argument.');
        }

        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        const requiredAccessLevel = accessLevels[cleanPath];

        if (requiredAccessLevel) {
            if (!request.auth || !request.auth.token.email) {
                throw new HttpsError('unauthenticated', 'You must be logged in to access this content.');
            }

            const db = admin.firestore();
            try {
                const member = await getMemberByEmail(request.auth.token.email, db);

                if (requiredAccessLevel === AccessLevel.Instructor) {
                    if (!member.instructorId) {
                        throw new HttpsError('permission-denied', 'Only instructors can access this content.');
                    }
                    if (member.instructorLicenseExpires && new Date(member.instructorLicenseExpires) < new Date()) {
                        throw new HttpsError('permission-denied', 'Instructor license expired.');
                    }
                } else if (requiredAccessLevel === AccessLevel.Member) {
                    const nonExpiringTypes = ['Life', 'LifeByPartner'];
                    let isActive = false;
                    if (nonExpiringTypes.includes(member.membershipType)) {
                        isActive = true;
                    } else if (member.membershipType !== 'Inactive' && member.membershipType !== 'Deceased') {
                        if (member.currentMembershipExpires && new Date(member.currentMembershipExpires) > new Date()) {
                            isActive = true;
                        }
                    }
                    if (!isActive) {
                        throw new HttpsError('permission-denied', 'Active membership required.');
                    }
                }
            } catch (error: any) {
                if (error instanceof Error && error.message === 'Member not found') {
                    throw new HttpsError('permission-denied', 'You do not have access to this content.');
                }
                throw error;
            }
        }

        const password = PAGE_PASSWORDS[path];

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
