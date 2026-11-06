# Native distribution layout review — 2026-11-06

The fixed 130px donut exceeded a 67px drawing region in the saved factory dashboard. Chromium reproduced the circle extending above the heading before the fix. The shared renderer now reserves a heading row and bounds the circular drawing by both available dimensions. Short controls omit the secondary caption; narrow controls retain the status/count legend instead of squeezing the drawing. Overflowing legends scroll from the first through the last row.

Verification: 174 Web tests passed; TypeScript lint and production image build passed. The regression structure test failed against the previous renderer before passing with the fix. Real Chromium checks passed for 160×84, 240×140, 320×140, 460×280, 900×180 and 220×400 controls, long Vietnamese headings, six legend rows, 1024/720/390px viewports and CSS zoom 125%/200%. CSS zoom is a content enlargement check, not a claim of testing every browser's native zoom implementation. Runtime, builder Design and builder Preview use the same bounded renderer. Empty/offline content is covered by component tests.

- [Runtime](runtime.png)
- [Builder Preview](builder-preview.png)
- Browser regression: `tests/e2e/native-widget-layout.test.mjs` (isolated showcase only).
- Required future checks: [UI quality gates](../../ui-quality-gates.md), enforced by the repository `AGENTS.md`.

The operating Web update retained all 24 tags, three devices, five legacy widgets and the original board; all 24 tags remained GOOD. No field configuration or data was changed. This evidence covers the distribution widget; it is not a certification of every app control.
