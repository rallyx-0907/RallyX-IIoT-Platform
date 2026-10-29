-- Additive semantic model. Physical identities and telemetry are not rewritten.
CREATE TABLE entity_types (
 key text PRIMARY KEY CHECK(length(key) BETWEEN 1 AND 80), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 fields jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(fields)='array'), revision integer NOT NULL DEFAULT 1
);
INSERT INTO entity_types(key,name) VALUES ('site','Nhà máy / cơ sở'),('area','Khu vực'),('asset','Máy / tài sản'),('device','Thiết bị'),('group','Nhóm thực thể');
CREATE TABLE entity_profiles (
 id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160), revision integer NOT NULL DEFAULT 1,
 default_template_id text, default_template_version integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE entity_profile_versions (
 profile_id text NOT NULL REFERENCES entity_profiles(id), version integer NOT NULL CHECK(version>0),
 metrics jsonb NOT NULL CHECK(jsonb_typeof(metrics)='array'), PRIMARY KEY(profile_id,version)
);
CREATE TABLE entities (
 id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200), code text NOT NULL DEFAULT '',
 type_key text NOT NULL REFERENCES entity_types(key), parent_id text REFERENCES entities(id),
 metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
 enabled boolean NOT NULL DEFAULT true, archived boolean NOT NULL DEFAULT false,
 profile_id text, profile_version integer, revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(parent_id IS DISTINCT FROM id), CHECK((profile_id IS NULL)=(profile_version IS NULL)),
 FOREIGN KEY(profile_id,profile_version) REFERENCES entity_profile_versions(profile_id,version)
);
CREATE INDEX entities_parent_idx ON entities(parent_id,name,id);
CREATE INDEX entities_type_idx ON entities(type_key) WHERE NOT archived;
CREATE TABLE entity_legacy_refs (
 resource_kind text NOT NULL CHECK(resource_kind IN ('sites','areas','assets','devices')), resource_id text NOT NULL,
 entity_id text NOT NULL UNIQUE REFERENCES entities(id), PRIMARY KEY(resource_kind,resource_id)
);
CREATE TABLE entity_metric_bindings (
 entity_id text NOT NULL REFERENCES entities(id), metric_key text NOT NULL,
 tag_id text NOT NULL REFERENCES tags(id), PRIMARY KEY(entity_id,metric_key)
);
CREATE INDEX entity_bindings_tag_idx ON entity_metric_bindings(tag_id);
CREATE TABLE entity_dashboard_templates (
 id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 draft jsonb NOT NULL CHECK(jsonb_typeof(draft)='object'), revision integer NOT NULL DEFAULT 1,
 published_version integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE entity_dashboard_versions (
 template_id text NOT NULL REFERENCES entity_dashboard_templates(id), version integer NOT NULL CHECK(version>0),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(template_id,version)
);
CREATE TABLE entity_dashboard_assignments (
 entity_id text PRIMARY KEY REFERENCES entities(id), template_id text NOT NULL, template_version integer NOT NULL,
 revision integer NOT NULL DEFAULT 1, FOREIGN KEY(template_id,template_version) REFERENCES entity_dashboard_versions(template_id,version)
);
ALTER TABLE entity_profiles ADD FOREIGN KEY(default_template_id,default_template_version) REFERENCES entity_dashboard_versions(template_id,version);

CREATE FUNCTION rallyx_sync_legacy_entity() RETURNS trigger LANGUAGE plpgsql AS $$
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
 END IF;
 INSERT INTO entities(id,name,type_key,parent_id,metadata,enabled,archived)
 VALUES(eid,NEW.name,kind,parent_eid,COALESCE(payload->'metadata','{}'),COALESCE((payload->>'enabled')::boolean,true),payload->>'deleted_at' IS NOT NULL)
 ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,
 parent_id=CASE WHEN physical_parent_changed THEN EXCLUDED.parent_id ELSE entities.parent_id END,
 enabled=EXCLUDED.enabled,archived=EXCLUDED.archived,revision=entities.revision+1,updated_at=now();
 INSERT INTO entity_legacy_refs(resource_kind,resource_id,entity_id) VALUES(TG_TABLE_NAME,NEW.id,eid) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
-- Backfill in parent order through the same function used for future legacy writes.
CREATE TRIGGER site_entity_bridge AFTER INSERT OR UPDATE OF name ON sites FOR EACH ROW EXECUTE FUNCTION rallyx_sync_legacy_entity();
CREATE TRIGGER area_entity_bridge AFTER INSERT OR UPDATE OF name,site_id ON areas FOR EACH ROW EXECUTE FUNCTION rallyx_sync_legacy_entity();
CREATE TRIGGER asset_entity_bridge AFTER INSERT OR UPDATE OF name,area_id,enabled,deleted_at ON assets FOR EACH ROW EXECUTE FUNCTION rallyx_sync_legacy_entity();
CREATE TRIGGER device_entity_bridge AFTER INSERT OR UPDATE OF name,asset_id,enabled,deleted_at ON devices FOR EACH ROW EXECUTE FUNCTION rallyx_sync_legacy_entity();
UPDATE sites SET name=name;
UPDATE areas SET name=name;
UPDATE assets SET name=name;
UPDATE devices SET name=name;
