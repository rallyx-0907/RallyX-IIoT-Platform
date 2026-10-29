package storage

import (
	"context"
	"encoding/json"
	"time"
)

type OperationalChild struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	TypeKey    string     `json:"type_key"`
	State      string     `json:"state"`
	LastSeen   *time.Time `json:"last_seen"`
	ChildCount int        `json:"child_count"`
}
type OperationalAlarm struct {
	ID             int64      `json:"id"`
	EntityID       string     `json:"entity_id"`
	AssetName      string     `json:"asset_name"`
	RuleName       string     `json:"rule_name"`
	Severity       string     `json:"severity"`
	ActivatedAt    time.Time  `json:"activated_at"`
	AcknowledgedAt *time.Time `json:"acknowledged_at"`
}
type OperationalOverview struct {
	State      string             `json:"state"`
	LastSeen   *time.Time         `json:"last_seen"`
	Children   []OperationalChild `json:"children"`
	States     map[string]int     `json:"states"`
	ChildTotal int                `json:"child_total"`
	Alarms     []OperationalAlarm `json:"alarms"`
}

func (s Registry) OperationalOverview(ctx context.Context, id string, limit, offset int) (OperationalOverview, error) {
	var out OperationalOverview
	out.Alarms = []OperationalAlarm{}
	if limit < 1 || limit > 200 || offset < 0 {
		return out, ErrValidation
	}
	query := entityScopeCTE + `, paths AS (
 SELECT r.resource_id AS device_id,t.id AS node_id,t.parent_id,t.effective FROM tree t JOIN entity_legacy_refs r ON r.entity_id=t.id AND r.resource_kind='devices'
 UNION ALL SELECT p.device_id,t.id,t.parent_id,p.effective FROM paths p JOIN tree t ON t.id=p.parent_id
 ), observations AS (
 SELECT p.node_id,t.semantic,c.value,c.ts,(upper(c.quality)='GOOD' AND c.ts>now()-t.stale_seconds*interval '1 second' AND c.ts<=now()+interval '1 minute') AS good
 FROM paths p JOIN devices d ON d.id=p.device_id JOIN assets a ON a.id=d.asset_id JOIN tags t ON t.device_id=d.id LEFT JOIN tag_current_state c ON c.tag_id=t.id
 WHERE p.effective AND d.enabled AND a.enabled AND t.enabled AND t.realtime_enabled AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND a.deleted_at IS NULL
 ), stats AS (
 SELECT node_id,bool_or(semantic='fault' AND good AND value='true'::jsonb) AS fault,bool_or(semantic='run' AND good AND value='true'::jsonb) AS running,
 bool_or(semantic='run' AND good AND value='false'::jsonb) AS stopped,bool_or(semantic IN ('run','fault') AND NOT COALESCE(good,false)) AS unknown,bool_or(good) AS online,max(ts) AS last_seen FROM observations GROUP BY node_id
 ), rows AS (
 SELECT t.id,t.name,t.type_key,t.parent_id,s.last_seen,(SELECT count(*) FROM entities c WHERE c.parent_id=t.id AND NOT c.archived) AS child_count,
 CASE WHEN NOT t.effective THEN 'DISABLED' WHEN s.fault THEN 'FAULT' WHEN s.unknown THEN 'UNKNOWN' WHEN s.running THEN 'RUNNING' WHEN s.stopped THEN 'STOPPED' WHEN s.online THEN 'ONLINE' ELSE 'UNKNOWN' END AS state FROM tree t LEFT JOIN stats s ON s.node_id=t.id
 ) SELECT jsonb_build_object('state',(SELECT state FROM rows WHERE id=$1),'last_seen',(SELECT last_seen FROM rows WHERE id=$1),
 'children',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT id,name,type_key,state,last_seen,child_count FROM rows WHERE parent_id=$1 ORDER BY name,id LIMIT $2 OFFSET $3)c),'[]'::jsonb),
 'child_total',(SELECT count(*) FROM rows WHERE parent_id=$1),
 'states',COALESCE((SELECT jsonb_object_agg(state,n) FROM (SELECT state,count(*) AS n FROM rows WHERE parent_id=$1 GROUP BY state)x),'{}'::jsonb))`
	var raw []byte
	if err := s.Pool.QueryRow(ctx, query, id, limit, offset).Scan(&raw); err != nil {
		return out, err
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	alarms, err := s.List(ctx, entityScopeCTE+` SELECT a.id,a.severity,a.activated_at,a.acknowledged_at,r.name AS rule_name,asset.name AS asset_name,COALESCE(ref.entity_id,'') AS entity_id FROM alarms a JOIN rules r ON r.id=a.rule_id JOIN assets asset ON asset.id=a.asset_id LEFT JOIN entity_legacy_refs ref ON ref.resource_kind='assets' AND ref.resource_id=a.asset_id WHERE a.cleared_at IS NULL AND (EXISTS(SELECT 1 FROM tree t JOIN entity_legacy_refs x ON x.entity_id=t.id WHERE x.resource_kind='assets' AND x.resource_id=a.asset_id) OR EXISTS(SELECT 1 FROM tree t JOIN entity_legacy_refs x ON x.entity_id=t.id AND x.resource_kind='devices' JOIN tags tag ON tag.device_id=x.resource_id WHERE tag.id=r.tag_id OR EXISTS(SELECT 1 FROM rule_conditions c WHERE c.rule_id=r.id AND c.tag_id=tag.id))) ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1 ELSE 2 END,a.activated_at DESC LIMIT 100`, id)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(alarms, &out.Alarms)
	return out, err
}
