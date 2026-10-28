# Rule Engine implementation status

The authoritative target is `RallyX_FEATURE_RULE_ENGINE_AGENT_PLAN.md`. Rule evaluation belongs to Core, after normalized tag validation; field adapters never own alarm business logic.

## Runtime integration candidate

The existing SQL-backed telemetry engine supports Boolean fault, numeric high/low with hysteresis, communication stale, active/acknowledged/cleared alarm history and generic runtime transitions. The configuration UI currently creates those baseline rules.

The working implementation now wires `internal/rules` into accepted telemetry batches and the one-second scheduler. Migration 004 adds ordered conditions, durable pending states, last-good timestamps and alarm snapshots. Startup recovery evaluates persisted rules before accepting broker messages. The new editor supports all/any conditions, typed operands, hysteresis, activation/clear delays and a side-effect-free current-snapshot test.

This implementation has passed the complete Go suite, the real PostgreSQL/broker integration suite, 68 frontend tests and the production Web build. The database lifecycle regression covers pending activation, active alarm identity, pending clear across startup recovery, hysteresis, BAD quality cancellation and snapshots. Chromium Modbus/CSV/Rule lifecycle acceptance passes 9/9; final bilingual/readability smoke passes on both preview and the upgraded operating demo. The feature plan's sustained load test and physical-hardware acceptance remain open.

## Pure evaluator contract

- `Validate(Rule, map[TagID]string)` checks datatype/operator compatibility, finite thresholds, nonnegative hysteresis/delays and an enabled rule's conditions.
- `EvaluateRule(Rule, map[TagID]TagState, time.Time, bool)` evaluates against an explicit time and active-alarm phase. It returns overall/per-condition `Known` and `Matched` results with reasons and snapshots.
- Supported operators are `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, `is_true`, `is_false`, `stale_for`, aggregated with `all` or `any`.

For an active `gt T` alarm, clear at `value <= T-H`; `gte T` clears below `T-H`. Active `lt T` clears at `value >= T+H`; `lte T` clears above `T+H`. Equality and Boolean conditions reject hysteresis. Numeric scalar types compare numerically when representable exactly; incompatible equality operands remain unknown and cannot make inequality spuriously activate.

Bad/missing/stale numeric or Boolean values remain unknown. An unusable input cannot clear an active rule. Stale evaluation uses the last accepted good timestamp (`LastGoodAt`), a fresh GOOD current timestamp, or `MonitoringSince` when no good reading exists. It waits the configured duration and does not reset its clock after restart. With no valid time anchor, the result remains unknown rather than inventing an immediate stale alarm. Persistence must supply those anchors when this package is integrated.

`POST /api/v1/rules/test` uses a read-only repeatable-read snapshot and has no alarm side effects. Administrators create/update rules through the existing collection/item endpoints; authenticated readers receive conditions and persisted runtime state. Acknowledgement never means clear; configuration disable cancels pending state and clears an active alarm with a retained reason. Archived definitions retain alarm history.

## Data-source independence

Rules reference normalized tag IDs and datatypes, never manufacturer/model names or protocol addresses. Modbus TCP register/function/datatype/byte-order mappings and MQTT topic/JSON-path mappings belong to connectivity configuration. Both produce the same validated telemetry contract, so a rule can combine points from either protocol. A usable mapping is still required; the platform cannot infer register semantics or arbitrary payload fields automatically.

## Verification

`go test -count=1 ./internal/rules` passes, as does the root local Go suite. Regression coverage includes quality/missing data, all comparison boundaries, high/low hysteresis, typed equality, all/any, cross-tag conditions, stale timing anchors and bounded delay/duration input. This evidence completes the domain slice, not the complete Rule Engine feature plan.
