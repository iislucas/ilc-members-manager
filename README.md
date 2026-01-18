# ILC Members Manager

The goal of this project is to provide a simple Angular web application to
manage the status of ILC memberships. There are 3 kinds of users:

- **ILC Admins**: Can make arbitrary changes to anyone's status, as well as add
  country managers.

- **ILC School Managers**: Can manage the status of all students within their
  school (but not themselves).

- **ILC Country Managers**: Can manage the status of all students within their
  country (but not themselves).

- **ILC practitioners**: should be able to use their registerd email address to
  see the status of their data, and request deletion.

The application should eventually support being a PWA (Progressive Web
Application) so it can be downloaded and saved on mobile devices, and used to
send notifications.

## Status

See the [STATUS.md](./STATUS.md) file for the latest status of the project, and
the TODOs.

## Install local dependencies & get a dev setup

This project was generated using [Angular
CLI](https://github.com/angular/angular-cli) version 20.0.5.

```bash
pnpm install
cd functions
pnpm install
cd ..
```

### Environment configuration

This project uses environment files to manage configuration for different environments.

- **`src/environments/environment.local.ts`**: This is the base configuration file. It should contain the actual production keys and secrets. This file is included in `.gitignore` and should not be committed to the repository; it contains sensitive data, e.g. API keys.
- **`src/environments/environment.ts`**: This file serves as a template for creating new environment files.

When adding new environment variables, be sure to update both files accordingly.

### Server side envionment

Copy & fill out `functions/src/environments/environment.template.ts`, saving it as
`functions/src/environments/environment.ts`.

## How to Code on this project

Make sure to see the AI context doc [.gemini/GEMINI.md](./.gemini/GEMINI.md] for
details of the tech stack and coding style.

### Development server

To start a local development server, run:

```bash
pnpm start
```

Once the server is running, open your browser and navigate to
`http://localhost:4200/`. The application will automatically reload whenever you
modify any of the source files.

### The core data structures

See [./functions/src/data-model.ts](./functions/src/data-model.ts) for the core
data structures.

### Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
pnpm ng generate component component-name --project ilc-members-manager
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
pnpm ng generate --help
```

### Building

To build the project run:

```bash
pnpm build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

### Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
pnpm test
```

### Firestore indexes

To download the firebase/firestore indexes locally (useful when you used the
web-ui to update/add a rule, and now want it locally):

```sh
firebase firestore:indexes > firestore.indexes.json
```

### AI-assisted Development

This project can be worked on with AI assistants, like Gemini. To provide the
AI with the necessary context, point it to the `.gemini/GEMINI.md` file, which
contains the project's tech stack, coding style, and other relevant information.

### Additional Angular Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## Deployment

### Setup Cloud and Firebase project and auth

Login to Google Cloud SDK:

```sh
gcloud auth login
```

Set project, application default credentials, Login to Firebase:

```sh
export PROJECT= # ... YOUR PROJECT NAME ...
gcloud config set project ${PROJECT}
gcloud auth application-default login
firebase login
# and then select your project
firebase use --add
# and then select your project
firebase use --add
```

### Deploy

Deploy everything, functions and hosted web app:

```sh
pnpm deploy
```

Deploy just the hosted web UI:

```sh
pnpm deploy:hosting
```

Deploy just functions

```sh
pnpm deploy:functions
```

Deploy just firebase rules

```sh
pnpm deploy:firestore-rules
```

#### Deploying the Find an Instructor web-component

```sh
# Build the web-component files
pnpm build:wc
# Set the cloud bucket name/path
CLOUD_BUCKET_NAME_AND_PATH= # .. Cloud bucket name and path....
# Copy files to the cloud bucket.
gcloud storage cp -R ./dist/find-an-instructor-wc/browser/* \
  gs://${CLOUD_BUCKET_NAME_AND_PATH}
```
