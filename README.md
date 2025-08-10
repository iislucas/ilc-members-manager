# ILC Members Manager

The goal of this project is to provide a simple Angular web application to
manage the status of ILC memberships. There are 3 kinds of users:

* **ILC Admins**: Can make arbitrary changes to anyone's status, as well as add
  country managers.

* **ILC Country Managers**: Can manage the status of all students within their
  country (but not themselves).

* **ILC practitioners**: should be able to use their registerd email address to
  see the status of their data, and request deletion.

The application should eventually support being a PWA (Progressive Web
Application) so it can be downloaded and saved on mobile devices, and used to
send notifications.

## Status

See the [STATUS.md](./STATUS.md) file for the latest status of the project, and
the TODOs. 

## Libraries used in this project

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.0.5.

## Install local dependencies

```bash
npm install
cd functions 
npm install
cd ..
```

## Development server

To start a local development server, run:

```bash
npm run start
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Environment configuration

This project uses environment files to manage configuration for different environments.

- **`src/environments/environment.local.ts`**: This is the base configuration file. It should contain the actual production keys and secrets. This file is included in `.gitignore` and should not be committed to the repository; it contains sensitive data, e.g. API keys.
- **`src/environments/environment.ts`**: This file serves as a template for creating new environment files.

When adding new environment variables, be sure to update both files accordingly.

### Server side envionment

Copy & fill out `functions/src/environments/environment.template.ts`, saving it as
`functions/src/environments/environment.ts`.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
npx ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
npx ng generate --help
```

## Building

To build the project run:

```bash
npm run build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
npm run test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
npm run start
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## Deployment

### Setup Cloud and Firebase project and auth

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

### Deploy

Deploy everything, functions and hosted web app:

```sh
npm run deploy
```

Deploy just the hosted web UI:

```sh
npm run deploy:hosting
```

Deploy just functions

```sh
npm run deploy:functions
```