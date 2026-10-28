# Interface languages

RallyX Web supports Vietnamese and English without a network translation service or additional dependencies. A browser without a saved choice starts in Vietnamese. The language selector appears on the login screen and the workspace header. Its selection is saved in that browser's `localStorage` as `rallyx.language`, survives reload/logout, and synchronizes between tabs on the same origin. Clearing browser storage resets the first-run default.

Interface text, menus, forms, quality/operating states, ordinary errors and empty states use the selected language. Dates use the corresponding locale in the browser's timezone; runtime durations use translated units. Configured Site/Area/Asset/Device/Tag names, units, string readings, credentials, protocol codes, CSV headers and API machine values remain unchanged. Rename configured demo labels through their normal configuration screens if Vietnamese equipment names are desired.

The hierarchy now identifies each level, uses native buttons for selecting assets and expanding devices, and separates the tag name from its key/data-type metadata. The hierarchy remains available on narrow screens. It uses a navigation/list structure rather than claiming ARIA tree keyboard behavior.

## Maintaining translations

`apps/web/src/i18n.tsx` owns language state, persistence, locale formatting and interpolation. `apps/web/src/locales/vi.ts` maps source interface copy to Vietnamese. The App subscribes to language changes, so changing language rerenders its children while retaining form state. Only interface copy passes through `t`; configured names and values bypass translation. Interpolated labels pass configured names as parameters.

Always give translated select options explicit machine `value` attributes. Keep class names, status comparisons, request paths, JSON keys and CSV wire formats in their original form. Translate badge contents while retaining the original severity/quality class. Unknown server diagnostics fall back to their original message; do not invent a translated diagnosis. Add known diagnostic translations to the catalog as needed.

Existing contract tests explicitly select English through `test-setup.ts`. Locale regressions cover the Vietnamese default, persisted selection, switching without losing entered text, translated live states with unchanged configured names/readings, numeric/boolean simulator request values and severity colour classes. Hierarchy regressions cover tag metadata separation, asset selection and device expansion.

Chromium smoke can set `RALLYX_VI_CHECK=true` alongside `RALLYX_BROWSER_SMOKE_ONLY=true` to verify the first-run Vietnamese screen, eleven translated pages, persistence after reload, hierarchy layout at 1440px/430px and switching back to English. This smoke does not save configuration. Full browser acceptance uses English controls against a separate installation and real read-only Modbus TCP fixture; it creates test configuration and must remain separate from an operating installation.
