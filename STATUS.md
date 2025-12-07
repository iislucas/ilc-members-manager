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

#### \[In Progress(couchfault)\]: Synchronisation with SquareSpace orders

- Provide an automatic, e.g. every 6 hours synchronisation, with SquareSpace so
  that people's status is updated. Altenatively (better), use webhook from
  orders. Initial thing is: whenever an order comes in, update the
  membership/license end date, and most recent renewal date in the firestore
  database appropriately (add a year to current timing, or 1 year from current
  date, whichever is the latest)
- Provide a manual way to synchronise with SquareSpace?
- When an order comes in for an instructuor license, we'd like to wait for
  fulfilment, and once that happens, we'd like to add them to the members area
  for instructors.

#### \[Completed(iislucas)\]: Find an Instructor View & WebComponent

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
- Create a dedicated firebase/firestore collection for getting instructors that
  also only returns the relevant to be public parts. Also make a dedicated
  mini-service for finding instructors.
- Configure and make live on the site.

#### \[In Progress(iislucas)\]: Backup to sheets/CSV just in case

- DONE: Provide a way to backup the data to a google-sheet or download a CSV of the
  current state. Also save monthly backups to a cloud bucket.
- TODO: Have periodic backups to cloud stoage, just in case.

#### \[In Progress(couchfault)\]: Import the real data

- Develop a way to import the current real data, from CSV/sheets/wherever into
  the webapp.

---

### \[P1\]: General schools/Membership management

#### \[Completed(iislucas)\]: School Managers

Make the application into something that schools/country managers can also use
to manage their information. Website only still at this point.

- Manage schools, edit basic values, select/set the owner and other managers who
  can manage the school.
- Each member can optionally belong to a school. When a member belongs to a
  school, they can be managed by any manger or owner of the school.
- Admins can use school-ID to search members also.
- Short term: country manager are just added as managers for every school they
  can manage.

#### \[Completed(iislucas)\]: School owners/members can manage appropriate information

- Members can self-update the relevant parts of their own information: ['name',
  'instructorWebsite', 'publicRegionOrCity', 'publicEmail', 'publicPhone',
  'address', 'zipCode', 'country', 'phone', 'email', 'gender', 'dateOfBirth',
  'sifuMemberId']
- School managers/owners can udpate members in their schools, like members can
  as well as the fields: ['membershipType', 'firstMembershipStarted',
  'lastRenewalDate', 'currentMembershipExpires', 'instructorLicenseExpires',
  'studentLevel', and 'applicationLevel'].

#### \[Completed(iislucas)\]: Manage global IDs for instructors & members

- Admins should not need to figure out the next IDs for instructors, members,
  and schools.

#### \[In Progress(iislucas)\]: Implement Activity Logging

- Create a basic activity feed that logs all membership changes (creations,
  updates, deletions).
- This log should be viewable by admins to track modifications.
- Consider the storage mechanism for this activity log (e.g., separate Firestore
  collection, email notifications) to ensure data integrity and potential
  recovery.

#### \[In Progress(iislucas)\]: Some admin tools / general managment

Make a admin global settings page.

- Should show missing member IDs (search for members with a member ID
  that don't also have a exact next sequential next member ID)
- DONE: Show and edit next ID numbers
- A tab to show all admins, so it's quick and easy to see them.
- A page to show (and search) all school owners and managers, and what they
  manage.
- Show countries and country codes
- Show student, application, and master levels

---

### \[P2\]: End-user Progressive WebApp & other nice stuff

- Business logic for gradings
- Support viewing/analytics for orders

#### \[To Do\]: Provide a way to communicate with all instructors

- Maybe this is via having a google group that all instructors are part of?
- Maybe this is via push notifications?
- Maybe instructors should be able to specify how they'd like to be contacted?

#### \[To Do\]: UX polish

- School IDs will always begin with "SC-" so we don't make people enter that
  bit, and ensure that data is consistent.
- Create a special concept of country/region managers to manage all people in
  their country. All changes should populate an activity feed that ILC HQ can
  see. (ILC HQ changes should also be recorded here). Maybe back this up to
  bigquery or end emails. Note: short term, country/region managers are just
  added as managers of all schools in their region by an admin.
- Make the member list and school list have consistent widths per part, so
  things are nicely ligned up.
- When saving sometimes warning appear and disappear. e.g. on new member
  especially.

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

#### Consider server-side search

- If the search-index creation is slow on client side, we could move to using
  MeiliSearch or the like instead.
