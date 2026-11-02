package storage

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"rallyx.local/core/internal/testutil"
)

func TestSimulationDashboardValidation(t *testing.T) {
	valid := func() SimulationDashboard {
		return SimulationDashboard{Name: "Cabinet", Type: "simulation", Canvas: DefaultSimulationCanvas(), Layout: []SimulationControl{{ID: "lamp", Type: "indicator-lamp", X: 10, Y: 10, Width: 48, Height: 48, Properties: map[string]any{"onColor": "red"}}}}
	}
	cases := map[string]func(*SimulationDashboard){
		"type":            func(d *SimulationDashboard) { d.Type = "unknown" },
		"control type":    func(d *SimulationDashboard) { d.Layout[0].Type = "script" },
		"blank id":        func(d *SimulationDashboard) { d.Layout[0].ID = "" },
		"null properties": func(d *SimulationDashboard) { d.Layout[0].Properties = nil },
		"unsafe scalar": func(d *SimulationDashboard) {
			d.Layout[0].Binding = &SimulationBinding{TagID: "tag", Operator: "direct", CompareValue: map[string]any{"script": "x"}}
		},
		"duplicate":  func(d *SimulationDashboard) { d.Layout = append(d.Layout, d.Layout[0]) },
		"dimension":  func(d *SimulationDashboard) { d.Layout[0].Width = -1 },
		"outside":    func(d *SimulationDashboard) { d.Layout[0].X = 20000 },
		"properties": func(d *SimulationDashboard) { d.Layout[0].Properties["onclick"] = "evil" },
		"operator":   func(d *SimulationDashboard) { d.Layout[0].Binding = &SimulationBinding{TagID: "tag", Operator: "eval"} },
		"limit":      func(d *SimulationDashboard) { d.Layout = make([]SimulationControl, 1001) },
		"gauge": func(d *SimulationDashboard) {
			d.Layout[0].Type = "analog-gauge"
			d.Layout[0].Properties = map[string]any{"min": 10.0, "max": 1.0}
		},
		"image": func(d *SimulationDashboard) { d.Canvas.BackgroundImage = "https://remote/image.png" },
	}
	if err := ValidateSimulationDashboard(valid()); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			d := valid()
			mutate(&d)
			if !errors.Is(ValidateSimulationDashboard(d), ErrValidation) {
				t.Fatal("invalid document accepted")
			}
		})
	}
}

func TestSimulationDashboardCRUD(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	s := Registry{Pool: pool}
	d, err := s.CreateDashboard(ctx, DashboardCreate{Name: "Test cabinet", Type: "simulation"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if d.Canvas.Width != 1200 || d.Revision != 1 || d.Layout == nil {
		t.Fatalf("invalid defaults: %+v", d)
	}
	name := "Renamed"
	layout := []SimulationControl{{ID: "value", Type: "numeric-value", Width: 100, Height: 60, Properties: map[string]any{}, Binding: &SimulationBinding{TagID: "demo-sensor-value", Operator: "direct"}}}
	updated, err := s.UpdateDashboard(ctx, d.ID, DashboardPatch{Name: &name, Layout: &layout, Revision: 1})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != name || updated.Revision != 2 {
		t.Fatal(updated)
	}
	if _, err = s.UpdateDashboard(ctx, d.ID, DashboardPatch{Name: &name, Revision: 1}); !errors.Is(err, ErrRevision) {
		t.Fatal("stale save accepted", err)
	}
	layout[0].Binding.TagID = "does-not-exist"
	if _, err = s.UpdateDashboard(ctx, d.ID, DashboardPatch{Layout: &layout, Revision: 2}); !errors.Is(err, ErrValidation) {
		t.Fatal("missing tag accepted", err)
	}
	got, err := s.GetDashboard(ctx, d.ID)
	if err != nil || got.Name != name || got.Layout[0].Binding.TagID != "demo-sensor-value" {
		t.Fatal(got, err)
	}
	all, err := s.ListDashboards(ctx)
	if err != nil || len(all) == 0 {
		t.Fatal(all, err)
	}
	if err = s.DeleteDashboard(ctx, d.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.GetDashboard(ctx, d.ID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("deleted retained", err)
	}
}
