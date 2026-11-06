# Mixed Test: print, scan, review, grade

Create a **Mixed Test** at `/teacher/assignments/new`, import the usual question JSON, choose classes, and publish. Every version must contain only multiple-choice questions with exactly the option IDs `A`, `B`, `C`, and `D`. Existing online and synchronized paper modes remain available.

Open **Print sheets & mark papers** on the assignment. Download student question papers (no solutions) and personalized answer sheets for everyone, a class, or one student. Give each student the question version printed on their answer sheet. Keep the separate teacher key private.

Print answer sheets at 100%, single-sided, on A4 paper. The blue bubble outlines also work in grayscale. Students fully shade one circle per question with dark pencil or black/blue pen and erase changes completely. Do not crop the four black squares or the QR code. Scan at 200–300 dpi. The template supports the importer's existing maximum of 200 questions, continuing onto additional personalized pages after every 60 questions.

Upload one or more PDF, PNG, or JPEG files on the marking page. Each file may contain up to 200 pages and be up to 50 MB. Files may mix classes and students. Upload another batch whenever more papers are ready, including after the assessment is closed. Keep the marking page open while processing; **Pause after this page** saves the cursor. After closing the tab or a failed request, choose **Resume / retry** under Uploads. If the original file upload itself was interrupted, choose that file again.

Solid, unambiguous selections are accepted automatically. Blank, faint, erased, multiple, irregular, or unreadable marks require a teacher decision. Choose the student's page, inspect the original or aligned scan and individual answer crops, and choose A/B/C/D, blank, or invalid. Add a brief reason and save. An unidentified QR requires checking the printed name, class, version and page, choosing that student's sheet, and confirming **every** answer manually. A new scan never silently replaces an existing active page; reject the old page first to replace it.

The gradebook uses the established weighted question points and percentage scales. Publishing creates an assessment column in each assigned class. Unscanned students have no grade. A student's grade appears only when every required page is accepted. Reopening or rejecting a graded page withholds the previous grade until all pages are accepted again. Class and question statistics exclude pending papers. Both grades and detailed per-question results can be exported.

## Integrity and permissions

- QR codes contain an opaque random sheet token, page number, and template version; no names, answers or grades.
- Sheet snapshots bind the exact student, class, assignment, version and question IDs. Published mode and class choices are locked. Newly enrolled students receive sheets on refresh; issued sheets are stable.
- Originals and page images are stored in the private `paper-scans` Supabase bucket. Only owner-checked server routes issue short-lived preview links or signed upload links. Never publish these files or signed links.
- Recognition runs on the server, using the QR finder patterns to locate four registration squares and a projective transform to measure the answer grid. QR/marker disagreement or insufficient resolution fails into review.
- Page writes, review decisions, attempt creation/recalculation, and audit events are transactional. One active page per sheet/page and one attempt per student prevent duplicate grades. Whole-file SHA-256 checks prevent repeated imports and verify stored file integrity.
- Processing leases serialize a batch, expire after an interrupted worker, and protect the page cursor from stale workers. Browser retries use saved state. Processing continues while the marking page is open; it is not an unattended background service.
- Original detector readings remain unchanged. Manual decisions, reasons, actor IDs, timestamps, revisions and grade changes are retained in the audit table. Stale concurrent reviews are rejected.
- Students cannot invoke review RPCs, download other students' sheets, alter scan-derived grades through legacy answer-entry tools, or access scan storage. Answer keys retain existing teacher/result-release permissions.

## Verification

`npm test` includes generated-PDF recognition, dynamic pagination, rotated/skewed/compressed scans, faint/multiple/crossed/blank marks, alignment failures and identifier mismatch tests. These are **synthetic scans**, not physical scanner validation.

Run the opt-in integration suite against a running production build:

```powershell
npm run build
npm run start
# In another terminal, using the same configured Supabase project:
$env:RUN_PAPER_SCAN_E2E='1'
node --experimental-strip-types tests/paper-scan-e2e.mjs
```

The suite creates an isolated synthetic teacher, 50 student accounts and five temporary classes, checks JSON import, print scopes, gradebook columns, a single paper, partial uploads, a 50-page PDF, concurrent processing, lease recovery, review/corrections, duplicates, unknown identifiers, two-page students, exports and access controls. It deletes its own database records and scan files afterward. It never uses the school's roster or grades. It requires the existing local Supabase admin configuration; credentials are never printed. To test an explicitly authorized production deployment, set `PAPER_SCAN_BASE_URL` to its HTTPS origin.

For the first physical test, create a small private trial assessment, print several sheets, fill correct/incorrect/blank/erased and multiple responses, and scan them on the printer/scanner you will use. Compare every detected answer and grade against the papers before using the workflow for real exams. Recognition thresholds are intentionally conservative, but synthetic validation cannot establish a physical scanner's error rate. Keep originals and inspect unusual marks.

## Deployment

Apply all mixed-test and scan-recovery migrations to the linked Supabase database and confirm migration histories match before deploying this application. No new environment secrets are required. The server needs the existing `SUPABASE_SECRET_KEY`; native PDF/image dependencies and the PDF.js worker are included in the Next.js deployment. Processing endpoints use the Node.js runtime and bounded requests (one page per request).

## Monochrome scanner recovery and marking results

The QR reader retries at multiple scales and uses median cleanup to handle speckled black-and-white printer/scanner output. Registration squares receive the same recovery, and the answer grid is locally aligned against its printed rings. These steps do not clean or invent student marks: the original raster remains the answer evidence.

Use **Retry automatic recognition** for an unidentified scan. It updates that page in place, retains the original file and prior detector output in the audit history, and cannot replace a finalized page, manual review or explicit teacher grade hold.

Selecting a paper opens a question-by-question result table with student choice, protected correct answer, and correct/incorrect/blank/needs-review status. Light marks may show a clearly labelled suggestion and provisional score. Suggestions do not enter the gradebook. Inspect the scan, use **Confirm detected answers & blanks** or choose answers individually, then **Save review & recalculate** to finalize. Missing or ambiguous selections still require an explicit interpretation.
