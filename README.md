# LayerProof

A local desktop application for reviewing existing PDF text against the scanned page and recording decisions in an Excel control register. Works offline; no OCR service, upload, Python installation, or Microsoft Excel installation is required.

## Windows installation

Run `dist/LayerProof Setup 0.2.0.exe` on a Windows 10/11 x64 machine. This development release is unsigned; it has not yet been exercised on a physical Windows machine. Use your organization's normal software approval process.

1. Open **LayerProof** and choose **Open review project**.
2. Select the `.xlsx` control workbook, then the folder containing PDFs. Subfolders are included.
3. Select a document. Column A supplies its ID. The Excel row number distinguishes duplicate IDs. Exact filenames match case-insensitively; suffix/combined files are suggestions that require explicit assignment.
4. Compare the original page with the stored text. Click either a text segment or its box to highlight the corresponding content. **Show OCR on scan** displays reconstructed text over the scan; it is a diagnostic approximation, not the original PDF font rendering.
5. Add a quick concern when a page has problems. Moving to another page or saving marks that page checked, provided the added concern is still present. Use **No issues on this page** for clear pages. The manual checkbox remains available.
6. Choose the document-wide Yes/No decision and save. **Save to workbook** saves the one pending review and leaves the application open, ready to close. All earlier saved decisions are already in Excel; unsaved edits cannot be carried into another document without saving or explicitly discarding them. **No** requires all pages checked and empty concerns. **Yes** requires a concern and can be saved before the full review is complete. **Save & next document** saves this document to Excel and moves to the next available unfinished row, wrapping to earlier unfinished work when needed. The default **Needs review** queue hides a review after all its pages are checked and it is saved. Use **Completed reviews**, **All available PDFs**, or **All workbook rows** to show it again. Saving partial findings keeps that document in Needs review.

Saves update **D (Has Issues)**, **E (Concerns)** and **QC Reviewed** for the selected row. On first save, the app appends QC Reviewed after the existing columns if neither QC Reviewed nor QC Performed exists. It also copies matching completed reviews from this computer into that new column. Columns B/C, including 508 Compliant, are not altered: OCR review does not establish accessibility compliance. Existing Has Issues decisions alone do not indicate completion. QC Reviewed (or QC Performed) values Yes, TRUE, and 1 indicate completion, regardless of whether the document has issues.

## Finding missing documents

Open **Document discovery** beneath the queue to see the full selected folder path, scanned PDF paths, unmatched worksheet rows, suggested matches, and scan warnings. **Rescan this folder** picks up files added after opening. **Change PDF folder** selects a different root without requiring you to choose the workbook again. The initial scan and each rescan verify two consecutive file lists, with at most three passes. If the lists keep changing, the report warns you and shows the latest result. This can recover files omitted from the first listing; it cannot prove that a remote server returned every file. The report records counts and added/removed paths for each pass. A scan includes nested folders and follows folder links/junctions with cycle detection; unreadable subfolders are reported rather than silently omitted. Only `.pdf` files are included, not PDFs stored inside ZIP archives or Windows `.lnk` shortcuts.

Filename variants such as `00040.PDF`, `Document(40).pdf`, and `DOC40-final.pdf` are suggestions for Document 40. Confirm the correct PDF; these names are never silently assigned. The queue filter does not limit the scan. Its row count is the number of workbook rows shown, not the number of PDFs. The footer reports PDFs and unmatched rows separately.

Use **Export scan report** to save a JSON diagnostic report if a file still does not appear. The report includes document IDs and local paths, but no PDF contents. Nothing is uploaded automatically.

## Saving and recovery

Each save creates an exact pre-save copy in `<workbook>.backups/`. Close the workbook in Excel before saving. The app refuses to overwrite a workbook changed since it was opened; save any on-screen notes separately and reopen the project to refresh. Writes use a temporary file and rename, plus a short-lived `.ocr-qc.lock`. A stale lock after a crash may be removed only when no process is saving.

Page checkmarks, assignments and completion history are saved in the operating system's application-data folder, keyed by the workbook's full path and original worksheet row. Detailed page history is local to the worker's machine. Document completion is also saved in the workbook’s QC Reviewed column, so completed rows remain hidden after reopening or moving the workbook to another machine. It is not a shared multi-worker assignment system. Moving a workbook or PDFs can require reassigning files and resets local page history; the workbook completion flag remains available. Sort entire rows, including QC Reviewed, to keep status with the correct document. Keep one worker per workbook copy for the pilot. Backups restore the spreadsheet; local history is not restored with them.

Review edits remain on screen until **Save**. Switching records or closing asks before discarding unsaved work. The optional accuracy transcript is an unsaved scratchpad, retained only while that document remains open. Do not use it as your record of findings; use column E.

## Accuracy interpretation

PDF text segments can be individual characters, words, or lines. The app reports those units as segments, not guaranteed words. Text extraction cannot tell whether text was authored directly or produced by OCR. Pages with no extractable text need human inspection; an empty page or graphic alone is not proof of an OCR problem.

The optional accuracy panel compares the entire current page's extracted text against a manually verified transcript. Character and word error rates are Levenshtein edit counts divided by the reference character/word counts. NFC and whitespace normalization are applied; case and punctuation remain significant. Insertions can produce rates above 100%. These are page-level rates and depend on extraction order. They are not automatic document accuracy scores. Limit each comparison to 12,000 characters.

## Development

Use Node.js 22 or newer:

```sh
npm ci
npm start
npm test
npm run dist:win
npm run dist:mac
```

PDF.js is pinned to a release compatible with Electron 40. Test the viewer when upgrading either dependency. The lockfile fixes the rest of the dependency tree.

To launch against local inputs:

```sh
npm start -- --workbook "/path/control.xlsx" --pdf-folder "/path/PDFs"
```

The sample audit is read-only and checks first/middle/last page extraction, filename mapping, and byte preservation of unrelated XLSX content:

```sh
npm run test:samples -- "/path/control.xlsx" "/path/PDFs"
```

`scripts/ui-smoke.cjs` is a developer UI test using a temporary workbook copy. The GitHub Actions workflow builds the Windows installer on Windows when manually triggered or a version tag is pushed. Sample documents and control workbooks are not packaged or committed.

## Implementation

Electron uses an isolated, sandboxed renderer and a narrow preload API. PDF.js renders PDFs and extracts existing text. The register module reads XLSX XML and surgically replaces only the target D/E cell elements, preserving all other archive members and worksheet content. There is no spreadsheet recalculation or full-workbook re-export.

## Publisher

Copyright © 2026 Melken TechWork. The application and installer carry Melken TechWork company metadata. This build is not Authenticode-signed; a trusted Windows signing certificate or signing service is required for a verified publisher signature. Resource editing is enabled independently of code signing.

## OCR corrections (0.1.5)

Select a stored text segment and click **Correct OCR text…**. Choose its invisible PDF text block, enter a small correction, and stage it. If the selected text occurs more than once, choose the intended block explicitly. Corrections may cover multiple pages of the current document. Repeated exports in the same open-document session include earlier exported corrections. When reopening a document later, open the corrected copy if you want to continue from those changes; the original remains unchanged.

**Export corrected PDF…** asks for a separate output folder and keeps the original PDF filename (for example, `40.pdf`). Choose or create a folder outside the source PDF tree so corrected copies do not appear as duplicate matches on rescan. It writes a new PDF and a sibling `.corrections.json` log containing original/replacement text, page/block identifiers, file hashes, and verification results. Recognized corrected outputs can be updated in the same folder; the prior PDF and log are backed up first. Unrelated or externally changed files are not replaced. The original stays open for review; the app adds a page-specific export note to Concerns, which you save to Excel separately. Staged corrections are held in memory until exported. Save to workbook does not save or apply PDF corrections. Export or explicitly discard them before leaving the document.

This release edits top-level invisible text objects only. Visible text, text inside nested forms, encrypted PDFs, and digitally signed PDFs remain review-only. The existing font must support the replacement. If read-back verification fails, the app refuses to export that change. It does not add missing OCR, replace the scan, or repair accessibility tags. After correction, the text selection width can differ slightly because the word has changed. Review the exported copy before client delivery.

Each edited page is rendered before editing and again after saving at 96 dpi (maximum dimension 4,096 pixels). The app requires identical pixel hashes and verifies exact replacement text and invisible rendering mode after reopening the output. This is a visual/text check, not a full PDF/UA or archival-conformance validation.

The **Next page →** button below **No issues on this page** marks the current page checked and advances. It does not change the document-wide Yes/No decision. The top navigation arrows remain browsing controls. On the last page, use No issues or the checkbox to mark it reviewed.

Drag the divider between Original page and Stored OCR text to resize either pane. The split is remembered locally. Keyboard users can focus the divider and use left/right arrows; Home or a double-click resets it.

PDF correction runs locally in a background worker using the MIT-licensed EmbedPDF PDFium WebAssembly package. Its dependency notices accompany the application.

## Uninstalling LayerProof

Close LayerProof, then use **Windows Settings → Apps → Installed apps → LayerProof → Uninstall**. The installer also places `Uninstall LayerProof.exe` in the installation directory. Uninstall removes the installed application, desktop/Start menu shortcuts, and Installed apps entry. Review history is retained for reinstall; project PDFs, corrected exports, workbooks and backups outside the application installation directory are retained. Store documents outside the application installation directory.

The application ID and previous `PDF OCR QC` review-data directory remain stable across the rename. The Windows CI workflow runs `scripts/test-windows-install.ps1` after packaging to verify a silent install/uninstall with disposable data. Running this check requires a disposable Windows environment; a successful Mac cross-build alone does not verify Windows uninstall execution.

## Resuming a production review

Both save buttons write **QC Reviewed = Yes** when all pages are checked, or **No** for a partial review. Reopening the workbook excludes Yes/TRUE/1 rows from **Needs review** and Save & next, even on a different computer. **Completed reviews** and **All workbook rows** still show them. To put a completed document back in the queue, set QC Reviewed to No or clear it in Excel, then reopen the project. Once this column exists it takes precedence over local completion history. Unsaved work is not recorded as completed. A document may have Has Issues = Yes and QC Reviewed = Yes: review completion and document quality are separate decisions.

## Erroneous OCR text and page orientation

Select a stored text segment, open **Correct OCR text**, choose the block, then **Delete erroneous text** to stage removal of the whole invisible block (for example, a punch hole interpreted as a character). For a stray character within a valid line, edit the replacement text instead. Export applies deletions to the separate corrected PDF and records them in the change log. Original PDFs and scanned page appearance stay unchanged.

**Mark page checked** checks the current page without changing the document’s issue decision or concerns. Quick concerns include **Turned page**, **Skewed image**, **Crooked page**, and **Bad scan**. The toolbar’s rotation arrows turn the current page view by 90 degrees, including its OCR boxes. Rotation is staged per page and saved with **Export corrected PDF**, with or without text corrections. The new PDF keeps the original filename in your chosen separate folder. The scan and OCR layer turn together. The change log records the original and final orientation. Save to workbook records review decisions, not PDF rotations; export before leaving the document. Closing or switching documents warns about unexported turns.

## In-app Help

Choose **Help** in the header or press **F1** to open the offline reviewer guide in a separate window. Search by topic or use **Print guide** for a paper/PDF handout. The guide covers setup, workbook columns, page review, saving and resuming, text correction/deletion, exported page turns, accuracy, and troubleshooting. It does not require a project to be open and does not change review data.

## Production workflow (0.2.0)

- **Resume last review** reopens the last workbook and PDF folder. Reviewer name and each project’s output folder are remembered on this computer.
- Recovery drafts save locally after a short pause (400 ms) in editing and are flushed on normal close. Drafts include decisions, notes, checked pages, text changes/deletions and rotations. Reopening the project offers Restore or Discard. If the workbook row or PDF changed, restoration is stopped; the prompt displays notes for copying. Draft recovery does not save Excel or export PDFs for you. A sudden power loss can still lose the latest unsaved keystrokes.
- Enter **Reviewer name** before saving. Saves add/reuse **QC Reviewed By** and **QC Reviewed On**. The timestamp is ISO 8601 UTC and is set when all pages are checked; a partial review has a reviewer but no completion timestamp. These are reviewer-entered names, not authenticated signatures.
- The project summary counts all workbook rows, with completed, remaining, issues, and unmatched totals. Categories overlap; a completed row may have issues.
- **Output folder…** sets the project’s corrected-PDF folder. Repeat exports update a recognized, unchanged prior output, backing up the PDF and log in `<output.pdf>.backups/`. Files from another source or changed outside LayerProof are refused. A filename collision between sources requires another folder.
- The viewer labels **Original PDF** or **Corrected copy**. After saving the review, use **Open corrected copy** to inspect and continue editing the exported version. Further exports from that copy reload it with its updated signature.
- Windows CI installs 0.1.10, upgrades to the current build, verifies version and preservation of settings/drafts/history, then uninstalls and checks cleanup.
