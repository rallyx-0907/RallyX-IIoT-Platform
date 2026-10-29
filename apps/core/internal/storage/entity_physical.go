package storage

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
)

func (s Registry) createEntityPhysical(ctx context.Context, tx pgx.Tx, entityID, physicalID string, in EntityInput) error {
	if _, err := tx.Exec(ctx, "SELECT set_config('rallyx.entity_sync','off',true)"); err != nil {
		return err
	}
	anchor := func(kind string) (string, error) {
		var id string
		err := tx.QueryRow(ctx, `WITH RECURSIVE a AS (SELECT id,parent_id,0 AS depth FROM entities WHERE id=$1 UNION ALL SELECT e.id,e.parent_id,a.depth+1 FROM entities e JOIN a ON e.id=a.parent_id WHERE a.depth<64) SELECT r.resource_id FROM a JOIN entity_legacy_refs r ON r.entity_id=a.id WHERE r.resource_kind=$2 ORDER BY a.depth LIMIT 1`, in.ParentID, kind).Scan(&id)
		if err != nil {
			return "", fmt.Errorf("%w: choose a parent with physical %s ownership", ErrValidation, kind)
		}
		return id, nil
	}
	var err error
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	switch in.PhysicalKind {
	case "sites":
		_, err = tx.Exec(ctx, "INSERT INTO sites(id,name) VALUES($1,$2)", physicalID, in.Name)
	case "areas":
		owner, e := anchor("sites")
		if e != nil {
			return e
		}
		_, err = tx.Exec(ctx, "INSERT INTO areas(id,site_id,name) VALUES($1,$2,$3)", physicalID, owner, in.Name)
	case "assets":
		if !valid("object", in.Metadata) {
			return ErrValidation
		}
		owner, e := anchor("areas")
		if e != nil {
			return e
		}
		_, err = tx.Exec(ctx, "INSERT INTO assets(id,area_id,name,type,metadata,enabled) VALUES($1,$2,$3,$4,$5,$6)", physicalID, owner, in.Name, in.TypeKey, in.Metadata, enabled)
	case "devices":
		owner, e := anchor("assets")
		if e != nil {
			return e
		}
		actor, _ := ctx.Value(entityActorKey{}).(string)
		if actor == "" || in.ConnectionID == "" {
			return fmt.Errorf("%w: authenticated provisioning and connection required", ErrValidation)
		}
		address := in.ProtocolDeviceAddress
		if address == "" {
			address = "1"
		}
		body := map[string]any{"id": physicalID, "asset_id": owner, "name": in.Name, "connection_id": in.ConnectionID, "protocol_device_address": address, "metadata": in.Metadata, "enabled": enabled}
		if in.AdapterTemplateID != "" {
			body["template_id"] = in.AdapterTemplateID
		}
		_, err = s.write(ctx, tx, "devices", "", body, actor)
	default:
		return ErrValidation
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "INSERT INTO entity_legacy_refs(resource_kind,resource_id,entity_id) VALUES($1,$2,$3)", in.PhysicalKind, physicalID, entityID)
	return err
}
