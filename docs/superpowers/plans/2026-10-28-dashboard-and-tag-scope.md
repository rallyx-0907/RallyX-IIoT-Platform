# Dashboard customization and device-scoped signals

User requests usable dashboards for heterogeneous datapoints and device-scoped signal configuration. Continue the authorized technical completion in existing React/Go stack, retaining current widgets/history and the real Windows slave.

## Design decisions

Extend server-persisted per-user widgets rather than browser-only dashboards or a separate dashboard product. Named boards persist even when empty; existing widgets remain in the default board. Numeric tags support value, trend (when history enabled), gauge and level; Boolean tags support value/status; strings support value. Numeric gauge/level have configured min/max, precision and unit display. No invented process thresholds or physical units. Provide editing, ordering and size controls. Preserve unavailable/quality/stale behavior.

Signal configuration adds independent device filter, text search, datatype filter, count and 25-row paging; creation inherits device scope and refresh preserves scope. Do not reuse form device state as filtering state.

## Implementation and checks

1. Add failing Tags scope/search/create regression; implement filters and bounded page navigation in Tags.tsx, translate labels.
2. Add real-DB board isolation and gauge/settings validation tests; migration006 adds dashboard_boards and nullable board_id FK. Add per-user board list/create/rename endpoints and widget board/type/settings validation. Preserve existing dashboard endpoint contract.
3. Add frontend tests for board persistence/selection, numeric vs Boolean compatibility, gauge bounds, edit/order; extend DashboardWidgets and shared CSS. Board filter is client-side over own widgets, API enforces ownership.
4. Run complete Go real-DB and Web suite/build, independent review; exercise Chromium dashboard creation/edit/reload and device filters with the real configured slave. Build separate images, backup, rehearse preview migration, deploy and verify operating UI. Add verified Progress Log entries.
