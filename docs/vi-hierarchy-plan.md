# Vietnamese interface and hierarchy correction — 2026-10-28

The user identified concatenated tag/name metadata in the Asset hierarchy and the missing Vietnamese interface. Keep configured names, IDs, protocol addresses, units and all API payloads intact.

Implementation:

1. Replace native list rendering with distinct hierarchy levels and tag name/metadata lines; retain asset selection and device expand/collapse. Add regressions for structure and selection.
2. Add a local Vietnamese/English translation catalog, Vietnamese first-run default and a persistent language selector available before and after login. Resolve UI copy at render time; do not translate arbitrary configured names or values. Keep HTML document language and date formatting in sync.
3. Localize all existing pages, form labels, quality/state badges, empty/help/error messages and common API errors. Preserve protocol/data-type/CSV machine values even when their option labels are translated. Keep unknown server diagnostics intact rather than invent translations.
4. Verify both languages, persisted selection, typed form payloads, hierarchy with long names and narrow layouts, full frontend test/build checks, and Chromium acceptance on the isolated preview. Deploy only the verified Web image to the existing demo, retain rollback image and recheck the operating UI.

Independent work is split between hierarchy formatting and the translation catalog; runtime integration and full acceptance remain with the primary agent. New files are UTF-8 and require no runtime network or new dependencies.

## Verified result

- 65 frontend tests pass. Final affected hierarchy/localization/App suites pass 10/10 after the SVG-caret/runtime-unit follow-up. TypeScript and production Web builds pass. Independent review reports no important findings; catalog audit found severity-class and dynamic-label gaps which were corrected with a colour-class regression.
- Isolated full Chromium configuration/Modbus acceptance passes 9/9. Preview and operating read-only smoke pass existing login/APIs, eleven English and eleven Vietnamese pages, language persistence after reload, switching back, name/metadata block separation, minimum text size and 1440px/430px overflow checks. Configured names and numeric/boolean payloads have explicit regression coverage.
- Operating Web updated to `sha256:644c3721ce28fe6f5f5f69a19b0c41cd19859fbe403cad7016bad7c32e1331c9`. Previous image retained as `rallyx/web:pre-vi-20261028`. All six services healthy; Windows HTTP 200 serves `/assets/index-gfu3C8Jf.js`. Preview stopped with volumes retained. No operating Core/connectivity image, database schema, credentials or simulator configuration changed.
- Inspected operating screenshots: private `.tools/browser-evidence/hierarchy-vi-desktop.png`, `hierarchy-vi-narrow.png`, `live-vi-desktop.png`. New page is available at `http://172.27.165.200:8080/#assets`; hard-refresh existing tabs if required.

This corrects interface formatting/localization; it does not close physical equipment or V1 release gates.
