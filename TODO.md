# LayerProof production readiness

- [x] Resume the last project and remember its folders.
- [x] Recover local drafts after interruptions.
- [x] Reuse corrected-PDF destinations with backups and clear original/corrected labels.
- [x] Record reviewer and completion date in Excel.
- [x] Verify upgrades preserve settings, drafts, and review history on Windows.
- [x] Show project completion, remaining work, issues, and missing-document counts.

## Next release

- [x] Require verification of the latest corrected PDF before completion.
- [x] Pending changes list with individual Undo.
- [x] Portable PDF assignments saved in Excel.
- [x] Client handoff package with corrected PDFs and review report.
- [x] Manual deskew with aligned OCR and saved output.
- [x] Prepare trusted Windows signing workflow, fail-closed configuration, and setup instructions.
- [ ] Activate signing and verify an actual signed release after the owner supplies an authorized certificate/service. No signing credentials are configured.

0.3.0 validation: 48 tests pass. Native app testing covered deskew preview and Undo, pending-change and verification completion gates, verified save, durable Excel assignment/completion, and a client handoff containing the checked PDF and review report. Windows installation, 0.1.10 → 0.3.0 upgrade, shortcuts, uninstall and data preservation passed: https://github.com/oldgraybuzzard/layerproof/actions/runs/34779054844.

Previous readiness work completed in 0.2.0. All 43 tests pass. Live app verification covered resume, draft restore, reviewer saving, repeated exports with backups, and corrected-copy editing.

Windows verification: https://github.com/oldgraybuzzard/layerproof/actions/runs/34777899727 — installation, 0.1.10 → 0.2.0 upgrade, settings/draft/history preservation, and uninstall passed.

## 0.3.1 export fix

- [x] Reproduce document 64 OCR deletion export failure.
- [x] Accept boundary-space extraction changes while preserving strict text/content checks.
- [x] Add regression tests for adjacent deletions and unsupported replacement characters.
- [x] Verify sample-document batches (108 and 192 deletions) without changing source files.
- [x] Windows release validation: 50 tests, installation, upgrade, shortcuts, uninstall and data preservation passed: https://github.com/oldgraybuzzard/layerproof/actions/runs/34779547176.
