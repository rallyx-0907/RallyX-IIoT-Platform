package storage

import (
	"context"
	"errors"
	"math"
	"rallyx.local/core/internal/testutil"
	"strings"
	"testing"
)

func selectorDashboard(values ...any) SimulationDashboard {
	positions := []any{}
	for _, value := range values {
		positions = append(positions, map[string]any{"value": value, "label": "Position"})
	}
	return SimulationDashboard{Name: "Selector", Type: "simulation", Canvas: DefaultSimulationCanvas(), Layout: []SimulationControl{{ID: "selector", Type: "selector-switch", Width: 180, Height: 160, Properties: map[string]any{"positions": positions}}}}
}

func TestSelectorSwitchValidation(t *testing.T) {
	for _, values := range [][]any{{0.0, 1.0}, {0.0, 1.0, 2.0}, {false, true}, {"off", "auto", "manual"}} {
		if err := ValidateSimulationDashboard(selectorDashboard(values...)); err != nil {
			t.Errorf("valid positions %v: %v", values, err)
		}
	}
	valid := selectorDashboard(0.0, 1.0)
	for key, value := range map[string]any{"label": "Mode", "orientation": "vertical", "knobStyle": "lever", "activeColor": "#ff0", "inactiveColor": "gray", "textSize": 32.0, "knobSize": 120.0} {
		valid.Layout[0].Properties[key] = value
	}
	valid.Layout[0].Binding = &SimulationBinding{TagID: "tag", Operator: "direct"}
	if err := ValidateSimulationDashboard(valid); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*SimulationControl){
		"four positions": func(c *SimulationControl) {
			c.Properties["positions"] = selectorDashboard(0.0, 1.0, 2.0, 3.0).Layout[0].Properties["positions"]
		},
		"malformed positions": func(c *SimulationControl) { c.Properties["positions"] = "off,on" },
		"malformed position":  func(c *SimulationControl) { c.Properties["positions"] = []any{"off", "on"} },
		"null label":          func(c *SimulationControl) { c.Properties["positions"].([]any)[0].(map[string]any)["label"] = nil },
		"missing positions":   func(c *SimulationControl) { delete(c.Properties, "positions") },
		"one position": func(c *SimulationControl) {
			c.Properties["positions"] = []any{map[string]any{"value": 0.0, "label": "Off"}}
		},
		"duplicate": func(c *SimulationControl) {
			c.Properties["positions"] = selectorDashboard(1.0, 1.0).Layout[0].Properties["positions"]
		},
		"mixed": func(c *SimulationControl) {
			c.Properties["positions"] = selectorDashboard(1.0, "1").Layout[0].Properties["positions"]
		},
		"null": func(c *SimulationControl) {
			c.Properties["positions"] = selectorDashboard(nil, 1.0).Layout[0].Properties["positions"]
		},
		"nonfinite": func(c *SimulationControl) {
			c.Properties["positions"] = selectorDashboard(math.Inf(1), 1.0).Layout[0].Properties["positions"]
		},
		"three bool": func(c *SimulationControl) {
			c.Properties["positions"] = selectorDashboard(false, true, false).Layout[0].Properties["positions"]
		},
		"unknown nested": func(c *SimulationControl) { c.Properties["positions"].([]any)[0].(map[string]any)["onclick"] = "evil" },
		"missing label":  func(c *SimulationControl) { delete(c.Properties["positions"].([]any)[0].(map[string]any), "label") },
		"long label": func(c *SimulationControl) {
			c.Properties["positions"].([]any)[0].(map[string]any)["label"] = strings.Repeat("?", 81)
		},
		"orientation": func(c *SimulationControl) { c.Properties["orientation"] = "diagonal" },
		"style":       func(c *SimulationControl) { c.Properties["knobStyle"] = "push" },
		"text size":   func(c *SimulationControl) { c.Properties["textSize"] = 33.0 },
		"knob size":   func(c *SimulationControl) { c.Properties["knobSize"] = 23.0 },
		"comparison": func(c *SimulationControl) {
			c.Binding = &SimulationBinding{TagID: "tag", Operator: "==", CompareValue: 1.0}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			d := selectorDashboard(0.0, 1.0)
			mutate(&d.Layout[0])
			if !errors.Is(ValidateSimulationDashboard(d), ErrValidation) {
				t.Fatal("invalid selector accepted")
			}
		})
	}
}

func TestSelectorSwitchTagDatatype(t *testing.T) {
	pool := testutil.Database(t)
	s := Registry{Pool: pool}
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO tags(id,asset_id,device_id,key,name,datatype,data_type) VALUES('selector-test-string','demo-sensor','demo-sensor-device','selector-mode','Mode','string','string')`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM tags WHERE id='selector-test-string'") })
	for _, tc := range []struct {
		tag    string
		values []any
	}{
		{"demo-motor-run", []any{false, true}},
		{"selector-test-string", []any{"off", "manual", "auto"}},
	} {
		d := selectorDashboard(tc.values...)
		d.Layout[0].Binding = &SimulationBinding{TagID: tc.tag, Operator: "direct"}
		saved, err := s.CreateDashboard(ctx, DashboardCreate{Name: d.Name, Type: d.Type, Layout: d.Layout}, "")
		if err != nil {
			t.Fatal(err)
		}
		layout := saved.Layout
		layout[0].Properties["positions"] = selectorDashboard(0.0, 1.0).Layout[0].Properties["positions"]
		if _, err = s.UpdateDashboard(ctx, saved.ID, DashboardPatch{Layout: &layout, Revision: saved.Revision}); !errors.Is(err, ErrValidation) {
			t.Fatalf("incompatible update accepted: %v", err)
		}
		if err = s.DeleteDashboard(ctx, saved.ID); err != nil {
			t.Fatal(err)
		}
	}

	for _, values := range [][]any{{0.0, 1.0}, {false, true}, {"off", "on"}} {
		d := selectorDashboard(values...)
		d.Layout[0].Binding = &SimulationBinding{TagID: "demo-sensor-value", Operator: "direct"}
		saved, err := s.CreateDashboard(ctx, DashboardCreate{Name: d.Name, Type: d.Type, Layout: d.Layout}, "")
		if _, numeric := values[0].(float64); numeric {
			if err != nil {
				t.Fatal(err)
			}
			if err = s.DeleteDashboard(ctx, saved.ID); err != nil {
				t.Fatal(err)
			}
		} else if !errors.Is(err, ErrValidation) {
			t.Fatalf("incompatible positions accepted: %v", err)
		}
	}
}
