# Projct Status and Task Tracking

This file is intended for people and AIs to track the TODOs of the project,
flesh them out and continue working on in progress ones.

See the [README.md](./README.md) for details of what this project's goals are.

## Formatting instructions

Milestones and TODOs should be formatted in this way:

```md
### \[PRIORITY\]: Milestone Descriptive Short title

Longer description of the milestone, and then TODOs within it.

#### \[STATUS\]: TODO Descriptive Short title

- List/Longer description of what needs to be done.
```

Where `STATUS` is one of: `Completed (github ID of person responsible for it)`,
`In Progress (github ID of person doing it)`, or `To Do`; and `PRIORITY` is one
of `P0` (current target, key features), `P1` (next target, good to have next),
`P2` (dreams for stuff after the others).

---

## TODOs

### \[P0\]: Basic Membership Management

The goal of this milestone is to support basic member management by ILC HQ, so
they can manage instructors and members, e.g for those who may not pay on the
SquareSpace site, and therefore need other means of managing their information.

#### \[Completed(iislucas)\]: Basic Membership Management and admin UI

- Implemented a basic admin UI for membership management.
- Admins can now:
  - View a list of all members.
  - Create new members.
  - View individual member details using the `member-view` component.
  - Edit existing member information using the `member-edit` component.
- This covers the core CRUD (Create, Read, Update, Delete) operations for members.
- Defined the Firebase security policy and data structures (admins can edit everything, and are controlled by the isAdmin property, non-admins can only view their single record - the one that matches the email they are logged in with).

#### \[To Do\]: Synchronisation with SquareSpace orders

- Provide an automatic every 6 hours synchronisation with SquareSpace so that
  people's status is updated.

- Provide a manual way to synchronise with SquareSpace.

#### \[In Progress()(iislucas)\]: Find an Instructor View & WebComponent

- Provide a standalone web-component that can be embeded into a SquareSpace
  site. This should provide the ability to search and browse the licensed
  Instructors. This will probably involve:
  - A function that gets all instructors (consider if it's worth caching the
    query to be efficient)
  - A world-map view, maybe a google map, with all instructors shown.
  - There are likely not that many instructors, so probably all search can be
    client side.
  - It might make sense for this to be in a separte repo, like:
    https://github.com/iislucas/google-cal-events-viewer

#### \[In Progress()(iislucas)\]: Backup to sheets/CSV just in case

- Provide a way to backup the data to a google-sheet or download a CSV of the
  current state. Also save monthly backups to a cloud bucket.

---

### \[P1\]: General Membership Management for ILC

Make the application into something that schools/country managers can also use
to manage their information. Website only still at this point.

#### \[To Do\]: Support Country Managers manage their country & activity feed

- Allow country managers to manage all people in their country. All changes
  should populate an activity feed that ILC HQ can see. (ILC HQ changes should
  also be recorded here). Maybe back this up to bigquery or end emails.

#### \[To Do\]: Implement Activity Logging

- Create a basic activity feed that logs all membership changes (creations, updates, deletions).
- This log should be viewable by admins to track modifications.
- Consider the storage mechanism for this activity log (e.g., separate Firestore collection, email notifications) to ensure data integrity and potential recovery.

#### \[To Do\]: Instructors can manage their own publicly listed info

- Instructors, when they login, can update their publicly listed information
  (mostly their address, and links to websites; they can't change/choose their
  level)

---

### \[P2\]: End-user Progressive WebApp & other nice stuff

#### \[To Do\]: Support people viewing and updating their public information

- Non-country managers should be able to update their own information.

#### \[To Do\]: Make the WebApp into a Progressive WebApp

- Ensure that it can be downloaded and installed on Android and iOS devices, and
  provide all functionality above.

#### \[To Do\]: Implement a calendar viewer for events and workshops

- See the github: [iislucas/](github.com/iislucas/google-cal-events-viewer), and
  pull in this code into this project, and adapt it so that within the members
  app, people can get notifiations about events they are interested in.

#### \[To Do\]: Basic End user utility

- Any ILC member can see their own information - this can act like a minimal
  version of a "digital" passport, to see their level, and date of renewal. They
  can also delete/remove/update relevant parts they can control (e.g. update
  their contact information, but not ILC level, which can be done by country
  managers or HQ only).

#### \[To Do\]: Passbook information functionality

- Support having a photo (viewable by the participant, and the ILC HQ).

- Support recording of attending a workshop/retreat & get a digital signature

- Optionally Supprt, per country/school preference, recording of attending
  classes. See:

#### \[To Do\]: Fun social / other stuff

- (optionally) Allow people to be listed as a ILC practioner publicly. So that
  people can find others in an area more easily.

- Allow registration for workshops in the app.
