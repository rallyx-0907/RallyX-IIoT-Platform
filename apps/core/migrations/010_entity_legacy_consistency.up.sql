-- Preserve semantic grouping and synchronize supported physical configuration fields.
CREATE OR REPLACE FUNCTION rallyx_sync_legacy_entity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payload jsonb:=to_jsonb(NEW); previous jsonb; eid text; parent_eid text; parent_kind text; parent_ref text;
 kind text; physical_parent_changed boolean:=false;
BEGIN
 IF current_setting('rallyx.entity_sync',true)='off' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(7261700);
 kind:=CASE TG_TABLE_NAME WHEN 'sites' THEN 'site' WHEN 'areas' THEN 'area' WHEN 'assets' THEN 'asset' ELSE 'device' END;
 eid:='legacy:'||TG_TABLE_NAME||':'||NEW.id;
 IF TG_TABLE_NAME='areas' THEN parent_kind:='sites';parent_ref:=payload->>'site_id';
 ELSIF TG_TABLE_NAME='assets' THEN parent_kind:='areas';parent_ref:=payload->>'area_id';
 ELSIF TG_TABLE_NAME='devices' THEN parent_kind:='assets';parent_ref:=payload->>'asset_id'; END IF;
 IF parent_kind IS NOT NULL THEN SELECT entity_id INTO parent_eid FROM entity_legacy_refs WHERE resource_kind=parent_kind AND resource_id=parent_ref; END IF;
 IF TG_OP='UPDATE' THEN
  previous:=to_jsonb(OLD);
  physical_parent_changed:=CASE TG_TABLE_NAME WHEN 'areas' THEN previous->>'site_id' IS DISTINCT FROM payload->>'site_id' WHEN 'assets' THEN previous->>'area_id' IS DISTINCT FROM payload->>'area_id' WHEN 'devices' THEN previous->>'asset_id' IS DISTINCT FROM payload->>'asset_id' ELSE false END;
  IF physical_parent_changed THEN RAISE EXCEPTION 'physical ownership is immutable; change logical grouping within the same owner' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO entities(id,name,type_key,parent_id,metadata,enabled,archived)
 VALUES(eid,NEW.name,kind,parent_eid,COALESCE(payload->'metadata','{}'),COALESCE((payload->>'enabled')::boolean,true),payload->>'deleted_at' IS NOT NULL)
 ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,
 metadata=CASE WHEN payload ? 'metadata' THEN EXCLUDED.metadata ELSE entities.metadata END,
 enabled=CASE WHEN payload ? 'enabled' THEN EXCLUDED.enabled ELSE entities.enabled END,
 archived=EXCLUDED.archived,revision=entities.revision+1,updated_at=now();
 INSERT INTO entity_legacy_refs(resource_kind,resource_id,entity_id) VALUES(TG_TABLE_NAME,NEW.id,eid) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER asset_entity_bridge ON assets;
DROP TRIGGER device_entity_bridge ON devices;
CREATE TRIGGER asset_entity_bridge AFTER INSERT OR UPDATE OF name,area_id,metadata,enabled,deleted_at ON assets FOR EACH ROW EXECUTE FUNCTION rallyx_sync_legacy_entity();
CREATE TRIGGER device_entity_bridge AFTER INSERT OR UPDATE OF name,asset_id,metadata,enabled,deleted_at ON devices FOR EACH ROW EXECUTE FUNCTION rallyx_sync_legacy_entity();
