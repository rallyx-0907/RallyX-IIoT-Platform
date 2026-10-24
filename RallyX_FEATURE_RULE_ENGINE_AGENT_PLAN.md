# RallyX Rule Engine — Feature Implementation Plan

> **For agentic workers:** Implement this file task-by-task from top to bottom. Use checkbox (`- [ ]`) tracking. Change a checkbox to `- [x]` only after implementation **and** the listed verification/tests pass. Do not mark work complete based on code presence alone.
>
> This feature plan expands/overrides the Rule Engine portion of `RallyX_IIoT_Platform_AGENT_IMPLEMENTATION_PLAN.md` Milestone 5 and the Alarm section of `RallyX_IIoT_Platform_AGENT_CHANGE_SPEC_Local_App_Device_Extensibility.md`.

**Goal:** Build a configurable, no-code Rule Engine in RallyX that evaluates live Tag data and creates/clears alarms when user-defined conditions are met.

**Architecture:** RallyX Core evaluates rules against normalized current Tag state after telemetry has passed normal ingestion/validation. Rule definitions are stored in PostgreSQL; the Rule Engine is device-agnostic and operates only on Tag IDs, values, quality and timestamps. Rule Engine decides whether conditions are true; Alarm Engine owns alarm lifecycle, acknowledgement and history. Node-RED must not contain the product's alarm business logic.

**Tech Stack:** Go RallyX Core, PostgreSQL/TimescaleDB, existing RallyX Web frontend, REST API, WebSocket/SSE live updates as already selected by the main plan.

**Spec context:**
- Main plan: `RallyX_IIoT_Platform_AGENT_IMPLEMENTATION_PLAN.md`
- Local app change spec: `RallyX_IIoT_Platform_AGENT_CHANGE_SPEC_Local_App_Device_Extensibility.md`
- This file: authoritative detailed scope for Rule Engine V1.

---

# 0. Scope and non-goals

## V1 MUST support

- [ ] Numeric High rule: `>` and `>=`.
- [ ] Numeric Low rule: `<` and `<=`.
- [ ] Equality/inequality rule: `=` and `!=` where data types are compatible.
- [ ] Boolean rule: `TRUE` / `FALSE`.
- [ ] Communication stale rule: no fresh good-quality telemetry for configured duration.
- [ ] Activation delay/debounce (`FOR X seconds`).
- [ ] Clear delay/debounce.
- [ ] Numeric hysteresis to prevent alarm chatter.
- [ ] Rule severity: `info`, `warning`, `critical`.
- [ ] Rule enable/disable.
- [ ] Alarm acknowledgement.
- [ ] Alarm clear/history with timestamps and duration.
- [ ] Multiple conditions with `ALL` (AND) or `ANY` (OR).
- [ ] Conditions may reference different Tags; Rule Engine must not assume device type.
- [ ] Rule CRUD from Web UI without source-code changes.
- [ ] Test/evaluate a rule using current Tag values before saving or enabling.
- [ ] Rule configuration persists through RallyX restart.
- [ ] Active/pending state recovers deterministically after Core restart.

## V1 SHOULD support if it does not destabilize MUST scope

- [ ] Custom alarm message template using rule/tag/asset/value placeholders.
- [ ] Duplicate rule action.
- [ ] Rule search/filter by name, severity, enabled state and asset/tag.
- [ ] Export/import rule configuration as JSON.

## Deferred — DO NOT block V1

- [ ] Rate-of-change rules.
- [ ] Moving average/statistical rules.
- [ ] Complex nested expression tree beyond one `ALL`/`ANY` group.
- [ ] Scripted JavaScript/Python rules.
- [ ] AI/ML anomaly rules.
- [ ] Scheduled/calendar rules.
- [ ] Email/SMS/Zalo/Teams notification connectors.
- [ ] Escalation chains.
- [ ] SaaS/multi-tenant rule isolation.
- [ ] Cloud rule execution.

---

# 1. Product behavior

## 1.1 Separation of responsibility

```text
Normalized Tag Update / Current State
               │
               ▼
        RallyX Rule Engine
        "Is condition true?"
               │
        state transition only
               │
               ▼
        RallyX Alarm Engine
        "What is alarm state?"
               │
      ┌────────┼─────────┐
      ▼        ▼         ▼
    Active   History   Live UI
    Alarm     Event    WebSocket
```

- [ ] Rule Engine contains no vendor-specific PLC/VFD knowledge.
- [ ] Rule Engine does not poll Modbus/OPC/MQTT directly.
- [ ] Rule Engine consumes normalized Tag state from RallyX Core.
- [ ] Alarm Engine remains the owner of activation, acknowledgement, clear and history records.
- [ ] Node-RED may collect/normalize data but must not be the authoritative alarm-rule store.

## 1.2 Required user workflow

```text
Settings
  → Rules
  → Add Rule
  → Name / Severity
  → Add Condition(s)
  → Select Tag
  → Operator / Threshold
  → Activation Delay
  → Hysteresis
  → Clear Delay
  → Message
  → Test Rule
  → Save
  → Enable
```

Expected result after Enable:

```text
Tag update
  → condition evaluated
  → pending if delay required
  → alarm activated
  → Active Alarms UI updates
  → user acknowledges if required
  → clear condition met
  → alarm moves to history
```

- [ ] Creating a rule for an existing Tag requires no RallyX source-code change.
- [ ] Adding a new device/tag through supported RallyX configuration allows that Tag to be selected by Rule UI automatically.

---

# 2. Domain model

Use equivalent existing project types if already implemented; do not create duplicate competing models.

## 2.1 Rule

Required fields:

```text
Rule
- id
- name
- description
- enabled
- severity                  info | warning | critical
- logic                     all | any
- activation_delay_ms
- clear_delay_ms
- message_template
- created_at
- updated_at
```

- [ ] `name` required and non-empty.
- [ ] `enabled` defaults to false for a newly created rule unless existing product convention says otherwise.
- [ ] `logic` defaults to `all`.
- [ ] Delay values must be >= 0.
- [ ] Severity is validated against the supported enum.

## 2.2 RuleCondition

Required fields:

```text
RuleCondition
- id
- rule_id
- tag_id
- operator
- operand_type              number | boolean | string | duration
- operand_number            nullable
- operand_boolean           nullable
- operand_string            nullable
- duration_ms               nullable; used by stale condition
- hysteresis                nullable numeric >= 0
- position
```

Supported operators:

```text
gt        >
gte       >=
lt        <
lte       <=
eq        =
neq       !=
is_true
is_false
stale_for
```

- [ ] Numeric operators reject non-numeric Tags.
- [ ] Boolean operators reject non-boolean Tags.
- [ ] `stale_for` requires a positive duration.
- [ ] Hysteresis is valid only for numeric high/low comparisons.
- [ ] A Rule requires at least one Condition before it can be enabled.

## 2.3 Rule runtime state

Persist enough state to recover deterministic behavior after restart:

```text
RuleState
- rule_id
- state                     inactive | pending_active | active | pending_clear
- pending_since             nullable timestamp
- active_alarm_id           nullable
- last_evaluated_at
- last_result               boolean
- updated_at
```

- [ ] Runtime state is recoverable after Core restart.
- [ ] Runtime state is not stored only in process memory.
- [ ] Editing a rule resets/reconciles pending state safely and immediately re-evaluates against current values.

## 2.4 Alarm instance

Use/extend existing Alarm model. Minimum required fields:

```text
Alarm
- id
- rule_id
- severity
- message
- activated_at
- acknowledged_at           nullable
- acknowledged_by           nullable
- cleared_at                nullable
- clear_reason              nullable
- activation_snapshot       JSON/JSONB
- clear_snapshot            JSON/JSONB nullable
```

- [ ] Acknowledge does not mean Clear.
- [ ] Alarm duration derives from `activated_at → cleared_at`.
- [ ] Each activation creates one alarm instance; repeated telemetry while active must not create duplicates.

---

# 3. Exact rule semantics

## 3.1 Numeric High

Example:

```text
Temperature > 70 °C
activation_delay = 5 s
hysteresis = 2 °C
clear_delay = 2 s
```

Activation condition:

```text
value > 70 continuously for 5 s
```

Clear condition after alarm active:

```text
value <= 68 continuously for 2 s
```

- [ ] For `gt threshold T` with hysteresis `H`, clear when `value <= T-H`.
- [ ] For `gte threshold T` with hysteresis `H`, clear when `value < T-H`.

## 3.2 Numeric Low

Example:

```text
Pressure < 2.0 bar
hysteresis = 0.2 bar
```

- [ ] For `lt T` with hysteresis `H`, clear when `value >= T+H`.
- [ ] For `lte T` with hysteresis `H`, clear when `value > T+H`.

## 3.3 Equality / boolean

- [ ] `is_true` activates when Tag value is true.
- [ ] `is_false` activates when Tag value is false.
- [ ] `eq` and `neq` compare only compatible types.
- [ ] Hysteresis is ignored/rejected for equality/boolean conditions.

## 3.4 Stale communication

Example:

```text
Tag = PLC01.Heartbeat
Condition = stale_for 30 s
```

- [ ] Stale is based on the last accepted fresh Tag timestamp/current-state timestamp, not browser refresh time.
- [ ] Rule activates when no fresh accepted value exists for the configured duration.
- [ ] Rule clears when fresh telemetry resumes and clear delay is satisfied.
- [ ] Core restart must not reset a stale timer incorrectly.

## 3.5 Multiple conditions

Example ALL:

```text
Motor.Run == TRUE
AND
Motor.Current < 1.0 A
FOR 10 s
```

Example ANY:

```text
VFD.Fault == TRUE
OR
VFD.FaultCode != 0
```

- [ ] `logic=all`: all conditions must be true at the same evaluation point.
- [ ] `logic=any`: at least one condition must be true.
- [ ] Activation delay applies to the aggregated rule result, not separately to each condition.
- [ ] Clear delay applies to the aggregated clear result.

## 3.6 Data quality

Default V1 behavior:

- [ ] `quality=good`: normal evaluation.
- [ ] `quality=bad|unknown`: numeric/boolean conditions do not newly activate and do not clear an already active alarm solely because value is unusable.
- [ ] `quality=stale`: stale rule may evaluate true; other conditions do not use stale value as fresh data.
- [ ] Missing Tag value never becomes numeric zero or boolean false implicitly.

## 3.7 Out-of-order and duplicate telemetry

- [ ] Rule Engine consumes only telemetry accepted by the normal RallyX ingestion/current-state layer.
- [ ] Older out-of-order values that did not become current state must not rewind rule state.
- [ ] Duplicate telemetry must not create duplicate activations, acknowledgements, clear events or history rows.

---

# 4. Alarm lifecycle state machine

Required behavior:

```text
INACTIVE
   │ condition true
   ▼
PENDING_ACTIVE  -- condition false --> INACTIVE
   │ activation delay elapsed
   ▼
ACTIVE_UNACK
   │ acknowledge
   ▼
ACTIVE_ACK
   │ clear condition true
   ▼
PENDING_CLEAR   -- condition becomes alarm true again --> ACTIVE_(ACK/UNACK)
   │ clear delay elapsed
   ▼
CLEARED / HISTORY
```

If activation delay = 0, transition directly to active.
If clear delay = 0, clear immediately when clear condition is satisfied.

- [ ] Alarm can be acknowledged only while active.
- [ ] Acknowledgement timestamp/user is immutable after successful first acknowledge unless main product explicitly supports re-acknowledge.
- [ ] Clearing preserves acknowledgement information.
- [ ] If an unacknowledged alarm clears, history remains unacknowledged.
- [ ] Re-entering alarm condition after clear creates a new Alarm instance.

### Disable behavior — V1 decision

When an enabled rule is disabled:

- [ ] Stop further evaluation immediately.
- [ ] Cancel pending activation/clear timers.
- [ ] If an alarm is active, close it with `clear_reason=rule_disabled` and preserve it in history.
- [ ] Write an audit/event record for the disable action if local audit support exists.

### Edit behavior — V1 decision

When an enabled rule is edited:

- [ ] Validate and persist atomically.
- [ ] Cancel/reconcile old pending timers.
- [ ] Re-evaluate against current Tag state using the new definition.
- [ ] Do not create duplicate active Alarm instances during the edit transaction.

---

# 5. Persistence / migration plan

Target files based on current RallyX repository plan:

```text
apps/core/migrations/*_rule_engine.sql
apps/core/internal/rules/
apps/core/internal/alarms/
apps/core/internal/storage/
```

Use existing migration naming conventions if repository already exists.

## Task 5A — Database schema

- [ ] Create/extend `rules` table.
- [ ] Create `rule_conditions` table.
- [ ] Create `rule_states` table.
- [ ] Extend/create `alarms` table with required lifecycle fields.
- [ ] Add indexes for `rules.enabled`, `rule_conditions.tag_id`, active alarms and alarm history time range.
- [ ] Add FK behavior that prevents deleting a referenced Tag without explicit user action/validation.
- [ ] Migration applies successfully on clean DB.
- [ ] Migration applies safely on an existing RallyX DB containing earlier alarm/rule tables.
- [ ] Migration rollback/down behavior follows project convention.

### Verification

- [ ] Schema integration test inserts one rule with two conditions and reloads it losslessly.
- [ ] Invalid operator/type combinations are rejected by application validation.
- [ ] Deleting a Tag referenced by an enabled rule is blocked with a useful error.

---

# 6. RallyX Core — Rule domain and evaluator

Suggested focused files; adapt to existing code organization instead of duplicating equivalent files:

```text
apps/core/internal/rules/model.go
apps/core/internal/rules/validation.go
apps/core/internal/rules/evaluator.go
apps/core/internal/rules/hysteresis.go
apps/core/internal/rules/engine.go
apps/core/internal/rules/repository.go
apps/core/internal/rules/service.go
apps/core/internal/rules/types.go
```

## Task 6A — Domain types and validation

Produce equivalent interfaces/types:

```go
type Logic string
type Operator string
type Severity string
type RuleStateName string

type Rule struct { ... }
type Condition struct { ... }
type EvaluationInput struct { ... }
type EvaluationResult struct { ... }
```

- [ ] Add supported enums/constants.
- [ ] Implement rule validation.
- [ ] Validate Tag datatype compatibility before enable/save.
- [ ] Reject negative delays/hysteresis.
- [ ] Reject enabled rule with zero conditions.

### Tests

- [ ] Valid numeric High rule passes validation.
- [ ] High rule against boolean Tag fails validation.
- [ ] Boolean condition against numeric Tag fails validation.
- [ ] Negative hysteresis fails validation.
- [ ] `stale_for=0` fails validation.

## Task 6B — Primitive condition evaluator

Expected pure function equivalent:

```go
EvaluateCondition(condition Condition, tagState TagState, alarmActive bool) (ConditionResult, error)
```

- [ ] Implement numeric comparison.
- [ ] Implement boolean comparison.
- [ ] Implement equality/inequality.
- [ ] Implement stale comparison.
- [ ] Implement quality behavior.
- [ ] Implement hysteresis clear semantics using `alarmActive`/phase context.

### Tests

- [ ] `71 > 70` true.
- [ ] `70 > 70` false.
- [ ] Active `gt 70` with hysteresis 2 does not clear at 69.
- [ ] Active `gt 70` with hysteresis 2 clears at 68.
- [ ] Boolean true activates `is_true`.
- [ ] Bad-quality input does not activate numeric rule.
- [ ] Missing value is not treated as zero.

## Task 6C — Aggregate evaluator

Expected pure function equivalent:

```go
EvaluateRule(rule Rule, states map[TagID]TagState, phase EvaluationPhase) (EvaluationResult, error)
```

- [ ] Implement `all` aggregation.
- [ ] Implement `any` aggregation.
- [ ] Return per-condition diagnostic results for Rule Test UI.
- [ ] Return the values/timestamps used to create alarm activation snapshot.

### Tests

- [ ] ALL only true when all conditions true.
- [ ] ANY true when one condition true.
- [ ] Cross-device/cross-asset Tag references evaluate without device-specific branching.

---

# 7. Stateful Rule Engine

## Task 7A — Engine subscription

Rule Engine must run after normalized telemetry/current-state update.

- [ ] Subscribe/attach to accepted current Tag state changes.
- [ ] Determine affected enabled Rules by changed `tag_id`.
- [ ] Re-evaluate only affected rules plus scheduled stale checks.
- [ ] Do not query every Rule on every telemetry sample.
- [ ] Expose engine health/diagnostic counters if RallyX health model supports it.

## Task 7B — Activation debounce

- [ ] On first true aggregate result: enter `pending_active` and persist `pending_since`.
- [ ] If result becomes false before delay: cancel pending state.
- [ ] Activate exactly once when continuous true duration reaches `activation_delay_ms`.
- [ ] `activation_delay_ms=0` activates immediately.

### Tests

- [ ] `Temperature > 70 FOR 5s`: 4.9s does not activate.
- [ ] Condition false at 4.9s cancels pending activation.
- [ ] Condition true again starts a new 5s period.
- [ ] Repeated same-value telemetry does not produce duplicate alarm.

## Task 7C — Clear debounce and hysteresis

- [ ] Active alarm remains active while clear threshold is not satisfied.
- [ ] Enter `pending_clear` only when clear result becomes true.
- [ ] If alarm condition returns before clear delay: cancel pending clear.
- [ ] Clear exactly once after continuous clear duration.

### Tests

- [ ] High 70 / hysteresis 2 remains active at 69.
- [ ] At 68, pending clear starts.
- [ ] If value jumps to 71 during clear delay, alarm remains active and pending clear cancels.

## Task 7D — Stale scheduler

Telemetry-driven evaluation alone cannot detect silence.

- [ ] Add a lightweight stale-check scheduler/ticker owned by Rule Engine.
- [ ] Schedule/check only Rules containing `stale_for` conditions.
- [ ] Avoid one goroutine/timer per Rule if a bounded shared scheduler is simpler and safer.
- [ ] Evaluate using current-state `updated_at`/source timestamp semantics defined by ingestion.

### Tests

- [ ] No telemetry for 30s activates stale rule.
- [ ] Fresh telemetry clears stale alarm according to clear delay.
- [ ] Restart at 25s elapsed does not incorrectly grant another full 30s.

## Task 7E — Restart recovery

- [ ] Load enabled Rules at Core startup.
- [ ] Load persisted `rule_states`.
- [ ] Load referenced current Tag states.
- [ ] Reconcile open active alarms.
- [ ] Resume pending activation/clear based on persisted timestamps where valid.
- [ ] Re-evaluate once after startup to prevent stale state.

### Tests

- [ ] Restart while alarm active retains same alarm ID and no duplicate activation.
- [ ] Restart while pending activation respects elapsed time.
- [ ] Restart while pending clear respects elapsed time.
- [ ] Restart with changed/removed Tag configuration surfaces diagnostic instead of panic.

---

# 8. Alarm Engine integration

Suggested existing area:

```text
apps/core/internal/alarms/
apps/core/internal/events/
```

## Task 8A — Activate

- [ ] Rule transition to active calls one Alarm Engine activation interface.
- [ ] Store severity, rendered message and activation snapshot.
- [ ] Emit immutable event/history record.
- [ ] Emit live WebSocket/SSE event.
- [ ] Repeated active evaluation is idempotent.

## Task 8B — Acknowledge

Expected API/service behavior equivalent:

```text
AcknowledgeAlarm(alarmID, userID, timestamp)
```

- [ ] Active alarm may be acknowledged.
- [ ] Already acknowledged alarm returns idempotent success or documented conflict; choose one behavior and test it.
- [ ] Cleared alarm cannot be newly acknowledged unless product explicitly chooses otherwise; V1 default = reject.
- [ ] Acknowledgement appears live in UI.

## Task 8C — Clear

- [ ] Rule transition to clear closes the existing active Alarm instance.
- [ ] Store `cleared_at`, `clear_reason=condition_normal`, and clear snapshot.
- [ ] Preserve ack fields.
- [ ] Emit clear event/live update exactly once.

## Task 8D — Disable/edit integration

- [ ] Disabling active Rule closes active alarm with `rule_disabled`.
- [ ] Editing Rule re-evaluates without creating duplicate active alarms.

---

# 9. REST API

Follow existing RallyX API conventions/versioning. Proposed resources:

```text
GET    /api/v1/rules
POST   /api/v1/rules
GET    /api/v1/rules/{id}
PUT    /api/v1/rules/{id}
DELETE /api/v1/rules/{id}
POST   /api/v1/rules/{id}/enable
POST   /api/v1/rules/{id}/disable
POST   /api/v1/rules/test

GET    /api/v1/alarms?state=active
GET    /api/v1/alarms/history
POST   /api/v1/alarms/{id}/acknowledge
```

If equivalent endpoints already exist, extend them rather than creating duplicates.

## Task 9A — Rule CRUD API

- [ ] List rules with pagination/filtering appropriate to existing app conventions.
- [ ] Create rule and conditions transactionally.
- [ ] Update rule and conditions transactionally.
- [ ] Delete disabled Rule that has no lifecycle conflict; preserve alarm history.
- [ ] Enable endpoint validates referenced Tags and rule definition.
- [ ] Disable endpoint follows lifecycle semantics in this spec.

## Task 9B — Rule Test API

Request contains either a saved Rule ID or unsaved draft definition.

Response minimum:

```json
{
  "result": true,
  "logic": "all",
  "conditions": [
    {
      "tag_id": "...",
      "value": 72.4,
      "quality": "good",
      "matched": true,
      "reason": "72.4 > 70"
    }
  ]
}
```

- [ ] Test endpoint never activates/clears real alarms.
- [ ] Test endpoint returns useful validation errors.
- [ ] Test endpoint exposes current values used for evaluation.

## Task 9C — API tests

- [ ] Create valid rule returns success and stored conditions.
- [ ] Invalid Tag/operator combination returns 4xx validation response.
- [ ] Enable invalid Rule is blocked.
- [ ] Test Rule has no alarm side effect.
- [ ] Acknowledge active alarm succeeds.

---

# 10. RallyX Web UI

Adapt paths to actual frontend framework:

```text
apps/web/src/pages/Rules/
apps/web/src/pages/Alarms/
apps/web/src/components/rules/
apps/web/src/api/rules.*
apps/web/src/types/rules.*
```

## Task 10A — Rules list

Minimum columns:

```text
Name | Enabled | Logic | Conditions | Severity | Current State | Updated | Actions
```

- [ ] Add Rules navigation under Settings or equivalent configuration area.
- [ ] Show enabled/disabled state.
- [ ] Show current runtime state: Normal / Pending / Alarm.
- [ ] Search/filter rules.
- [ ] Provide Edit / Duplicate / Enable / Disable / Delete actions as supported by V1 scope.

## Task 10B — Rule editor

Required fields:

- [ ] Name.
- [ ] Description.
- [ ] Severity.
- [ ] ALL / ANY selector.
- [ ] One or more Condition rows.
- [ ] Tag selector searchable by Site/Area/Asset/Device/Tag context.
- [ ] Operator filtered by Tag datatype.
- [ ] Threshold/value input.
- [ ] Hysteresis for numeric high/low.
- [ ] Activation delay.
- [ ] Clear delay.
- [ ] Message template.
- [ ] Enabled toggle or separate Enable action.

## Task 10C — Test Rule UX

- [ ] `Test Rule` button evaluates against live/current Tag values.
- [ ] Show overall result.
- [ ] Show each condition current value, quality and matched/not matched.
- [ ] Test does not save/activate alarms.

## Task 10D — Active alarms

Minimum fields:

```text
Severity | Alarm | Asset/Tag context | Active Since | Duration | Ack State | Current Value | Action
```

- [ ] Active alarm appears without page refresh through existing live transport.
- [ ] Acknowledge button updates state live.
- [ ] Clear removes alarm from Active list and keeps it in History.

## Task 10E — Alarm history

- [ ] Filter by time range.
- [ ] Filter by severity.
- [ ] Filter by rule/asset/tag if existing UX supports it.
- [ ] Show activation, acknowledgement, clear and duration.
- [ ] Show clear reason.

---

# 11. Simulator / demo acceptance scenario

Create/extend simulator Tags:

```text
Demo Site
└── Demo Area
    └── Electrical Panel 01
        ├── Motor 01
        │   ├── Run         bool
        │   ├── Fault       bool
        │   └── Current     float A
        └── Temperature 01
            └── Temperature float °C
```

Seed/demo Rules may be created by demo seed, not hard-coded in the engine.

## Demo Rule A — High Temperature

```text
Name: High Temperature
Condition: Temperature01.Temperature > 70 °C
Activation Delay: 5 s
Hysteresis: 2 °C
Clear Delay: 2 s
Severity: Warning
```

- [ ] 69 °C = Normal.
- [ ] 72 °C for 4 s = still Pending/Normal, no active alarm.
- [ ] 72 °C for >=5 s = Warning active.
- [ ] Acknowledge works.
- [ ] 69 °C = alarm stays active because hysteresis clear threshold is 68 °C.
- [ ] 67 °C for >=2 s = alarm clears and history contains full lifecycle.

## Demo Rule B — Motor command but no current

```text
Logic: ALL
Motor01.Run is TRUE
Motor01.Current < 1 A
Activation Delay: 10 s
Severity: Critical
```

- [ ] Run OFF = Normal.
- [ ] Run ON + Current 5 A = Normal.
- [ ] Run ON + Current 0.5 A for >=10 s = Critical active.

## Demo Rule C — Fault digital

```text
Motor01.Fault is TRUE
Activation Delay: 0
Severity: Critical
```

- [ ] Fault ON creates alarm immediately.
- [ ] Fault OFF clears according to configured clear delay.

## Demo Rule D — Communication stale

```text
Temperature01.Temperature stale_for 30 s
Severity: Warning
```

- [ ] Stop simulator publishing for >30 s = stale alarm.
- [ ] Resume valid telemetry = stale alarm clears.

---

# 12. Performance and reliability requirements

These are V1 guardrails, not premature high-scale SaaS requirements.

- [ ] Rule evaluation does not block MQTT ingestion loop on slow DB/UI operations.
- [ ] Use indexes/caches so a Tag update finds affected Rules without full-table scan.
- [ ] One failing/malformed Rule cannot crash the Rule Engine.
- [ ] Engine logs rule ID and useful diagnostic on evaluation failure.
- [ ] Core health endpoint indicates Rule Engine startup/load failure if fatal.
- [ ] Alarm activation/clear persistence is transactionally safe enough to prevent obvious duplicate lifecycle records.
- [ ] System behaves predictably when DB is temporarily unavailable according to existing RallyX error/retry policy.

### Baseline local load test

Use a reproducible test appropriate to the repo. Minimum acceptance target for demo/local app:

- [ ] 500 active Rules.
- [ ] 2,000 registered Tags.
- [ ] 100 Tag updates/sec synthetic input for 10 minutes.
- [ ] No Core crash/panic.
- [ ] No duplicate Alarm instance for one continuous condition.
- [ ] UI/API remains responsive enough for local demo use.

Do not over-optimize beyond this baseline unless measurements show a problem.

---

# 13. Security / permissions

Follow existing RallyX local auth/RBAC plan.

Recommended minimum:

- [ ] Viewer: read Rules and Alarms; cannot edit or acknowledge unless existing role policy says otherwise.
- [ ] Operator: acknowledge alarms; cannot change Rule configuration unless existing role policy says otherwise.
- [ ] Engineer/Admin: create/edit/enable/disable Rules.
- [ ] Rule configuration changes are recorded in local audit log if audit module exists.
- [ ] Alarm acknowledge action is recorded with user/time.

No SaaS tenant permissions are required in this feature.

---

# 14. Integration and E2E tests

## Task 14A — End-to-end telemetry → alarm

- [ ] Publish/simulate Tag telemetry.
- [ ] Verify current state updates.
- [ ] Verify Rule Engine evaluates.
- [ ] Verify alarm activation after correct delay.
- [ ] Verify alarm visible through API and live UI channel.
- [ ] Acknowledge.
- [ ] Move value into hysteresis band; verify it stays active.
- [ ] Move value into clear range; verify clear after delay.
- [ ] Verify history lifecycle timestamps/duration.

## Task 14B — Rule created after device/tag creation

This is a core RallyX extensibility acceptance test.

- [ ] Add a new Device through normal supported configuration.
- [ ] Add a numeric Tag without source-code changes.
- [ ] Confirm Tag appears in Rule editor selector.
- [ ] Create High Rule for that Tag from UI/API.
- [ ] Feed data that crosses threshold.
- [ ] Verify alarm activates and clears.
- [ ] No backend/frontend recompilation is required to support this individual Device/Tag/Rule configuration beyond normal deployed app behavior.

## Task 14C — Restart recovery E2E

- [ ] Activate an alarm.
- [ ] Restart RallyX Core.
- [ ] Verify same alarm remains active, no duplicate.
- [ ] Clear condition and verify normal clear lifecycle.

## Task 14D — Stale E2E

- [ ] Start telemetry.
- [ ] Stop telemetry.
- [ ] Verify stale alarm after configured duration.
- [ ] Restart Core during stale interval and verify correct elapsed-time behavior.
- [ ] Resume telemetry and verify clear.

---

# 15. Documentation

- [ ] Add `docs/rule-engine.md` describing architecture and user-facing semantics.
- [ ] Document all supported operators.
- [ ] Document hysteresis with High and Low examples.
- [ ] Document activation delay vs clear delay.
- [ ] Document Alarm vs Acknowledge vs Clear.
- [ ] Document bad/stale quality behavior.
- [ ] Document API endpoints.
- [ ] Document demo steps for the four seeded example Rules.
- [ ] Add troubleshooting section: rule never activates, rule never clears, Tag bad quality, stale false-positive.

---

# 16. Main-plan synchronization

After this feature is implemented:

- [ ] Update Milestone 5 checkboxes in `RallyX_IIoT_Platform_AGENT_IMPLEMENTATION_PLAN.md` only for behaviors actually verified.
- [ ] Update relevant Alarm Engine checkboxes in `RallyX_IIoT_Platform_AGENT_CHANGE_SPEC_Local_App_Device_Extensibility.md`.
- [ ] Add a short entry to the main plan Progress Log linking to this feature plan.
- [ ] Do not leave contradictory rule semantics in older docs; mark older generic text as superseded by `RallyX_FEATURE_RULE_ENGINE_AGENT_PLAN.md` where needed.

---

# 17. Definition of Done — Rule Engine V1

Rule Engine V1 is complete only when ALL are true:

- [ ] User can create/edit/delete/enable/disable a Rule from RallyX Web without changing source code.
- [ ] User can select newly configured Tags in Rule editor.
- [ ] Numeric High/Low rules work.
- [ ] Boolean rules work.
- [ ] Equality/inequality rules work for compatible types.
- [ ] Stale communication rule works.
- [ ] ALL/ANY multi-condition rules work.
- [ ] Activation delay works.
- [ ] Clear delay works.
- [ ] Hysteresis prevents threshold chatter.
- [ ] Alarm activation is idempotent.
- [ ] Acknowledge works and does not clear alarm.
- [ ] Clear/history works with duration and timestamps.
- [ ] Rule/Alarm state survives Core restart correctly.
- [ ] Bad/missing/stale quality behavior matches this spec.
- [ ] Disabling an active Rule closes its alarm with `rule_disabled`.
- [ ] Rule Test UI/API evaluates without side effects.
- [ ] Active Alarms updates live.
- [ ] Alarm History is queryable in UI.
- [ ] High Temperature demo scenario passes end-to-end.
- [ ] Motor Run + Low Current composite demo passes end-to-end.
- [ ] Digital Fault demo passes end-to-end.
- [ ] Stale communication demo passes end-to-end.
- [ ] Baseline local load test passes.
- [ ] Documentation is complete.
- [ ] Main agent plan has been synchronized.

---

# 18. Progress Log

2026-10-24 domain foundation: added `internal/rules` pure types/validation/condition and ALL/ANY evaluator with diagnostics/snapshots. Local Go suite passes, including stale anchors, quality, hysteresis, compatible numeric equality and duration bounds; premature bad-quality stale and incompatible inequality were caught and fixed by RED→GREEN regressions. This package is not yet integrated into persistence/runtime/API/UI; those tasks remain open. See `docs/rule-engine.md`.

Agent must append concise entries here after completing a meaningful task/milestone.

| Date | Task | Result | Tests/Verification | Notes / Follow-up |
|---|---|---|---|---|
| | | | | |

---

# Agent execution rule

When implementing this file:

1. Read the main RallyX agent plan and Local App Device Extensibility spec first.
2. Inspect existing repository code before creating files; reuse existing models/services/endpoints where equivalent.
3. Implement tasks in dependency order: schema/domain → pure evaluator → stateful engine → alarm integration → API → UI → E2E.
4. Write tests before or with each behavior; do not postpone all tests to the end.
5. Tick `- [x]` only after the task's verification passes.
6. Do not add SaaS/multi-tenant/cloud scope.
7. Do not put authoritative Rule Engine logic into Node-RED flows.
8. Do not hard-code Motor/Pump/VFD behavior in Rule Engine; all rule evaluation must be Tag/config driven.
9. If this file conflicts with older generic Rule Engine text, this file wins for Rule Engine V1.
10. If a required existing interface differs from the proposed path/name here, adapt to the repo and record the mapping in Progress Log instead of creating duplicate architecture.
