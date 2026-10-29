# Flexible Grafana dashboard editor

Goal: extend the existing approved Grafana integration with a Vietnamese in-app panel/layout editor. Preserve Grafana as the storage/rendering authority, existing panels and read-only field integration.

Approach: a lightweight 24-column pointer-operated layout editor using Grafana gridPos; existing Grafana advanced editing remains accessible. Avoid a second dashboard storage system or dependency on a hosted builder.

- [x] Test layout bounds, collision resolution, immutable updates and preserve unrelated panel fields.
- [x] Implement movement/resizing, keyboard alternatives, undo, editable titles and point-backed panel insertion/removal.
- [x] Integrate load/save with Grafana dashboard version checking, explicit discard protection and viewer restriction.
- [x] Verify frontend suite/build, real browser pointer manipulation and save/reload persistence against isolated Grafana; review; back up and deploy web only.

Constraints: Vietnamese controls, offline compatible, existing dashboard UID preserved, no SQL or hardware writes required. Non-flat row layouts receive a clear advanced-editor fallback rather than being rewritten. Concurrent saves must fail visibly without overwrite.
