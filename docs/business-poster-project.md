# Business Poster Project grading

In a class's **+ HW / CW** dialog, choose **Business Poster Project**, set its date, and add it to the selected topic. Open the project column, then select **Grade Project**. Use the group buttons to move between teams without clearing unsaved scores. **Save project grades** persists all teams and scores together and updates the Class Manager immediately.

The overlay provides the full rubric, three shared team criteria, two individual criteria, a team subtotal, and an individual total. All criteria accept decimal scores from 0 through 20. A student's total is ungraded until all five criteria are present. Zero is a valid score. Percentages and column averages use the existing integer rounding convention; raw point totals retain decimal precision. Closing with unsaved edits requires confirmation. Failed saves retain edits. Inputs lock during saves; revision conflicts require explicitly reloading the current saved document.

**Edit teams** supports adding/removing teams and members and choosing existing students from the selected class. Individual scores follow the student when moving teams; shared scores follow the team. Removed members' scores are excluded when saving. Projects in other classes start with editable empty teams unless their roster confidently matches the optional supplied template.

## Supplied roster

The supplied groups match **12B Math**, using existing student IDs. Nineteen names match uniquely after accent normalization and comparison with full account names, nicknames, and Google Classroom names. **Angelina Kruichack** remains unresolved because the existing student is **Angelina Meredith Kruichak Ramirez**. Select that existing student under Group 5, member 2. Luciana Duque maps to the existing 12B student; Luciana Ferrucho in 12A is not used. No student accounts are created. Other 12B roster students remain unassigned until the teacher chooses a team for them.

The template contains display names, not database IDs or a hardcoded class ID. Its scores start blank. Teachers can disable the supplied template at creation and edit memberships afterward. No example scores or project assignments are automatically seeded into real classes.

## Storage and grade propagation

- `classroom_work_items`: the normal class/topic-specific work record, labeled Business Poster Project, with no automatic completion statuses.
- `classroom_grade_columns`: one linked numeric column with source `project` and maximum 100. Existing assessment/manual sources are preserved.
- `classroom_projects`: one row per project, with its class ID, work-item ID, grade-column ID, revision, update timestamp, and a JSON document. The versioned document stores teams, student IDs or unresolved labels, three shared scores per team, and two individual scores per student.
- `create_business_poster_project`: atomically creates the work record, grade column, and rubric document after checking teacher ownership and class/topic membership.
- `save_business_poster_project`: validates membership, uniqueness, and all score bounds, locks the project, checks its revision, and atomically saves the document. Stale writes return HTTP 409 through SQLSTATE `PT409`.

The rubric document is the only source of project grades. `lib/business-poster-project.ts` derives complete student totals for the Class Manager and existing student topic-grade calculation. Project totals are not copied into manual grades or attempts. Manual-grade writes to project columns are rejected by the existing database trigger. Existing topic formulas, weighting, and summative-column choices remain teacher-controlled; choosing this project as a summative column uses its derived score. Project-column clipboard copying preserves ungraded cells as a dash.

RLS restricts rubric reads to the class's teacher. Authenticated users cannot directly insert/update/delete rubric rows; the two RPCs check teacher ownership. Every save validates members against that project's class. The API also scopes reads and writes by both class ID and project/work-item ID. Private teammate rubric details are not returned by the student topic-record loader.

Migrations:

1. `20261104120000_business_poster_projects.sql`: additive project storage, extended grade-column source, RLS, and transactional RPCs.
2. `20261104123000_project_save_conflict_status.sql`: explicit HTTP conflict response instead of a retryable serialization error.

## Changed application areas

- `lib/business-poster-project.ts` and `lib/business-poster-project-data.ts`: rubric, calculations, validation, roster matching, and server-side loading.
- `app/api/classes/[id]/projects/**`: creation, reading, and revision-checked saving.
- `app/teacher/classes/[id]/stars/business-poster-project.tsx` and its CSS module: project overview, team editor, and grading overlay, using the existing gradebook styling and a native modal dialog for focus containment.
- Class Manager page, standalone stars page, and `stars/star-classroom.tsx`: HW/CW creation option, project opening, derived grades, and immediate updates.
- Existing work-item/grade-column APIs and gradebook controls: protect project columns from conflicting generic edits.
- `lib/classroom-stars.ts` and `lib/student-classroom-record.ts`: project-source typing and existing topic-grade integration.
- `tests/business-poster-project.test.mjs`, `.sql`, and `.e2e.mjs`: calculation/matching tests, database security/persistence checks, and opt-in browser/API verification. `package.json` includes the unit tests in `npm test`.

## Verification

Run `npm test`, `npm run lint`, and `npm run build`. The project unit suite covers example totals, shared versus individual edits, decimal precision, null versus zero, serialization, moving teams, validation, and roster matching.

Run `tests/business-poster-project.sql` against a migrated disposable database with `psql -v ON_ERROR_STOP=1`. It rolls back its fixtures and checks atomic creation, existing HW/CW/manual grades, persistence, stale revisions, RLS, class isolation, score validation, and rejection of conflicting manual project grades.

The opt-in `tests/business-poster-project.e2e.mjs` expects a running local build and linked Supabase configuration, plus Playwright and headless Chrome. Set `RUN_LINKED_PROJECT_E2E=1`; optionally provide `PLAYWRIGHT_MODULE` with an absolute path to an existing `@playwright/test` installation and `PROJECT_TEST_BASE_URL` (default `http://localhost:3100`). Run with `node --env-file=.env.local tests/business-poster-project.e2e.mjs`.

The browser script creates temporary classes using existing 12B/12A roster IDs, generates an authentication link without sending email, verifies the real UI and API, and removes the temporary classes in `finally`. It creates no student records and enters no scores into real teaching classes. Use only an explicitly authorized database for this opt-in test.
