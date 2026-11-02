package storage

import (
	"math"
	"testing"
)

func TestLampBlinkValidation(t *testing.T) {
	makeDashboard := func(properties map[string]any) SimulationDashboard {
		return SimulationDashboard{Name: "Alarm", Type: "simulation", Canvas: DefaultSimulationCanvas(), Layout: []SimulationControl{{ID: "alarm", Type: "indicator-lamp", Width: 105, Height: 105, Properties: properties}}}
	}
	for _, properties := range []map[string]any{{}, {"mode": "steady"}, {"mode": "blink", "blinkPeriodMs": 200.0}, {"mode": "blink", "blinkPeriodMs": 5000.0}} {
		if err := ValidateSimulationDashboard(makeDashboard(properties)); err != nil {
			t.Errorf("valid %v: %v", properties, err)
		}
	}
	for _, properties := range []map[string]any{{"mode": "flash"}, {"mode": true}, {"blinkPeriodMs": 199.0}, {"blinkPeriodMs": 5001.0}, {"blinkPeriodMs": math.Inf(1)}, {"blinkPeriodMs": "1000"}} {
		if err := ValidateSimulationDashboard(makeDashboard(properties)); err == nil {
			t.Errorf("invalid accepted: %v", properties)
		}
	}
}
