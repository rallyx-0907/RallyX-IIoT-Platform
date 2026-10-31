package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
	"testing"
)

func TestDeviceTemplateAutomaticallyProvisionsSemanticDashboard(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	s := Registry{Pool: pool}
	actor := auth.RandomID()
	if _, err := pool.Exec(ctx, "INSERT INTO users(id,username,password_hash,role_id) VALUES($1,$1,'fixture','admin')", actor); err != nil {
		t.Fatal(err)
	}
	defs := []any{}
	for i := 0; i < 10; i++ {
		key := fmt.Sprintf("power_%d", i)
		if i == 0 {
			key = "1"
		}
		defs = append(defs, map[string]any{"key": key, "name": fmt.Sprintf("Power %d", i), "data_type": "uint16", "unit": " kW ", "store_history": true, "metadata": map[string]any{"simulator_value": float64(i)}})
	}
	raw, err := s.Write(ctx, "device_templates", "", map[string]any{"name": "Automatic ten-point template", "protocol": "simulator", "tag_definitions": defs}, actor)
	if err != nil {
		t.Fatal(err)
	}
	var template struct{ ID string }
	if err = json.Unmarshal(raw, &template); err != nil {
		t.Fatal(err)
	}
	create := func() Entity {
		raw, err := s.Write(ctx, "devices", "", map[string]any{"name": "Automatic device", "asset_id": "demo-motor", "connection_id": "demo-simulator", "template_id": template.ID}, actor)
		if err != nil {
			t.Fatal(err)
		}
		var device struct{ ID string }
		_ = json.Unmarshal(raw, &device)
		e, err := s.GetEntity(ctx, "legacy:devices:"+device.ID)
		if err != nil {
			t.Fatal(err)
		}
		return e
	}
	first := create()
	if first.ProfileID == nil {
		t.Fatal("device created from template has no generated profile")
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM entity_metric_bindings WHERE entity_id=$1", first.ID).Scan(&count); err != nil || count != 10 {
		t.Fatalf("automatic mapping: %d %v", count, err)
	}
	doc, version, err := s.ResolveEntityDashboard(ctx, first.ID)
	if err != nil || len(doc.Pages[0].Widgets) == 0 || version.TemplateID == "rallyx-entity-overview" {
		t.Fatal("no generated native dashboard")
	}
	if _, err = s.Write(ctx, "device_templates", template.ID, map[string]any{"name": "Updated ten-point template"}, actor); err != nil {
		t.Fatal(err)
	}
	second := create()
	if *second.ProfileID != *first.ProfileID || *second.ProfileVersion == *first.ProfileVersion {
		t.Fatal("template versions must reuse profile identity and keep existing devices pinned")
	}
	again, _ := s.GetEntity(ctx, first.ID)
	if *again.ProfileVersion != *first.ProfileVersion {
		t.Fatal("template update changed existing device profile")
	}
	if err = s.EnsureDeviceTemplateDefaults(ctx); err != nil {
		t.Fatal(err)
	}
	pinned, _ := s.GetEntity(ctx, first.ID)
	if *pinned.ProfileVersion != *first.ProfileVersion {
		t.Fatal("startup default initialization changed an existing profile pin")
	}
}
