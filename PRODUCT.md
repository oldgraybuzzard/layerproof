# LayerProof — product direction

Melken TechWork builds LayerProof for its own document-review work and for use by external client review teams. Copyright © 2026 Melken TechWork.

Future changes should work for a reviewer who did not participate in development:

- Use selectable local workbooks and PDF folders, or create a portable review register directly from a PDF folder, without client-specific paths or document IDs in the application.
- Keep navigation, page review, workbook saving, and PDF correction/export visibly distinct.
- Preserve originals by default; export corrected copies with a record of the changes.
- Do not silently mark unreviewed pages clear, choose between ambiguous documents, or claim automated accuracy or accessibility compliance.
- Keep files local and include required third-party dependency notices in redistributable packages.
- Test the packaged Windows workflow as well as the editing/validation logic before broad client rollout.

The current workbook contract is Document ID in column A, Has Issues in D, and Concerns in E. For PDF-first projects, LayerProof creates this workbook and stores each PDF's relative path as its assignment. Completion history is local to a reviewer's machine. Shared work allocation, configurable workbook schemas, and verified-publisher signing require separate product work; they are not features of the current release.
