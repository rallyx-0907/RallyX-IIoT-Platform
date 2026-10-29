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
