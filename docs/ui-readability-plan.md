# Operator readability correction — 2026-10-28

The supplied screenshots are the acceptance brief: remove native browser form styling, enlarge text and make Live Data understandable through equipment identity, labelled operating states and colour.

Keep the existing palette, routes, filters, permissions and configuration/API contracts. Fix shared typography and control defaults because the same defects appear across configuration screens. Live Data becomes a device-grouped monitor with large values and units, explicit Running/Stopped and Fault active/No fault labels, and visible quality/timestamps. Colour must never replace text. Numeric readings receive no invented normal ranges. Missing, expired, bad or disconnected readings must not imply a healthy operating state.

Implementation and verification:

1. Add failing Live Data regressions for identity, boolean semantics, missing/bad/stale/offline readings, filters and elapsed freshness.
2. Build device groups and semantic values using existing tag metadata; retain an optional technical table for raw details.
3. Correct shared text sizes/contrast, style default buttons/fieldsets, and give the Device form a working responsive grid with spaced actions.
4. Run component tests, TypeScript and production build. Build a separate preview Web image and inspect browser screenshots/computed sizes at desktop and narrow widths. Exercise existing browser acceptance with the read-only Modbus fixture.
5. Deploy the verified Web image to the existing authorized demo only, retain its previous image for rollback, and run operating browser smoke. Record measured results; hardware and V1 release gates remain separate.

Mobbin reference lookup was unavailable because its tool requires a paid plan. These corrections follow the supplied screenshots and source defects; no external design precedent is claimed.

## Verified result

- Shared content/form/table typography now uses 14–16px instead of 8–11px; monitor values use 36px desktop / 30px narrow. State/quality labels remain separate from values and carry text as well as colour. No numeric safe ranges are inferred.
- Device forms use a responsive grid, borderless fieldsets, consistent default buttons and separated actions. Device/Template legacy Windows-encoded ellipsis/dash bytes are corrected to valid text. SVG navigation icons do not depend on installed symbol fonts; narrow navigation retains accessible names.
- 57 component tests pass, including ten added Live Data cases (device identity, filters, semantic boolean states, fault priority, missing/BAD/stale/offline/invalid-time data, elapsed expiry and optional technical details). The affected App and Template suites also pass after their final edits. TypeScript and production Web builds pass.
- Full isolated Chromium acceptance with a real read-only Modbus TCP fixture passes 9/9. Preview and operating read-only smoke pass login, six configuration APIs, eleven pages and added computed-size/layout checks at 1440px and 430px. Screenshots inspected under private `.tools/browser-evidence/`: `live-readable-desktop.png`, `live-readable-narrow.png`, `device-form-readable.png`, `device-form-narrow.png`.
- Only Web was recreated on the operating demo. Verified image: `sha256:5e8c01375c048dbe62cfda89990becc5449f33e2e97683a4a01fb2c216c07c2e`. Previous image retained as `rallyx/web:pre-readability-20261028`. All six operating services healthy; Windows HTTP 200 serves the new `index-CaZhZK7Z.js` bundle. Preview stopped with volumes retained.

Open `http://172.27.165.200:8080/#live` and hard-refresh if an old tab still shows the prior interface. WSL addresses remain workstation-session dependent. This is UI/demo verification, not physical equipment or V1 release acceptance.
