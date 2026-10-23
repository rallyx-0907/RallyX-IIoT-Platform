# MQTT contract v1

Telemetry topic: `rallyx/v1/device/{device_id}/telemetry`.

Reserved topics: `rallyx/v1/device/{device_id}/event` and `rallyx/v1/device/{device_id}/status`.

```json
{
  "timestamp": "2026-10-23T08:30:10+07:00",
  "device_id": "configured-device-id",
  "asset_id": "configured-asset-id",
  "values": {
    "run": true,
    "fault": false,
    "current": 7.82
  },
  "quality": "GOOD"
}
```

- `timestamp` must be ISO-8601 with timezone; Core stores a separate receive timestamp.
- `quality` values: `GOOD`, `BAD`, `STALE`, `UNCERTAIN`.
- Missing tag values do not implicitly become zero.
- Topic and payload device IDs must match, and the device must belong to the payload asset. Disabled or archived configuration cannot ingest new values.
- Tag keys must resolve within that device. Values are raw typed scalars; Core applies scale/offset exactly once.
- Unknown asset/tag input must be rejected or quarantined with a visible diagnostic; never silently create production assets.
- Publish telemetry without retain; reconnecting publishers must send a fresh snapshot. QoS 1 is supported; consumers must tolerate duplicates.
- Store timestamps in UTC. Do not let older or duplicate timestamps overwrite current state or create duplicate transitions.
- Bad/stale/uncertain quality is visible and must not drive a valid RUN/FAULT transition.

JavaScript producers use `packages/contracts/telemetry.mjs`; Core validates through `internal/contracts`. See [connectivity](connectivity.md) for external MQTT mapping.

The former site/asset topic with `ts`, `tags` and lowercase quality is superseded. Existing Node-RED flows and product UI are still undergoing migration; keep the active baseline stack intact until its producer/UI acceptance passes with this contract.
