# RallyX Simulation Dashboard — Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use checkbox (`- [ ]`) tracking. Mark a checkbox complete only after implementation **and** the listed verification/tests pass.
>
> This feature must be implemented as a **Dashboard capability**, not as a separate hard-coded HMI product. The core requirement is a reusable, data-driven **Simulation Dashboard Builder** where users can create a visual representation of real electrical cabinets, machines, or process equipment by dragging and configuring generic controls on a free-form canvas.

**Goal:** Add a `Simulation Dashboard` type to RallyX that lets users build free-form 2D mimic dashboards from generic drag/drop controls, bind those controls to RallyX Tags, preview them with simulated values, and view the same dashboard with live read-only field data.

**Architecture:** Keep RallyX Dashboard as the parent concept. Existing value/status/trend widgets remain the standard analytical dashboard experience; Simulation Dashboard adds a free-position canvas, component instances, and Tag bindings. Simulation visuals are configuration data, never hard-coded per cabinet or machine. Runtime consumes the same normalized RallyX Tags and realtime channel already used elsewhere in the platform.

**Tech Stack:** Existing React 19 + TypeScript + Vite frontend, Go RallyX Core, PostgreSQL/TimescaleDB, REST API, existing `/api/v1/ws` realtime mechanism, DOM/SVG rendering, pointer events for canvas interaction. Do not introduce a heavyweight SCADA/canvas framework in V1 unless implementation evidence shows the native approach is inadequate.

**Spec:** `RallyX_FEATURE_SIMULATION_DASHBOARD_AGENT_PLAN.md` (this self-contained document). It supplements `RallyX_IIoT_Platform_AGENT_IMPLEMENTATION_PLAN.md` and must preserve current repository constraints in `AGENTS.md`.

## Global Constraints

- Field integration remains **read-only** in V1. Simulation Dashboard must not write commands to PLCs, VFDs, relays, breakers, or other field devices.
- Do not hard-code the sample ATS/electrical cabinet or any demo-specific asset in application source.
- A Simulation Dashboard must be reconstructable entirely from persisted dashboard configuration plus existing RallyX Tag data.
- Reuse the existing Tag model, current state, quality, timestamps, and realtime connection. Do not create a competing telemetry model.
- Preserve offline/local operation.
- Standard Dashboard and Simulation Dashboard are different presentations of the same platform data; neither replaces the other.
- Avoid arbitrary JavaScript/eval expressions in user bindings. Use a small validated condition/mapping model.
- Existing dashboard behavior must continue to work while this feature is introduced.
- Prefer focused new files over making `DashboardWidgets.tsx` or `App.tsx` substantially larger.

## Review Focus

- Dashboard configurations containing deleted/archived Tags must still open safely and show an explicit unavailable state instead of crashing.
- Malformed layout JSON, unknown control types, invalid dimensions, or out-of-range positions must be rejected or safely normalized.
- Offline/reconnecting states must not display stale values as healthy live state.
- Drag/resize must remain bounded to the canvas and must have a non-drag fallback through numeric property inputs.
- A dashboard with many controls bound to the same Tag must render consistently without multiplying telemetry requests per control.

---

# 0. Product definition

## 0.1 Dashboard is the parent concept

RallyX must treat dashboards as a family of visualizations:

```text
Dashboard
├── Standard Dashboard
│   ├── KPI / value
│   ├── status
│   ├── trend
│   ├── alarm-derived information
│   └── other analytical widgets
│
└── Simulation Dashboard
    ├── free-form 2D canvas
    ├── visual controls / symbols
    ├── Tag bindings
    ├── preview values
    └── live read-only visualization
```

The distinction is intentional:

- **Standard Dashboard** answers: “What useful information does the system data tell me?”
- **Simulation Dashboard** answers: “What does the real cabinet/machine/process look like and what state is it currently in?”

Do not merge both editing models into one complicated editor in V1.

## 0.2 Required outcome

A user must be able to reproduce a cabinet such as an ATS/generator panel without RallyX source-code changes:

```text
                 GRID                     GENERATOR
             R     Y     B              R     Y     B
             ●     ●     ●              ●     ●     ●

                              LOAD
                           R   Y   B
                           ●   ●   ●

                    A        A        A

                             V
```

The user creates this by dragging generic controls, positioning them, editing their properties, and binding them to Tags. The cabinet above is only a use case, not a built-in screen.

## 0.3 V1 terminology

Use these terms consistently in code and UI:

- `Dashboard`: persisted dashboard entity.
- `DashboardType`: `standard | simulation`.
- `SimulationCanvas`: free-form coordinate space.
- `ControlDefinition`: built-in definition/renderer for a generic control type.
- `ControlInstance`: one configured control placed on a dashboard.
- `Binding`: mapping between a ControlInstance property/state and a RallyX Tag.
- `Design mode`: edit layout/configuration.
- `Preview mode`: render with local virtual values only.
- `Live mode`: render with RallyX Tag current state.

Avoid naming the feature “Panel module” or creating a separate product hierarchy. “Panel” may appear in user-created dashboard names, but the feature is **Simulation Dashboard**.

---

# 1. Scope and non-goals

## 1.1 V1 MUST support

- [x] Dashboard list page showing dashboard name and type.
- [x] Create a dashboard and choose `Standard` or `Simulation` type.
- [x] Rename and delete a Simulation Dashboard.
- [x] Open Simulation Dashboard in `Design`, `Preview`, or `Live` mode.
- [x] Free-form canvas with configurable width/height and snap grid.
- [x] Add controls by dragging from the palette.
- [x] Also provide click-to-add for accessibility and touch fallback.
- [x] Select one control on the canvas.
- [x] Move selected control.
- [x] Resize selected control where that control supports resizing.
- [x] Delete selected control.
- [x] Duplicate selected control.
- [x] Edit X, Y, width, height numerically in Properties.
- [x] Bring forward/send backward or equivalent z-order editing.
- [x] Persist dashboard layout and reload it identically.
- [x] Bind controls to existing RallyX Tags without source changes.
- [x] Show Tag quality/offline/unavailable state safely.
- [x] Preview mode with local virtual values for bound Tags.
- [x] Live mode using current RallyX Tag values.
- [x] One saved Simulation Dashboard must work in Preview and Live without maintaining two separate layouts.

## 1.2 V1 control library

Required generic controls:

- [x] `text` — static label such as `ĐIỆN LƯỚI`, `MÁY PHÁT`, `TẢI`.
- [x] `indicator-lamp` — round status lamp with configurable off/on appearance.
- [x] `analog-gauge` — meter with min/max/unit and numeric Tag binding.
- [x] `numeric-value` — numeric/text value with optional unit and precision.
- [x] `rectangle` — background/grouping/visual panel shape.
- [x] `line` — single straight line for mimic/layout drawings.
- [x] `image` — uploaded/background image reference if the existing upload/storage model can support it safely; otherwise V1 may support a configured local/static asset reference and defer upload plumbing.

Controls such as breaker, contactor, motor, pump, fan, selector switch, tank, valve, conveyor and tower light are natural V2 additions. Do not block V1 on a large symbol library.

## 1.3 V1 binding behavior

Required binding modes:

- [x] Direct numeric/string/boolean display.
- [x] Boolean state (`true` / `false`).
- [x] Numeric comparison against one threshold: `>`, `>=`, `<`, `<=`, `=`, `!=`.
- [x] Equality mapping for boolean/string/number values.
- [x] Optional display fallback when Tag is unavailable/bad/stale.

Examples:

```text
Indicator Lamp
Tag: grid_r_ok
Rule: value == true
ON color: red
OFF color: gray
```

```text
Indicator Lamp
Tag: voltage_r
Rule: value >= 180
ON color: red
OFF color: gray
```

```text
Analog Gauge
Tag: current_r
Range: 0..400
Unit: A
Precision: 0
```

Do not allow arbitrary JavaScript, Python, SQL, template execution, or `eval` in V1.

## 1.4 Deferred — DO NOT block V1

- [ ] PLC/field command writing.
- [ ] Interactive push-button commands to real devices.
- [ ] Selector switch command writes.
- [ ] Arbitrary scripting.
- [ ] Animated SVG paths.
- [ ] Piping auto-routing.
- [ ] Multi-select/group editing.
- [ ] Undo/redo history.
- [ ] Reusable user-defined component templates.
- [ ] Import of industrial HMI project formats.
- [ ] Full vector/SVG drawing editor.
- [ ] Multi-page SCADA navigation inside one dashboard.
- [ ] Process animation timeline.
- [ ] Very high-frequency sub-second rendering optimization beyond the existing platform realtime model.

---

# 2. Current codebase constraints and integration points

The current implementation already has:

- `apps/web/src/App.tsx` — sidebar/page routing using the `pages` array and hash navigation.
- `apps/web/src/pages/Overview.tsx` — includes the current `DashboardWidgets` component.
- `apps/web/src/components/DashboardWidgets.tsx` — standard tag widgets (`value`, `status`, `trend`).
- `apps/web/src/stores/usePlatform.ts` — loads platform data and reacts to `/api/v1/ws` events.
- `apps/web/src/types/platform.ts` — shared Tag/Asset/etc frontend types.
- `apps/core/internal/storage/dashboard.go` — persistence for current pinned dashboard widgets.
- `apps/core/internal/api/configuration_tools.go` — current `/api/v1/dashboard` routes.
- `dashboard_widgets` database table — current standard widget persistence.

Important consequence:

**Do not try to turn `dashboard_widgets` into the Simulation canvas by stuffing x/y/width/height into the current `settings` field.** The existing resource models one Tag-centric analytical widget and is intentionally simple. Simulation Dashboard requires a dashboard-level document containing many arbitrary ControlInstances.

V1 should preserve `/api/v1/dashboard` behavior for existing Standard Dashboard widgets while introducing explicit dashboard metadata/configuration for Simulation Dashboard.

---

# 3. Target user workflow

## 3.1 Dashboard list

```text
Dashboard

[+ New Dashboard]

Production Overview            Standard
Energy Monitoring              Standard
ATS Main Cabinet               Simulation
Compressor Control Panel       Simulation
```

Clicking a Simulation Dashboard opens it in Live/View mode by default. Users with edit permission may enter Design mode.

## 3.2 Create Simulation Dashboard

```text
New Dashboard

Name: [ ATS Main Cabinet ]

Type:
( ) Standard Dashboard
(*) Simulation Dashboard

[Create]
```

For V1, if the existing Standard Dashboard is still represented by the legacy `/dashboard` resource, the UI may show it as a single existing Standard Dashboard entry rather than immediately migrating every widget into the new schema. Simulation Dashboard must still use the Dashboard product area and terminology.

## 3.3 Design mode

Recommended composition:

```text
┌────────────────┬───────────────────────────────────────┬───────────────────┐
│ COMPONENTS     │ ATS Main Cabinet                     │ PROPERTIES        │
│                │ [Design] [Preview] [Live] [Save]     │                   │
│ Text           │                                       │ Control           │
│ Lamp           │              CANVAS                   │ Position          │
│ Gauge          │                                       │ Size              │
│ Numeric Value  │                                       │ Appearance        │
│ Rectangle      │                                       │ Binding           │
│ Line           │                                       │ State Mapping     │
│ Image          │                                       │                   │
└────────────────┴───────────────────────────────────────┴───────────────────┘
```

Design requirements:

- Palette on left.
- Canvas in center.
- Properties inspector on right.
- Toolbar for mode, save, grid/snap and duplicate/delete.
- Selected control has visible outline and resize handles.
- Canvas uses local coordinate system independent of browser viewport.
- Saving is explicit in V1; unsaved changes must be clearly indicated.

## 3.4 Preview mode

Preview mode uses temporary virtual values and must never mutate actual RallyX Tag current state.

Example virtual Tag panel:

```text
Preview values

Grid R OK          [ ON ]
Grid Y OK          [ ON ]
Grid B OK          [ ON ]
Generator R OK     [ OFF ]
Current R          [ 125.0 ]
Current Y          [ 128.0 ]
Current B          [ 121.0 ]
Voltage            [ 382.0 ]
```

Controls resolve values in this order:

```text
Preview mode -> virtual value map -> binding resolver -> rendered control
Live mode    -> RallyX Tag state  -> binding resolver -> rendered control
```

The renderer and binding resolver are shared; only the value source changes.

## 3.5 Live mode

- Use current Tag values from existing RallyX data.
- Respect `quality`, stale/offline state and missing timestamps.
- No editing handles.
- No command writes.
- A bad/stale/missing Tag must result in a visibly unavailable state, not a plausible live value.

---

# 4. Domain model

## 4.1 Dashboard metadata

Add a persisted dashboard entity rather than treating a Simulation Dashboard as an ad-hoc frontend file.

Recommended database model:

```sql
CREATE TABLE dashboards (
  id text PRIMARY KEY,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  type text NOT NULL CHECK(type IN ('standard','simulation')),
  owner_user_id text REFERENCES users(id),
  canvas jsonb NOT NULL DEFAULT '{}',
  layout jsonb NOT NULL DEFAULT '[]',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

V1 ownership decision:

- Simulation Dashboards should be workspace-visible, not silently private to one user.
- `created_by` records creator/audit identity.
- `owner_user_id` may remain nullable/reserved if future personal dashboards are planned.
- Editing permission should follow existing RallyX roles; recommended: `admin` can create/edit/delete, `operator/viewer` can view. If the project already has a clearer dashboard permission policy, reuse it instead of inventing a parallel ACL system.

If the team chooses to migrate Standard Dashboard widgets under `dashboards`, do it as a separate compatibility step with explicit tests. Do not break the current `/api/v1/dashboard` endpoint during Simulation V1.

## 4.2 Canvas configuration

Frontend/backend type:

```ts
export type SimulationCanvas = {
  width: number;
  height: number;
  gridSize: number;
  snapToGrid: boolean;
  backgroundColor?: string;
  backgroundImage?: string;
};
```

Validation defaults:

- `width`: default `1200`, allowed `320..10000`.
- `height`: default `800`, allowed `240..10000`.
- `gridSize`: default `10`, allowed `1..100`.
- `snapToGrid`: default `true`.

## 4.3 ControlInstance

```ts
export type SimulationControlType =
  | 'text'
  | 'indicator-lamp'
  | 'analog-gauge'
  | 'numeric-value'
  | 'rectangle'
  | 'line'
  | 'image';

export type ControlInstance = {
  id: string;
  type: SimulationControlType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  properties: Record<string, unknown>;
  binding?: ControlBinding;
};
```

V1 rotation:

- Data model may retain `rotation` for forward compatibility.
- Only implement rotation UI for controls where it is straightforward; `line` may use it first.
- Unsupported rotation must not break rendering.

## 4.4 Binding

```ts
export type BindingOperator = 'direct' | '==' | '!=' | '>' | '>=' | '<' | '<=';

export type ControlBinding = {
  tagId: string;
  operator: BindingOperator;
  compareValue?: boolean | number | string;
};
```

The same persisted binding contract must be validated by backend and frontend.

## 4.5 Control properties

Do not allow arbitrary properties to leak into every renderer. Maintain a control registry defining:

- type id
- display name
- default dimensions
- default properties
- editable property schema
- whether resizable
- renderer
- optional binding compatibility (`boolean`, `number`, `string`, `any`)

Example conceptual registry:

```ts
controlRegistry['indicator-lamp'] = {
  defaultSize: { width: 48, height: 48 },
  defaultProperties: {
    onColor: 'red',
    offColor: 'gray',
    label: ''
  },
  bindingTypes: ['boolean', 'number', 'string']
};
```

The registry is application code. Individual cabinet/machine instances are data.

---

# 5. Persistence and API

## 5.1 New API resource

Recommended endpoints:

```text
GET    /api/v1/dashboards
POST   /api/v1/dashboards
GET    /api/v1/dashboards/{id}
PATCH  /api/v1/dashboards/{id}
DELETE /api/v1/dashboards/{id}
```

Simulation create request:

```json
{
  "name": "ATS Main Cabinet",
  "type": "simulation"
}
```

Simulation update request may include:

```json
{
  "name": "ATS Main Cabinet",
  "canvas": {
    "width": 1200,
    "height": 800,
    "gridSize": 10,
    "snapToGrid": true
  },
  "layout": [
    {
      "id": "control_01",
      "type": "indicator-lamp",
      "x": 100,
      "y": 80,
      "width": 48,
      "height": 48,
      "rotation": 0,
      "zIndex": 1,
      "properties": {
        "onColor": "red",
        "offColor": "gray",
        "label": "R"
      },
      "binding": {
        "tagId": "grid_r_ok",
        "operator": "==",
        "compareValue": true
      }
    }
  ]
}
```

## 5.2 Backend validation

Backend must reject:

- unknown `type` values;
- duplicate control IDs inside a layout;
- non-object control properties;
- missing/empty control IDs;
- non-finite/negative dimensions;
- coordinates outside an intentionally generous safe numeric range;
- unsupported binding operators;
- missing `tagId` when a binding exists;
- bindings referencing Tags that do not exist or are archived, at save time if practical;
- layout arrays above a documented safety limit.

Recommended V1 limit: maximum `1000` controls per Simulation Dashboard and maximum request body consistent with existing API body limits. If current `readObject` is capped at ~2 MB, keep layout payload under that limit and return validation errors clearly.

Backend should normalize or reject unsafe values; do not depend only on frontend validation.

## 5.3 Audit/realtime

- Create/update/delete must write audit events using the repository's existing pattern.
- Broadcast a lightweight realtime event such as `{ "type": "dashboard" }` after saved changes.
- Do not broadcast entire dashboard layouts on every edit operation; V1 uses explicit save.

---

# 6. Frontend architecture

Recommended files:

```text
apps/web/src/pages/
  Dashboards.tsx
  SimulationDashboard.tsx

apps/web/src/components/dashboard/
  DashboardList.tsx

apps/web/src/components/simulation/
  SimulationEditor.tsx
  SimulationCanvas.tsx
  ControlPalette.tsx
  PropertyInspector.tsx
  PreviewValues.tsx
  controlRegistry.ts
  binding.ts
  geometry.ts
  controls/
    TextControl.tsx
    IndicatorLampControl.tsx
    AnalogGaugeControl.tsx
    NumericValueControl.tsx
    RectangleControl.tsx
    LineControl.tsx
    ImageControl.tsx

apps/web/src/types/
  dashboard.ts
```

Tests should live adjacent to existing frontend test conventions.

## 6.1 Rendering model

Use a DOM canvas container with `position: relative` and render each control as an absolutely positioned child:

```text
SimulationCanvas
  ├── ControlInstance A
  ├── ControlInstance B
  ├── ControlInstance C
  └── ...
```

Each instance receives:

```text
instance configuration
+ resolved value
+ resolved quality/availability
+ mode
```

Do not let individual controls fetch `/tags` or open WebSockets. Data must be provided from the page-level Tag map so 100 controls do not cause 100 network subscriptions.

## 6.2 Tag lookup

Create one lookup per render/update:

```ts
Map<tagId, Tag>
```

The binding resolver consumes the lookup and returns a renderer-friendly state.

## 6.3 Binding resolver

Recommended pure function interface:

```ts
resolveControlBinding(
  binding: ControlBinding | undefined,
  tag: Tag | undefined,
  previewValue: unknown,
  mode: 'design' | 'preview' | 'live',
  offline: boolean
): ResolvedBinding
```

`ResolvedBinding` should explicitly represent:

```text
value
conditionMatched
available
quality
reason
```

Rules:

- Design mode may show representative/default state but never pretend it is live.
- Preview mode uses preview value map and does not require live Tag quality.
- Live mode is unavailable if platform is offline, Tag missing, disabled, not realtime-enabled where applicable, stale, bad quality, or current value missing.
- Unknown/unsupported value types return unavailable rather than throwing.

## 6.4 Drag and resize

V1 interaction rules:

- Palette item drag/drop creates a new ControlInstance at the canvas drop position.
- Palette item click creates the control centered in the current visible canvas area or at a deterministic default position.
- Pointer drag moves a selected control.
- Resize handles change width/height.
- Movement/resize is clamped to canvas bounds.
- Snap-to-grid rounds final position/size when enabled.
- Property X/Y/W/H inputs provide exact editing and accessibility fallback.
- Do not persist on every pointer move. Update local state, mark dashboard dirty, persist on explicit Save.

## 6.5 Selection and keyboard behavior

Minimum keyboard support in V1:

- `Delete`/`Backspace` deletes selected control only when focus is not inside an input/textarea/select.
- Arrow keys nudge selected control by 1 px; with snap workflow, optional Shift may use `gridSize`.
- Escape clears selection.

Do not intercept keyboard events globally outside the editor.

---

# 7. Control behavior

## 7.1 Text

Properties:

```text
text
fontSize
fontWeight
textAlign
```

No binding required in V1.

## 7.2 Indicator Lamp

Properties:

```text
label
onColor
offColor
borderStyle
```

Binding:

- boolean direct/equality;
- numeric/string comparison using the validated operator model.

Unavailable state must be visually distinct from OFF. For example, use a muted/hatched state or explicit `?`; do not silently treat unavailable as false.

## 7.3 Analog Gauge

Properties:

```text
min
max
unit
precision
label
```

Binding requires numeric Tag/value.

Rendering should use SVG so the needle and scale remain crisp at different sizes.

Invalid/out-of-range numeric values:

- Clamp needle to visual min/max.
- Display actual value if finite and available, or clearly indicate out-of-range if desired.
- Never render NaN/Infinity.

## 7.4 Numeric Value

Properties:

```text
label
unit
precision
prefix
suffix
```

Supports boolean/number/string direct display, with numeric precision only when value is numeric.

## 7.5 Rectangle

Properties:

```text
fill
borderColor
borderWidth
borderRadius
```

No binding in V1.

## 7.6 Line

Properties:

```text
stroke
strokeWidth
lineStyle
```

No binding in V1.

## 7.7 Image

Properties:

```text
source
objectFit
opacity
```

Use cases:

- background photo of a real cabinet;
- equipment diagram;
- logo or static machine image.

Do not require image upload plumbing if it would substantially expand V1. If source management is deferred, hide/disable unsupported upload UI rather than shipping a broken control.

---

# 8. Standard Dashboard compatibility

The existing `DashboardWidgets` implementation remains useful and should continue representing Standard Dashboard widgets.

Do not:

- remove current value/status/trend widgets;
- convert existing widgets to free-form controls in V1;
- require users to rebuild current dashboard widgets;
- change existing Tag history requirements for trend widgets solely for Simulation Dashboard.

The Dashboard navigation may initially expose:

```text
Dashboard
├── My Dashboard / Standard
└── Simulation Dashboards
```

and later evolve to a unified list once metadata migration is complete.

Product language must still describe Simulation as a Dashboard type, not a separate field-control module.

---

# 9. Roles and safety

Recommended V1 permissions:

```text
admin     create / edit / delete / view
operator  view
viewer    view
```

If later required, allow operators to edit Preview values locally because Preview values are not field commands; however do not mix that with persistent configuration permission without an explicit product decision.

Simulation Dashboard is visualization only:

```text
LIVE TAG -> VISUAL STATE
```

Never:

```text
VISUAL CONTROL -> FIELD WRITE
```

in V1.

---

# 10. File map for implementation

Backend:

```text
apps/core/migrations/004_simulation_dashboards.up.sql
  - add dashboard metadata/layout persistence

apps/core/internal/storage/dashboards.go
  - dashboard CRUD + validation helpers

apps/core/internal/storage/dashboards_test.go
  - persistence and validation tests

apps/core/internal/api/dashboards.go
  - REST route registration + role enforcement

apps/core/internal/api/dashboards_test.go
  - API behavior tests

apps/core/internal/api/server.go
  - register dashboard routes only; avoid embedding implementation here
```

Frontend:

```text
apps/web/src/types/dashboard.ts
  - dashboard/canvas/control/binding types

apps/web/src/pages/Dashboards.tsx
  - list/create/open dashboards

apps/web/src/pages/SimulationDashboard.tsx
  - load/save/mode orchestration

apps/web/src/components/simulation/controlRegistry.ts
  - generic control definitions/defaults

apps/web/src/components/simulation/binding.ts
  - pure binding resolver

apps/web/src/components/simulation/geometry.ts
  - clamp/snap/move/resize helpers

apps/web/src/components/simulation/ControlPalette.tsx
  - create controls

apps/web/src/components/simulation/SimulationCanvas.tsx
  - free-form canvas, selection, drag/resize

apps/web/src/components/simulation/PropertyInspector.tsx
  - position/size/properties/binding editor

apps/web/src/components/simulation/PreviewValues.tsx
  - local virtual Tag values

apps/web/src/components/simulation/controls/*
  - individual renderers

apps/web/src/App.tsx
  - add Dashboard navigation/page selection only

apps/web/src/theme.css
  - simulation editor styles, scoped to simulation classes
```

Do not place the complete editor in `App.tsx` or `DashboardWidgets.tsx`.

---

# 11. Implementation tasks

### Task 1: Dashboard persistence contract

**Files:**
- Create: `apps/core/migrations/004_simulation_dashboards.up.sql`
- Create: `apps/core/internal/storage/dashboards.go`
- Create: `apps/core/internal/storage/dashboards_test.go`

**Interfaces:**
- Produces persisted dashboard entity with `id`, `name`, `type`, `canvas`, `layout`, audit timestamps.
- Produces storage methods consumed by Task 2.

- [x] **Step 1: Write failing storage tests** covering create/list/get/update/delete, invalid dashboard type, malformed layout, duplicate control IDs, invalid dimensions, invalid binding operator, and control-count limit.
- [x] **Step 2: Run `go test ./internal/storage/...` from `apps/core` and confirm the new tests fail.**
- [x] **Step 3: Add migration and storage implementation with backend validation.**
- [x] **Step 4: Run `go test ./internal/storage/...` and confirm all tests pass.**
- [x] **Step 5: Commit** with a focused message such as `Add simulation dashboard persistence`.

### Task 2: Dashboard REST API

**Files:**
- Create: `apps/core/internal/api/dashboards.go`
- Create: `apps/core/internal/api/dashboards_test.go`
- Modify: `apps/core/internal/api/server.go`

**Interfaces:**
- Consumes storage methods from Task 1.
- Produces `/api/v1/dashboards` CRUD endpoints for frontend Tasks 4+.

- [x] **Step 1: Write failing API tests** for authenticated list/get, admin create/update/delete, viewer/operator read behavior, forbidden edits, 404, validation errors, and audit/realtime behavior where testable.
- [x] **Step 2: Run targeted Go API tests and verify failure.**
- [x] **Step 3: Implement route registration in a focused `dashboards.go` file.**
- [x] **Step 4: Run Go API tests and full Core tests.**
- [x] **Step 5: Commit** `Add simulation dashboard API`.

### Task 3: Frontend types, geometry and binding resolver

**Files:**
- Create: `apps/web/src/types/dashboard.ts`
- Create: `apps/web/src/components/simulation/geometry.ts`
- Create: `apps/web/src/components/simulation/geometry.test.ts`
- Create: `apps/web/src/components/simulation/binding.ts`
- Create: `apps/web/src/components/simulation/binding.test.ts`

**Interfaces:**
- Produces `Dashboard`, `SimulationCanvas`, `ControlInstance`, `ControlBinding`, `ResolvedBinding`.
- Produces pure geometry helpers and `resolveControlBinding(...)` used by editor/renderers.

- [x] **Step 1: Write failing tests** for snap, clamp, move, resize, direct binding, threshold binding, missing Tag, bad quality, stale/offline state, Preview value override, and unsupported value type.
- [x] **Step 2: Run `npm test -- --run` in `apps/web` and verify failure.**
- [x] **Step 3: Implement exact types and pure helpers without React dependencies where practical.**
- [x] **Step 4: Run frontend tests and TypeScript lint.**
- [x] **Step 5: Commit** `Add simulation dashboard domain helpers`.

### Task 4: Control registry and renderers

**Files:**
- Create: `apps/web/src/components/simulation/controlRegistry.ts`
- Create: `apps/web/src/components/simulation/controls/TextControl.tsx`
- Create: `apps/web/src/components/simulation/controls/IndicatorLampControl.tsx`
- Create: `apps/web/src/components/simulation/controls/AnalogGaugeControl.tsx`
- Create: `apps/web/src/components/simulation/controls/NumericValueControl.tsx`
- Create: `apps/web/src/components/simulation/controls/RectangleControl.tsx`
- Create: `apps/web/src/components/simulation/controls/LineControl.tsx`
- Create: `apps/web/src/components/simulation/controls/ImageControl.tsx`
- Create: renderer/registry tests following existing Vitest patterns.

**Interfaces:**
- Consumes Task 3 types and resolved binding.
- Produces registry lookup and renderer components consumed by SimulationCanvas.

- [x] **Step 1: Write failing tests** proving every required type has defaults/renderer, unavailable lamp differs from OFF, gauge never renders NaN, numeric value respects precision, and unknown control type falls back safely.
- [x] **Step 2: Run targeted frontend tests and verify failure.**
- [x] **Step 3: Implement registry and minimal renderers.**
- [x] **Step 4: Run frontend tests and lint.**
- [x] **Step 5: Commit** `Add simulation dashboard controls`.

### Task 5: Simulation canvas editing

**Files:**
- Create: `apps/web/src/components/simulation/SimulationCanvas.tsx`
- Create: `apps/web/src/components/simulation/ControlPalette.tsx`
- Create: `apps/web/src/components/simulation/PropertyInspector.tsx`
- Create: `apps/web/src/components/simulation/SimulationEditor.tsx`
- Create matching tests.

**Interfaces:**
- Consumes control registry, geometry helpers and dashboard types.
- Produces `SimulationEditor` accepting dashboard state and `onChange(nextDashboard)`.

Recommended top-level component interface:

```ts
type SimulationEditorProps = {
  dashboard: Dashboard;
  tags: Tag[];
  mode: 'design' | 'preview' | 'live';
  previewValues: Record<string, unknown>;
  offline: boolean;
  onChange: (dashboard: Dashboard) => void;
};
```

- [x] **Step 1: Write failing interaction tests** for click-to-add, drag/drop add, selection, numeric position editing, move clamp, resize clamp, snap-to-grid, duplicate, delete and z-order changes.
- [x] **Step 2: Run targeted tests and verify failure.**
- [x] **Step 3: Implement local editor interactions using pointer events and scoped keyboard listeners.**
- [x] **Step 4: Verify keyboard behavior does not delete controls while editing an input.**
- [x] **Step 5: Run frontend tests/lint.**
- [x] **Step 6: Commit** `Add freeform simulation dashboard editor`.

### Task 6: Preview and Live runtime

**Files:**
- Create: `apps/web/src/components/simulation/PreviewValues.tsx`
- Modify: `SimulationEditor.tsx` and/or `SimulationCanvas.tsx`
- Create matching tests.

**Interfaces:**
- Consumes Task 3 binding resolver.
- Produces one shared rendering path for Design/Preview/Live modes with different value sources.

- [x] **Step 1: Write failing tests** proving Preview never mutates real Tag state, Live uses Tag value/quality, offline state marks controls unavailable, and multiple controls bound to one Tag require no per-control request.
- [x] **Step 2: Run tests and verify failure.**
- [x] **Step 3: Implement PreviewValues and shared value-source selection.**
- [x] **Step 4: Run tests/lint.**
- [x] **Step 5: Commit** `Add simulation preview and live modes`.

### Task 7: Dashboard pages and navigation

**Files:**
- Create: `apps/web/src/pages/Dashboards.tsx`
- Create: `apps/web/src/pages/SimulationDashboard.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/theme.css`
- Add page tests.

**Interfaces:**
- Consumes `/api/v1/dashboards` and SimulationEditor.
- Produces end-user Dashboard navigation and create/open/save flows.

- [x] **Step 1: Write failing page tests** for dashboard listing, Simulation badge/type, admin create, read-only viewer behavior, opening Live mode, entering Design mode, dirty state, Save and reload persistence.
- [x] **Step 2: Run frontend tests and verify failure.**
- [x] **Step 3: Implement Dashboard navigation without removing the current Standard Dashboard widgets.**
- [x] **Step 4: Add responsive/scoped editor styles and verify narrow viewport still exposes Properties through reflow rather than page-level clipping.**
- [x] **Step 5: Run frontend tests, lint and build.**
- [x] **Step 6: Commit** `Add simulation dashboards to workspace UI`.

### Task 8: End-to-end representative cabinet

**Files:**
- Modify/add E2E tests under `tests/e2e/` following existing test style.
- Do **not** add a hard-coded production cabinet screen to source.

**Interfaces:**
- Verifies the feature can represent a real-world electrical cabinet from generic controls.

- [x] **Step 1: Add an E2E test that creates a Simulation Dashboard through supported API/UI flow.**
- [x] **Step 2: Add controls representing `GRID`, `GENERATOR`, `LOAD`, three current gauges and one voltage gauge using generic types.**
- [x] **Step 3: Bind test controls to simulator Tags and verify Preview values change visual state.**
- [x] **Step 4: Switch to Live mode and verify current simulated RallyX Tag data drives the same controls.**
- [x] **Step 5: Restart/reload and verify the dashboard layout persists identically.**
- [x] **Step 6: Run `make test` and the repository's E2E command.**
- [x] **Step 7: Commit** `Verify simulation dashboard end to end`.

### Task 9: Documentation and final verification

**Files:**
- Modify relevant `docs/` architecture/UI documentation.
- Update implementation/progress ledger if the repository uses it for completed feature tracking.

- [x] **Step 1: Document the difference between Standard and Simulation Dashboard.**
- [x] **Step 2: Document Design / Preview / Live behavior and read-only field limitation.**
- [x] **Step 3: Document the ControlInstance and Binding configuration contract.**
- [x] **Step 4: Run full verification:** `make test`, frontend build/lint, Core tests, and E2E suite available in the repository.
- [x] **Step 5: Confirm no demo cabinet is hard-coded into product code.**
- [x] **Step 6: Confirm existing Standard Dashboard widgets still work.**
- [x] **Step 7: Commit** `Document simulation dashboard builder`.

---

# 12. Acceptance criteria

Simulation Dashboard V1 is complete only when all statements below are true:

- [x] A new cabinet/machine mimic can be created without changing React/Go source.
- [x] The user can create a Simulation Dashboard, drag or add controls, move them, resize them, configure them and save the layout.
- [x] The saved dashboard reloads with the same layout.
- [x] A control can be bound to any compatible existing RallyX Tag through UI configuration.
- [x] Indicator lamps support boolean or simple comparison-based state.
- [x] Analog gauges use numeric Tags and configurable range/unit.
- [x] Preview mode accepts local virtual values and changes visuals immediately without writing platform Tag state.
- [x] Live mode uses the same layout with RallyX current Tag values.
- [x] Bad/stale/offline/missing Tag state is visually distinct from a legitimate OFF/zero value.
- [x] Standard Dashboard value/status/trend behavior remains available.
- [x] No control issues field commands in V1.
- [x] No sample ATS/generator cabinet is hard-coded as a required product layout.
- [x] Backend rejects unsupported control/binding payloads instead of persisting arbitrary executable logic.
- [x] Automated tests cover binding, geometry, persistence, role restrictions and one representative end-to-end cabinet build.

---

# 13. Agent decision rules

When implementation details are ambiguous, use these rules in order:

1. Preserve existing RallyX behavior before adding new architecture.
2. Keep Simulation Dashboard configuration data-driven.
3. Reuse normalized Tags/current state rather than device/vendor-specific logic.
4. Keep V1 field interaction read-only.
5. Prefer small validated data models over arbitrary scripting.
6. Prefer a small generic control set over many special-case cabinet components.
7. Keep editing state local until explicit Save.
8. Keep renderers pure where possible and put Tag interpretation in the binding resolver.
9. Do not optimize for sub-second SCADA refresh until profiling shows the current platform realtime model is inadequate.
10. If a requested improvement would turn V1 into a full SCADA/HMI authoring suite, defer it and finish the generic Dashboard Simulation foundation first.

---

# 14. Expected V1 result

A RallyX user should be able to open Dashboard, create `ATS Main Cabinet` as a Simulation Dashboard, place text labels, nine indicator lamps, three current gauges and one voltage gauge, bind them to simulator/live Tags, save the design, test it in Preview mode, and then switch to Live mode to see the real RallyX Tag state represented visually.

The exact same engine must also be capable of representing another cabinet or machine with a different arrangement without a source-code change. That generic capability—not the sample cabinet itself—is the feature to deliver.


## Verified implementation — 2026-11-02

V1 scope and tasks 1–9 are implemented and verified. Deferred section 1.4 stays open. Actual focused files use simulation-prefixed Core names, types/simulation.ts, components/simulation and pages/simulation plus DashboardHub; migration 012 is additive because 001–011 were already deployed. Existing native analytical dashboards remain the Standard entry; choosing Standard opens that shared workspace, as permitted by section 3.2. Images use configured local raster assets; uploads remain deferred.

Evidence and known limits: docs/simulation-dashboard-verification.md. Root test task passed; final Web suite 149/149, real PostgreSQL/MQTT Core suite, build/lint, 11/11 broad Chromium cases, native entity/template E2E, baseline platform E2E, generic cabinet browser acceptance and identical-layout restart checks passed. No field writes or hard-coded production cabinet were added.