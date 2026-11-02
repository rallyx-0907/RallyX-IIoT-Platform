# Alarm lamp blink mode

Each indicator lamp now has a saved mode (`steady` or `blink`) and optional `blinkPeriodMs` (200–5000 ms, default 1000). Existing documents without these properties keep steady behavior. Configuration is available in Vietnamese through the existing Properties inspector; no migration is required.

Blink applies only to an available, active binding. Its circle alternates between the configured ON/OFF colors; label and status stay stable. OFF and unavailable states stop the animation. Preview uses the same renderer with browser-local values. Reduced-motion preference suppresses animation while retaining active color and the textual alarm indication. No field writes or new Rule Engine behavior are introduced.

Verification:

- Renderer and Core validation tests failed on the previous implementation and pass with the new behavior.
- Full Web suite: 172 tests pass. An additional editor test was added afterward; the complete nine-test editor suite passes, including translated mode selection and period clamping.
- Full Core suite with real PostgreSQL/MQTT passes; TypeScript lint and Core/Web production builds pass.
- `tests/e2e/indicator-lamp-layout.test.mjs` confirms two actual animated fill colors, 800 ms configured period, steady/OFF/unavailable behavior, reduced motion, local Preview, persisted properties after reload, seven control sizes and desktop/narrow geometry.

The Slave ID 1 demo is configured with 1000 ms blink on Alarm Bell and Motor 1/2/3 FAULT only. Register value 1 activates the lamp; value 0 keeps it OFF. Other controls and source data retain their existing configuration.
