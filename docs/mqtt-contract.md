# MQTT contract v1

Telemetry topic: `rallyx/{site_id}/{asset_id}/telemetry`.

Event topic (reserved): `rallyx/{site_id}/{asset_id}/event`.

```json
{
  "ts": "2026-10-23T08:30:10+07:00",
  "tags": {
    "run": true,
    "fault": false,
    "current": 7.82
  },
  "quality": "good"
}
```

- `ts` must be ISO-8601 with timezone.
- `quality` values: `good`, `bad`, `stale`, `unknown`.
- Missing tag values do not implicitly become zero.
- Site and asset IDs in the topic must resolve to registered entities.
- Tag keys must resolve to tags configured for that asset.
- Unknown asset/tag input must be rejected or quarantined with a visible diagnostic; never silently create production assets.
- Publish telemetry without retain; reconnecting publishers must send a fresh snapshot. QoS 1 is supported; consumers must tolerate duplicates.
- Store timestamps in UTC. Do not let older or duplicate timestamps overwrite current state or create duplicate transitions.
- Bad/stale/unknown quality is visible and must not drive a valid RUN/FAULT transition.
