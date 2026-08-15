Migration actions performed by assistant

- Ran Next codemod middleware-to-proxy with --force to assist migration. The project is not a git repository so codemod was run with --force and a backup of middleware.ts was created at middleware.ts.bak.
- Codemod encountered parse errors in some generated/.next and .open-next files; it completed safely and the build still succeeds. No manual source changes to middleware.ts were necessary for the app to build with Next 16.3.1.
- Created docs/MIGRATE_MIDDLEWARE.md with migration guidance and recommended next steps.
- Added .github/workflows/ci.yml to run typecheck, build, and the SKU dedup harness in CI.
- Added docs/VULNERABILITY_NOTES.md documenting the remaining xlsx vulnerability and recommended remediation.
- Added a guard in app/api/imports/parse-file/route.ts to prevent parsing spreadsheets larger than 5 MB to mitigate ReDoS attack surface while a long-term replacement for xlsx is planned.

Notes:
- Remaining high severity vulnerability: xlsx (SheetJS) — no fix available as of audit run. Recommended replacement with exceljs or adding sandboxed parsing.
- If you want, I can start replacing xlsx with exceljs in import-mapping.ts and test the import/export flows; please confirm before I make that change since it touches parsing logic widely used by import endpoints.
