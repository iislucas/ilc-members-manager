/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import axios from 'axios';
import { defineSecret } from 'firebase-functions/params';
import { environment } from './environment/environment';
import { CalendarRequest, GoogleCalendarResponse } from './calendar.types';

const calendarApiKey = defineSecret('GOOGLE_CALENDAR_API_KEY');

const allowedOrigins = environment.domains;
if (process.env.GCLOUD_PROJECT) {
  allowedOrigins.push(`https://${process.env.GCLOUD_PROJECT}.web.app`);
}

/**
 * Fetches events from a public Google Calendar.
 * This is a callable function that can be invoked from a client app.
 *
 * @param {{calendarId: string}} data - The data passed to the function.
 * @param {string} data.calendarId - The ID of the Google Calendar to fetch events from.
 * @returns {Promise<GoogleCalendarResponse>} A promise that resolves with the calendar events from the Google API.
 * @throws {HttpsError} Throws an error if:
 *  - The API key is not configured ('failed-precondition').
 *  - The calendarId is missing or invalid ('invalid-argument').
 *  - There's an error fetching data from the Google Calendar API ('internal' or 'unknown').
 */
export const getCalendarEvents = onCall(
  { secrets: [calendarApiKey], cors: allowedOrigins },
  async (request) => {
    logger.info('getCalendarEvents called with data:', request.data);

    // 1. API Key Validation (Best Practice)
    // Ensures the function is properly configured before proceeding.
    if (!calendarApiKey.value()) {
      logger.error('Google Calendar API key is not configured.');
      throw new HttpsError(
        'failed-precondition',
        'The function is not configured correctly. Please contact the administrator.'
      );
    }

    // 2. Input Validation (Error Handling & Best Practice)
    // Validates the presence and type of the required `calendarId`.
    if (
      !request.data ||
      typeof request.data.calendarId !== 'string' ||
      !request.data.calendarId
    ) {
      logger.warn('Missing or invalid calendarId parameter.', {
        data: request.data,
      });
      throw new HttpsError(
        'invalid-argument',
        'The function must be called with a "calendarId" argument.'
      );
    }

    // 3. Parameter Destructuring with Defaults (Readability & Maintainability)
    // Extracts all possible arguments from the request data, providing
    // sensible defaults for optional parameters. This makes the code cleaner
    // and more robust against missing inputs.
    const {
      calendarId,
      q,
      singleEvents = true,
      orderBy = 'startTime',
      timeMin = new Date().toISOString(),
      timeMax,
      maxResults = 100,
    } = request.data as CalendarRequest;

    // 4. Dynamic Parameter Handling (Best Practice & Maintainability)
    // Prepares parameters for the API request. Using a params object with
    // axios is safer as it handles URL encoding automatically, preventing
    // injection vulnerabilities and formatting errors.
    const params: Record<string, any> = {
      key: calendarApiKey.value(),
      singleEvents,
      orderBy,
      timeMin,
      maxResults,
    };

    if (q) {
      params.q = q;
    }
    if (timeMax) {
      params.timeMax = timeMax;
    }

    const calendarApiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events`;

    try {
      logger.info('Calling Google Calendar API.', {
        url: calendarApiUrl,
        params,
      });

      // 5. Typed API Call (Performance & Best Practice)
      // Making a typed request with `axios.get<GoogleCalendarResponse>` improves
      // type safety and autocompletion, reducing runtime errors.
      const googleResponse = await axios.get<GoogleCalendarResponse>(
        calendarApiUrl,
        { params }
      );
      logger.info('Successfully fetched calendar events.');
      return googleResponse.data as GoogleCalendarResponse;
    } catch (error) {
      // 6. Enhanced Error Handling (Error Handling & Edge Cases)
      // Provides more specific, actionable error messages for both logs and
      // the client, which is crucial for debugging and user experience.
      let errorMessage = 'An unexpected error occurred.';
      let errorCode: any = 'internal'; // Default to internal for server-side issues

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        logger.error('Axios error fetching calendar events from Google:', {
          message: error.message,
          status: status,
          data: error.response?.data,
        });

        if (status === 400) {
          errorMessage = 'Invalid request. Please check the parameters.';
          errorCode = 'invalid-argument';
        } else if (status === 404) {
          errorMessage = `Calendar with ID "${calendarId}" not found.`;
          errorCode = 'not-found';
        } else {
          errorMessage = 'Failed to fetch calendar events from Google.';
        }
      } else {
        logger.error('Unknown error fetching calendar events:', error);
      }

      throw new HttpsError(errorCode, errorMessage);
    }
  }
);

export { addAdmin, removeAdmin } from './admin';
