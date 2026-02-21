# Gradings

This document describes how gradings should work in this system.

## New gradings and how they are created from orders

To add a new grading, the student should first have payed for the grading, which will have created a document in the `orders` collection. Once the payment is confirmed, a `grading` document should be created in the `gradings` collection, and the `grading` document ID should be added to the student's `member` document (via a cloud function in `functions/src`; exact path to be determined). This should also trigger the creation of a cached `grading` document in the `gradings` collection of the instructor who will conduct the grading (if set), and (optionally) the `gradings` collection of the school that will host the grading (if set).

### The Data model for gradings

A `grading` document should contain the following information:

- `gradingPurchaseDate`: The date the grading was purchased.
- `orderId`: The ID of the order that was created when the grading was purchased (or empty if created manually).
- `level`: The level the grading is aimed for.
- `gradingInstructorId`: The ID of the instructor who conducted the grading.
- `assistantInstructorIds`: A list of IDs of the assistant instructors who are helping conduct the grading.
- `schoolId`: The ID of the school where the grading was conducted. Optional.
- `studentId`: The ID of the student who was graded.
- `status`: The status of the grading (e.g. `pending`, `passed`, `rejected`).
- `gradingEventDate`: The date of the grading. Initially not set. Should be set when the grading is conducted, and its status is changed to `passed` or `rejected`.
- `lastUpdated`: The last date this grading record was updated. 
- `notes`: Any notes about the grading.

Whenever a grading document is updated and set to `passed`, the student's `level` should be updated to the `level` of the grading. (via a cloud function in `functions/src`; exact path to be determined)

Gradings documents should be visible to (controlled by the firestore rules file: `firestore.rules`):

- The student who was graded.
- The instructor who conducted the grading.
- Any school managers or the owner of the school where the grading was conducted.
- All admins.

Students should have a `gradings` object in their `member` document. This should be a list of IDs for gradings that the student has purchased.

### Instructors

Instructors should have a `gradings` collection under their `instructor` document. This collection should contain the a cached copy of the `grading` documents for all gradings the instructor conducted, or was an assistant for. These should be mirrored here when the `grading` document is created or when the `gradingInstructorId` or `assistantInstructorIds` is changed: if these are edited, the `grading` document should be removed from the old instructor's `gradings` collection and added to the new instructor's `gradings` collection. Access to an instructor's `gradings` collection should be controlled by the firestore rules file: `firestore.rules`, and allow the insturctor to see the entries. But when they make changes, it should be to the `grading` document itself, not the cached copy in the `gradings` collection. Also, they should only be able to edit the entries where they are the `gradingInstructorId`, and only update the `status`, `gradingEventDate`, and `notes` fields.

There should also be a gradings view ("Gradings Assessed") for instructors that allows them to see all the gradings that they have conducted or assisted in. It should also allow the `gradingInstructorId` to update the status of the gradings (marking it as `passed` or `rejected`) and set the `gradingEventDate`.

### Schools

Schools should have a `gradings` collection under their `school` document. This collection should contain the a cached copy of the `grading` documents for the gradings that the school has conducted. These should be mirrored here when the `grading` document is created or when the `schoolId` is changed. When the `schoolId` is changed, the `grading` document should be removed from the old school's `gradings` collection and added to the new school's `gradings` collection. Access to a school's `gradings` collection should be controlled by the firestore rules file: `firestore.rules`, and allow the school manager and owner to see the entries. But they cannot make any changes.

There should also be a gradings view ("Gradings Hosted") for schools that allows them to see all the gradings that have been hosted at the school.

### Admins

A grading record can also be created manually by an admin, in which case the `gradingPurchaseDate` should be set to the date the grading was created, and the `status` should be set to `pending`. Admins can also manually update the status of a grading, and set the `gradingEventDate`, and other fields. Manually created gradings do not have an orderId associated (it is the empty string).

There should be a view for admins to see all gradings, add new gradings, update existing gradings, or delete them. This view should allow admins to search gradings by students, instructors, and schools, and to filter by status, level, and date. This can be done similarly to the way that the "Members" view allows admins to search for members and filter by status, country, and school.
