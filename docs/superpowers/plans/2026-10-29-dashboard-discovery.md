# Saved dashboard discovery and reopening

Bug evidence: existing Grafana dashboards and the user's native “Bàn thử Modbus Slave” board remain in their server stores. Grafana selection was only React state; native boards were separated under an unclear “Ô dữ liệu” menu and duplicated on Overview.

Fix: one dashboard entry point listing both saved sources. Restore an authenticated user's last selected server-backed board; carry its identity in a shareable URL and support opening a new tab. Refresh discovery on returning to the page without interrupting an active editor. Preserve native board data and old routes; hide the duplicate menu and replace Overview's duplicate creator with a dashboard link. Explain native boards in plain Vietnamese. Distinguish loading/error from an actually empty list.

Verification: failing remount/discovery tests first, focused UI tests and full suite, actual new Chromium tab and cross-tab discovery with the same dashboard identity; existing native boards remain visible. Web-only rollout after isolated verification and backup.

Verified result: all97 frontend tests pass; production image built. Real Chromium verified newly saved UID reopening in another tab, root-address restoration, reload, exact native-widget count and saved drag layout. On the operating demo, the existing “Bàn thử Modbus Slave” board retains all4 saved widgets. Added direct authenticated UID resolution for search results that omit a newly saved dashboard; do not replace that remembered identity with another board. Dashboard entry also bypasses unrelated heavy platform snapshots, and loads point configuration independently. Native APIs still load if Grafana status fails. Existing data stores, credentials, readers and field integrations are unchanged.
