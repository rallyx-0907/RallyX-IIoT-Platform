package storage

import (
	"context"
	"rallyx.local/core/internal/auth"
	"strings"
	"testing"

	"rallyx.local/core/internal/testutil"
)

func TestEntityHierarchyAndLegacyBridge(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	s := Registry{Pool: pool}
	typeKey := "cold-room-" + auth.RandomID()[:12]
	if _, err := s.SaveEntityType(ctx, typeKey, EntityTypeInput{Name: "Cold room", Fields: []MetadataField{{Key: "capacity", Type: "number", Required: true}}}); err != nil {
		t.Fatal(err)
	}
	root, err := s.SaveEntity(ctx, "", EntityInput{Name: "Factory test", TypeKey: "group", Metadata: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	child, err := s.SaveEntity(ctx, "", EntityInput{Name: "Room", TypeKey: typeKey, ParentID: root.ID, Metadata: map[string]any{"capacity": 12.0}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveEntity(ctx, root.ID, EntityInput{Name: root.Name, TypeKey: root.TypeKey, ParentID: child.ID, Revision: root.Revision}); err == nil {
		t.Fatal("cycle accepted")
	}
	if _, err = s.SaveEntity(ctx, child.ID, EntityInput{Name: "Invalid", TypeKey: child.TypeKey, Revision: child.Revision, Metadata: map[string]any{"capacity": "bad"}}); err == nil {
		t.Fatal("invalid custom field accepted")
	}
	if _, err = s.SaveEntity(ctx, root.ID, EntityInput{Name: root.Name, TypeKey: root.TypeKey, Revision: root.Revision, Archived: true}); err == nil {
		t.Fatal("populated entity archived")
	}
	if _, err = s.SaveEntity(ctx, child.ID, EntityInput{Name: "Stale", TypeKey: child.TypeKey, Revision: 0, Metadata: map[string]any{"capacity": 12.0}}); err == nil {
		t.Fatal("stale revision accepted")
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM entity_legacy_refs WHERE resource_kind='devices' AND resource_id='demo-motor-device'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("backfill missing: %d %v", count, err)
	}
	id := "bridge-" + root.ID
	if _, err = pool.Exec(ctx, "INSERT INTO sites(id,name) VALUES($1,'Bridge site')", id); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM entity_legacy_refs WHERE resource_kind='sites' AND resource_id=$1", id).Scan(&count); err != nil || count != 1 {
		t.Fatal("legacy create did not create entity")
	}
	listed, err := s.ListEntities(ctx, root.ID, "", 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(listed), `"id": "`+child.ID+`"`) {
		t.Fatalf("entity list does not return entity objects: %s", listed)
	}
}

func TestEntityPhysicalOwnershipCreation(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	s := Registry{Pool: pool}
	site, err := s.SaveEntity(ctx, "", EntityInput{Name: "Native site", TypeKey: "site", PhysicalKind: "sites"})
	if err != nil {
		t.Fatal(err)
	}
	area, err := s.SaveEntity(ctx, "", EntityInput{Name: "Native area", TypeKey: "area", ParentID: site.ID, PhysicalKind: "areas"})
	if err != nil {
		t.Fatal(err)
	}
	asset, err := s.SaveEntity(ctx, "", EntityInput{Name: "Native machine", TypeKey: "asset", ParentID: area.ID, PhysicalKind: "assets"})
	if err != nil {
		t.Fatal(err)
	}
	var physicalArea string
	if err = pool.QueryRow(ctx, "SELECT area_id FROM assets WHERE id=$1", asset.LegacyID).Scan(&physicalArea); err != nil || physicalArea != area.LegacyID {
		t.Fatal("native hierarchy did not create valid physical ownership")
	}
	if _, err = pool.Exec(ctx, "UPDATE assets SET name='Renamed physical machine' WHERE id=$1", asset.LegacyID); err != nil {
		t.Fatal(err)
	}
	renamed, err := s.GetEntity(ctx, asset.ID)
	if err != nil || renamed.Name != "Renamed physical machine" {
		t.Fatal("reverse bridge lost native entity identity")
	}
}

func TestEntityLegacyConfigurationRemainsConsistent(t *testing.T) {
	pool := testutil.Database(t)
	actor := "entity-admin-" + auth.RandomID()
	if _, err := pool.Exec(context.Background(), "INSERT INTO users(id,username,password_hash,role_id) VALUES($1,$1,'unused','admin')", actor); err != nil {
		t.Fatal(err)
	}
	ctx := WithEntityActor(context.Background(), actor)
	s := Registry{Pool: pool}
	site, err := s.SaveEntity(ctx, "", EntityInput{Name: "Sync site", TypeKey: "site", PhysicalKind: "sites"})
	if err != nil {
		t.Fatal(err)
	}
	area, err := s.SaveEntity(ctx, "", EntityInput{Name: "Sync area", TypeKey: "area", ParentID: site.ID, PhysicalKind: "areas"})
	if err != nil {
		t.Fatal(err)
	}
	asset, err := s.SaveEntity(ctx, "", EntityInput{Name: "Sync asset", TypeKey: "asset", ParentID: area.ID, PhysicalKind: "assets"})
	if err != nil {
		t.Fatal(err)
	}
	group, err := s.SaveEntity(ctx, "", EntityInput{Name: "Logical group", TypeKey: "group", ParentID: area.ID})
	if err != nil {
		t.Fatal(err)
	}
	off := false
	asset, err = s.SaveEntity(ctx, asset.ID, EntityInput{Name: "Native rename", TypeKey: asset.TypeKey, ParentID: group.ID, Revision: asset.Revision, Enabled: &off, Metadata: map[string]any{"rated_power": 12.0}})
	if err != nil {
		t.Fatal(err)
	}
	var enabled bool
	var power float64
	if err = pool.QueryRow(ctx, "SELECT enabled,(metadata->>'rated_power')::float8 FROM assets WHERE id=$1", asset.LegacyID).Scan(&enabled, &power); err != nil || enabled || power != 12 {
		t.Fatalf("native fields diverged from physical config: %v %v %v", enabled, power, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE assets SET metadata='{"rated_power":19}',name='Legacy rename',enabled=true WHERE id=$1`, asset.LegacyID); err != nil {
		t.Fatal(err)
	}
	updated, err := s.GetEntity(ctx, asset.ID)
	if err != nil || updated.ParentID == nil || *updated.ParentID != group.ID || updated.Metadata["rated_power"] != float64(19) || !updated.Enabled {
		t.Fatalf("legacy edit lost logical context or metadata: %+v %v", updated, err)
	}
	connectionID := "nc-" + auth.RandomID()
	if _, err = pool.Exec(ctx, "INSERT INTO connections(id,site_id,name,protocol) VALUES($1,$2,'Native simulator','simulator')", connectionID, site.LegacyID); err != nil {
		t.Fatal(err)
	}
	device, err := s.SaveEntity(ctx, "", EntityInput{Name: "Native device", TypeKey: "device", ParentID: asset.ID, PhysicalKind: "devices", ConnectionID: connectionID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, "UPDATE devices SET status='CONNECTED' WHERE id=$1", device.LegacyID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveEntity(ctx, device.ID, EntityInput{Name: "Renamed device", TypeKey: "device", ParentID: asset.ID, Revision: device.Revision}); err != nil {
		t.Fatal(err)
	}
	var status string
	if err = pool.QueryRow(ctx, "SELECT status FROM devices WHERE id=$1", device.LegacyID).Scan(&status); err != nil || status != "CONNECTED" {
		t.Fatalf("metadata edit reset device connectivity: %s %v", status, err)
	}
	another, err := s.SaveEntity(ctx, "", EntityInput{Name: "Other area", TypeKey: "area", ParentID: site.ID, PhysicalKind: "areas"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Write(ctx, "assets", asset.LegacyID, map[string]any{"area_id": another.LegacyID}, actor); err == nil {
		t.Fatal("legacy ownership move bypassed hierarchy guard")
	}
	if _, err = pool.Exec(ctx, "UPDATE assets SET area_id=$2 WHERE id=$1", asset.LegacyID, another.LegacyID); err == nil {
		t.Fatal("direct physical move bypassed database guard")
	}
	if _, err = s.SaveEntity(ctx, group.ID, EntityInput{Name: group.Name, TypeKey: group.TypeKey, ParentID: another.ID, Revision: group.Revision}); err == nil {
		t.Fatal("moving a logical group changed descendant physical ownership")
	}
}
