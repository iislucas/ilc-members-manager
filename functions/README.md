# Functions directory for server side code

Google Cloud Project APIs that need to be enabled: 

 * [Secret Manager](https://console.developers.google.com/apis/api/secretmanager.googleapis.com/overview).
 * [Calendar](https://console.cloud.google.com/marketplace/product/google/calendar-json.googleapis.com)

## Getting setup

Login to Google Cloud SDK:

```sh
gcloud auth login
```

```sh
export PROJECT=
gcloud config set project ${PROJECT}
gcloud auth application-default set-quota-project ${PROJECT}
```

Login to Firebase:

```sh
firebase login
firebase use --add # and then select your project
```

## API Key Secrets

See [Secret Manager](https://console.developers.google.com/apis/api/secretmanager.googleapis.com/overview).

Set the calendar API key by running the command
```sh
firebase functions:secrets:set GOOGLE_CALENDAR_API_KEY
# You will then be asked to enter the API key secret, do that.

# You can preview/get the secret with
gcloud secrets versions access 1 --secret=GOOGLE_CALENDAR_API_KEY
```