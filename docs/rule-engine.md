# Rule Engine implementation status

The authoritative target is `RallyX_FEATURE_RULE_ENGINE_AGENT_PLAN.md`. Rule evaluation belongs to Core, after normalized tag validation; field adapters never own alarm business logic.

## Deployed baseline and next domain slice

The existing SQL-backed telemetry engine supports Boolean fault, numeric high/low with hysteresis, communication stale, active/acknowledged/cleared alarm history and generic runtime transitions. The configuration UI currently creates those baseline rules.

The new `internal/rules` package is a verified pure evaluator foundation. It is **not yet wired into the telemetry engine or Rule CRUD/Test API**. Multi-condition UI, persisted activation/clear debounce, detailed snapshots and restart recovery of pending rule state remain open; storing delay fields in the earlier schema does not complete those behaviors.

## Pure evaluator contract

- `Validate(Rule, map[TagID]string)` checks datatype/operator compatibility, finite thresholds, nonnegative hysteresis/delays and an enabled rule's conditions.
- `EvaluateRule(Rule, map[TagID]TagState, time.Time, bool)` evaluates against an explicit time and active-alarm phase. It returns overall/per-condition `Known` and `Matched` results with reasons and snapshots.
- Supported operators are `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, `is_true`, `is_false`, `stale_for`, aggregated with `all` or `any`.

For an active `gt T` alarm, clear at `value <= T-H`; `gte T` clears below `T-H`. Active `lt T` clears at `value >= T+H`; `lte T` clears above `T+H`. Equality and Boolean conditions reject hysteresis. Numeric scalar types compare numerically when representable exactly; incompatible equality operands remain unknown and cannot make inequality spuriously activate.

Bad/missing/stale numeric or Boolean values remain unknown. An unusable input cannot clear an active rule. Stale evaluation uses the last accepted good timestamp (`LastGoodAt`), a fresh GOOD current timestamp, or `MonitoringSince` when no good reading exists. It waits the configured duration and does not reset its clock after restart. With no valid time anchor, the result remains unknown rather than inventing an immediate stale alarm. Persistence must supply those anchors when this package is integrated.

Rule testing through the future API must have no alarm side effects. Acknowledgement never means clear; configuration disable must cancel pending state and retain existing alarm history.

## Verification

`go test -count=1 ./internal/rules` passes, as does the root local Go suite. Regression coverage includes quality/missing data, all comparison boundaries, high/low hysteresis, typed equality, all/any, cross-tag conditions, stale timing anchors and bounded delay/duration input. This evidence completes the domain slice, not the complete Rule Engine feature plan.
