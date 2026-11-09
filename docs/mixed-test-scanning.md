# Mixed Test: print, scan, review, grade

Create a **Mixed Test** at `/teacher/assignments/new`, import the usual question JSON, choose classes, and publish. Every version must contain only multiple-choice questions with exactly the option IDs `A`, `B`, `C`, and `D`. Existing online and synchronized paper modes remain available.

Open **Print & upload scans** on the assignment. **Download all student packets** places each student's named question pages immediately before their named QR answer sheet. Use **Download class packets** to print one class, or **Student packet**, **Question paper**, and **Answer sheet** in the roster to download one student's materials. Question papers contain no solutions. Keep the separate, personalized teacher keys private. Students solve their own questions, shade the matching answer sheet, and return only the answer sheet for scanning.

New papers choose one variant independently for each question slot and shuffle the four choices separately for every student/question. Printed letters can therefore differ between students. The saved question IDs and option order bind both PDFs, scan review, exports and final grading. Reprinting never reshuffles an issued paper. Papers issued before this feature keep their original complete version and A/B/C/D mapping.

For an extremely easy demo, import `data/assessment-imports/unit-1-extremely-easy-mixed-demo-10q-4v.json`: 10 one-point MCQ slots, each with four similar number variants. It covers arithmetic, fractions, percentages, simple expressions/equations, evaluating a line and slope.

Print answer sheets at 100%, single-sided, on A4 paper. The blue bubble outlines also work in grayscale. Students fully shade one circle per question with dark pencil or black/blue pen and erase changes completely. Do not crop the four black squares or the QR code. Scan at 200–300 dpi. The template supports the importer's existing maximum of 200 questions, continuing onto additional personalized pages after every 60 questions.

Upload one or more PDF, PNG, or JPEG files on the marking page. Each file may contain up to 200 pages and be up to 50 MB. Files may mix classes and students. Upload another batch whenever more papers are ready, including after the assessment is closed. Keep the marking page open while processing; **Pause after this page** saves the cursor. After closing the tab or a failed request, choose **Resume / retry** under Uploads. If the original file upload itself was interrupted, choose that file again.

A dominant single-choice mark is graded automatically, including ordinary light pencil and partial shading. Clear blanks resolve automatically as zero points. Only genuinely weak/competing marks, hollow crossed-out marks, unreadable identities or alignment failures require attention. Choose the student's page, inspect the original or aligned scan and individual answer crops, and choose A/B/C/D, blank, or invalid. Edit an answer in the result table and use **Save changes**; a reason is optional. An unidentified QR requires checking the printed name, class, version and page, choosing that student's sheet, and confirming **every** answer manually. A new scan never silently replaces an existing active page; reject the old page first to replace it.

The gradebook uses the established weighted question points and percentage scales. Publishing creates an assessment column in each assigned class. Unscanned students have no grade. A student's grade appears only when every required page is accepted. Reopening or rejecting a graded page withholds the previous grade until all pages are accepted again. Class and question statistics exclude pending papers. Both grades and detailed per-question results can be exported.

## Integrity and permissions

- QR codes contain an opaque random sheet token, page number, and template version; no names, answers or grades.
- Sheet snapshots bind the exact student, class, assignment, per-question variant, question IDs and option order. Printed letters are mapped back to source option IDs before the canonical grader runs. Published mode and class choices are locked. Newly enrolled students receive sheets on refresh; issued sheets are stable.
- Originals and page images are stored in the private `paper-scans` Supabase bucket. Only owner-checked server routes issue short-lived preview links or signed upload links. Never publish these files or signed links.
- Recognition runs on the server, using the QR finder patterns to locate four registration squares and a projective transform to measure the answer grid. QR/marker disagreement or insufficient resolution fails into review.
- Page writes, review decisions, attempt creation/recalculation, and audit events are transactional. One active page per sheet/page and one attempt per student prevent duplicate grades. Whole-file SHA-256 checks prevent repeated imports and verify stored file integrity.
- Processing leases serialize a batch, expire after an interrupted worker, and protect the page cursor from stale workers. Browser retries use saved state. Processing continues while the marking page is open; it is not an unattended background service.
- Original detector readings remain unchanged. Manual decisions, reasons, actor IDs, timestamps, revisions and grade changes are retained in the audit table. Stale concurrent reviews are rejected.
- Students cannot invoke review RPCs, download other students' sheets, alter scan-derived grades through legacy answer-entry tools, or access scan storage. Answer keys retain existing teacher/result-release permissions.

## Verification

`npm test` includes generated-PDF recognition, dynamic pagination, rotated/skewed/compressed scans, faint/multiple/crossed/blank marks, alignment failures and identifier mismatch tests. These are **synthetic scans**, not physical scanner validation.

It also checks all 24 answer permutations, the math and structure of all 40 demo variants, named packet ordering, QR identity, and the absence of student solutions. `tests/personalized-mixed-papers-e2e.mjs` is an opt-in API/database/PDF/browser check: it imports the actual demo JSON, issues four personalized papers plus a legacy fixture, checks stable reprints and download scopes, scans five papers, and verifies individual grades and canonical answers. It uses the same `RUN_PAPER_SCAN_E2E`, `PAPER_SCAN_BASE_URL`, and optional `PLAYWRIGHT_MODULE` settings and cleans up its own synthetic data.

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

The **Grades & recognition** dashboard at `/teacher/assignments/[id]/grading` is separate from printing/uploading. It shows graded, awaiting-scan and needs-attention students, final scores, estimated recognition confidence, search, class/status filters and sorting. Open a student for a dedicated full-width answer page with every question, correct/incorrect results, confidence and editable answer selectors. Clear results are final without a confirmation click. Change any answer later and save to recalculate; original evidence and teacher corrections remain audited.

Confidence (0–100) estimates mark clarity from strength, dominance, coverage and stray ink; it is not a statistically calibrated probability or measured accuracy rate. The dashboard separately reports agreement with explicitly teacher-reviewed answers and the comparison count. Blank answers have no selected letter and score zero. The detailed CSV includes confidence. Earlier unreviewed scans can use **Automatically grade saved scans**; recognition never replaces an explicit teacher grade hold or previous corrections.
