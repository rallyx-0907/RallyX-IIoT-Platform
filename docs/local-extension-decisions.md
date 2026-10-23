# Local extension implementation decisions

This note records concrete decisions for the next implementation group. Requirements remain in the mandatory root local change spec; no item here is a completion claim.

## Migration and compatibility

- Preserve immutable migration 001 and all existing history. Add a forward migration for the amended local model.
- Active hierarchy is Site / Area / Asset / Device / Tag. Legacy panel rows may remain only as migration provenance; new APIs and UI must not require a panel layer.
- Connections replace connector metadata. Device ownership is required for tags; key uniqueness moves from asset to device. Backfill unowned historical tags into explicitly disabled migration devices instead of inventing live connections.
- Store typed `data_type` alongside the coarse boolean/number/string storage class if needed to preserve existing state safely. New protocol decoding validates signed/unsigned ranges, floating point byte/word ordering, finite scaling and offset.
- Move normalized telemetry to the device topic/payload and uppercase GOOD/BAD/UNCERTAIN/STALE qualities. Match payload device/asset IDs to database relationships. Maintain ordered ingestion per device and atomic all-tag validation.
- Runtime sessions become tag-scoped so two devices within an asset can have independent configured runtime sources. Preserve existing sessions by linking their historical source tag. Counter resets change a persisted baseline and create audit entries; never erase events/sessions.

## Dynamic connectivity boundary

- A separate Node connectivity service owns protocol polling/subscriptions; Core owns business state and configuration. This honors the original separation of vendor polling from Core and the new spec's optional Node-RED role.
- Workers periodically fetch a service-token-protected configuration endpoint, reconcile by config revision/signature, and stop disabled/deleted devices. Each device progresses independently with bounded timeouts and retry/backoff; RTU access is serialized per physical port.
- Simulator, MQTT, Modbus TCP and RTU implement the same connection/test/read/close contract. Workers publish standardized device telemetry through the internal broker; no direct SQL access.
- MQTT credentials are write-only browser inputs, encrypted at rest with the installation key, and decrypted only for the authenticated connectivity service. Browser/export/diagnostic responses omit credentials.
- Core forwards administrator Test Connection/Test Read to the authenticated worker API. Reads return raw and decoded values without PLC/VFD write support.
- RTU device mapping is an installation concern; provide a Compose override for a mapped serial adapter. Adding further slave devices on an already supported connection requires only UI configuration.

## Metadata, rules and UI

- Soft delete disables connections/devices/tags and retains history; UI confirmation states this policy. Template updates never mutate instantiated tags. Device-from-template creation clones tags atomically and accepts address overrides.
- CSV preview and commit share one validator; row/column errors block the entire import. Resolve device IDs or unambiguous names. Support the change-spec example and round-trip typed tag fields.
- Per-user Value/Status/Trend dashboard widgets persist in SQL. Viewer users may manage their own dashboard without receiving administrator configuration privileges.
- Digital ON/OFF, high/low and stale alarms use tag IDs only. Persist debounce candidates so restart and duplicate delivery cannot bypass delay. Disabling/reconfiguring rules must reconcile active alarms with retained clear reasons.
- New dynamic UI pages include Connections, Devices, Templates, CSV preview and Dashboard pinning. Extend existing Live/History/Alarm/Asset views rather than creating per-model screens.

## Acceptance and operations

- Exercise a clean deployment without demo data; add supported-protocol devices through UI, test reads, trigger alarms and verify no rebuild/full-stack restart.
- Use a read-only Modbus TCP simulator to verify independent devices, supported data types, invalid registers, timeouts and recovery. Physical RTU and isolated-host offline/reboot acceptance remain explicitly unverified until exercised.
- Backup consistency uses a PostgreSQL snapshot plus configuration and Node-RED state. Restore tests target a separate Compose project/database and never overwrite the active development installation.
- Offline images and updates must preserve the installation key and application history. Do not claim release completion without restore, rollback, restart, offline and architecture-specific package evidence.
