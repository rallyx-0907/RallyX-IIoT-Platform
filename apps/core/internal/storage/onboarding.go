package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"

	"strconv"
	"strings"
)

type OnboardingLocation struct {
	SiteID    string `json:"site_id"`
	AreaID    string `json:"area_id"`
	AssetID   string `json:"asset_id"`
	SiteName  string `json:"site_name"`
	AreaName  string `json:"area_name"`
	AssetName string `json:"asset_name"`
}
type OnboardingInput struct {
	RequestID     string             `json:"request_id"`
	ConnectionID  string             `json:"connection_id"`
	Connection    map[string]any     `json:"connection"`
	TemplateID    string             `json:"template_id"`
	Signals       []map[string]any   `json:"signals"`
	TemplateName  string             `json:"template_name"`
	DeviceName    string             `json:"device_name"`
	DeviceAddress string             `json:"device_address"`
	Location      OnboardingLocation `json:"location"`
	Operation     string             `json:"operation"`
	ScanStart     int                `json:"scan_start"`
	ScanCount     int                `json:"scan_count"`
	ListenSeconds int                `json:"listen_seconds"`
}
type OnboardingResult struct {
	EntityID     string `json:"entity_id"`
	DeviceID     string `json:"device_id"`
	ConnectionID string `json:"connection_id"`
	Mapped       int    `json:"mapped"`
	Total        int    `json:"total"`
}

// Prepare a transient read-only diagnostic; no registry writes or audit drafts.
func (s Registry) PrepareOnboarding(ctx context.Context, in OnboardingInput) (map[string]any, error) {
	connection := map[string]any{}
	if in.ConnectionID != "" {
		if err := s.Pool.QueryRow(ctx, "SELECT to_jsonb(c) FROM connections c WHERE id=$1 AND deleted_at IS NULL", in.ConnectionID).Scan(&connection); err != nil {
			return nil, err
		}
		var nonce, ciphertext []byte
		err := s.Pool.QueryRow(ctx, "SELECT nonce,ciphertext FROM connection_credentials WHERE connection_id=$1", in.ConnectionID).Scan(&nonce, &ciphertext)
		if err == nil {
			if s.Vault == nil {
				return nil, ErrValidation
			}
			credentials, e := s.Vault.Open(in.ConnectionID, nonce, ciphertext)
			if e != nil {
				return nil, e
			}
			connection["credentials"] = credentials
		} else if err != pgx.ErrNoRows {
			return nil, err
		}
	} else {
		for key, value := range in.Connection {
			if key == "credentials" {
				credentials, ok := value.(map[string]any)
				if !ok || len(credentials) > 2 {
					return nil, ErrValidation
				}
				for k, v := range credentials {
					if (k != "username" && k != "password") || !valid("text", v) {
						return nil, ErrValidation
					}
				}
				connection[key] = value
				continue
			}
			kind, ok := resources["connections"].Fields[key]
			if !ok || key == "id" || key == "site_id" || key == "updated_at" || !valid(kind, value) {
				return nil, fmt.Errorf("%w: invalid connection %s", ErrValidation, key)
			}
			connection[key] = value
		}
		connection["id"] = "onboarding-preview"
		if connection["name"] == nil {
			connection["name"] = "Kết nối mới"
		}
		if connection["timeout_ms"] == nil {
			connection["timeout_ms"] = float64(2000)
		}
		if connection["polling_interval_ms"] == nil {
			connection["polling_interval_ms"] = float64(1000)
		}
		protocol, _ := connection["protocol"].(string)
		config, _ := connection["protocol_config"].(map[string]any)
		if config == nil {
			config = map[string]any{}
			connection["protocol_config"] = config
		}
		if err := validateProtocolConfig(protocol, config); err != nil {
			return nil, err
		}
	}
	protocol, _ := connection["protocol"].(string)
	if _, ok := connection["protocol_config"].(map[string]any); !ok {
		return nil, ErrValidation
	}
	address := in.DeviceAddress
	if address == "" {
		address = "1"
	}
	if strings.HasPrefix(protocol, "modbus-") {
		unit, err := strconv.Atoi(address)
		if err != nil || unit < 0 || unit > 255 {
			return nil, ErrValidation
		}
		if protocol == "modbus-rtu" && (unit < 1 || unit > 247) {
			return nil, ErrValidation
		}
	}
	definitions := in.Signals
	if in.TemplateID != "" {
		var p string
		if err := s.Pool.QueryRow(ctx, "SELECT protocol,tag_definitions FROM device_templates WHERE id=$1 AND deleted_at IS NULL", in.TemplateID).Scan(&p, &definitions); err != nil {
			return nil, err
		}
		if p != protocol {
			return nil, fmt.Errorf("%w: template protocol differs", ErrValidation)
		}
	}
	tags := []map[string]any{}
	if len(definitions) > 1000 {
		return nil, ErrValidation
	}
	for i, definition := range definitions {
		tag, err := templateDefinition(definition, protocol)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrValidation, err)
		}
		tag["id"] = fmt.Sprintf("preview-%d", i)
		tags = append(tags, tag)
	}
	if in.Operation == "scan" {
		if !strings.HasPrefix(protocol, "modbus-") || in.ScanStart < 0 || in.ScanCount < 1 || in.ScanCount > 50 || in.ScanStart+in.ScanCount > 65536 {
			return nil, ErrValidation
		}
	}
	if in.Operation == "listen" {
		if protocol != "mqtt" || in.ListenSeconds < 10 || in.ListenSeconds > 30 {
			return nil, ErrValidation
		}
	}
	if in.Operation != "connection" && in.Operation != "read" && in.Operation != "scan" && in.Operation != "listen" {
		return nil, ErrValidation
	}
	if in.Operation == "read" && (len(tags) == 0 || len(tags) > 64) {
		return nil, fmt.Errorf("%w: preview accepts 1–64 signals", ErrValidation)
	}
	return map[string]any{"connection": connection, "device": map[string]any{"id": "onboarding-preview", "protocol_device_address": address, "tags": tags}, "tags": tags, "operation": in.Operation, "scan_start": in.ScanStart, "scan_count": in.ScanCount, "listen_seconds": in.ListenSeconds}, nil
}

// Copy configuration only; identity, credentials and measured values are never copied.
func (s Registry) OnboardingDevice(ctx context.Context, id string) (map[string]any, error) {
	var out map[string]any
	err := s.Pool.QueryRow(ctx, "SELECT jsonb_build_object('name',d.name,'connection_id',d.connection_id,'template_id',CASE WHEN t.version=d.template_version THEN COALESCE(d.template_id,'') ELSE '' END,'asset_id',d.asset_id,'protocol_device_address',d.protocol_device_address) FROM devices d LEFT JOIN device_templates t ON t.id=d.template_id AND t.deleted_at IS NULL WHERE d.id=$1 AND d.deleted_at IS NULL", id).Scan(&out)
	if err != nil {
		return nil, err
	}
	var signals []map[string]any
	err = s.Pool.QueryRow(ctx, "SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key',key,'name',name,'data_type',data_type,'unit',unit,'address',address,'function_code',function_code,'byte_order',byte_order,'word_order',word_order,'scale',scale,'offset',\"offset\",'store_history',store_history,'mapping',mapping,'metadata',metadata)) ORDER BY key),'[]'::jsonb) FROM tags WHERE device_id=$1 AND deleted_at IS NULL", id).Scan(&signals)
	out["signals"] = signals
	return out, err
}

func (s Registry) CompleteOnboarding(ctx context.Context, in OnboardingInput, actor string) (OnboardingResult, error) {
	var out OnboardingResult
	if actor == "" || !valid("id", in.RequestID) || !valid("name", in.DeviceName) {
		return out, ErrValidation
	}
	encoded, _ := json.Marshal(in)
	sum := sha256.Sum256(encoded)
	fingerprint := hex.EncodeToString(sum[:])
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7261700)"); err != nil {
		return out, err
	}
	var previous string
	var owner string
	err = tx.QueryRow(ctx, "SELECT fingerprint,user_id,result FROM onboarding_requests WHERE request_id=$1", in.RequestID).Scan(&previous, &owner, &out)
	if err == nil {
		if owner != actor || previous != fingerprint {
			return OnboardingResult{}, ErrRevision
		}
		return out, nil
	}
	if err != pgx.ErrNoRows {
		return out, err
	}
	write := func(resource string, body map[string]any) (string, error) {
		raw, e := s.write(ctx, tx, resource, "", body, actor)
		if e != nil {
			return "", e
		}
		var result struct{ ID string }
		e = json.Unmarshal(raw, &result)
		return result.ID, e
	}
	loc := in.Location
	// Existing machine resolves its physical ancestors; no user-facing physical role selector.
	if loc.AssetID != "" {
		err = tx.QueryRow(ctx, "SELECT a.area_id,r.site_id FROM assets a JOIN areas r ON r.id=a.area_id WHERE a.id=$1 AND a.deleted_at IS NULL AND a.enabled", loc.AssetID).Scan(&loc.AreaID, &loc.SiteID)
		if err != nil {
			return out, err
		}
	}
	if loc.AreaID != "" && loc.AssetID == "" {
		if err = tx.QueryRow(ctx, "SELECT site_id FROM areas WHERE id=$1", loc.AreaID).Scan(&loc.SiteID); err != nil {
			return out, err
		}
	}
	if loc.SiteID == "" {
		if loc.SiteName == "" {
			return out, fmt.Errorf("%w: choose or name a factory", ErrValidation)
		}
		loc.SiteID, err = write("sites", map[string]any{"name": loc.SiteName})
		if err != nil {
			return out, err
		}
	}
	if loc.AreaID == "" {
		if loc.AreaName == "" {
			return out, ErrValidation
		}
		loc.AreaID, err = write("areas", map[string]any{"name": loc.AreaName, "site_id": loc.SiteID})
		if err != nil {
			return out, err
		}
	}
	if loc.AssetID == "" {
		if loc.AssetName == "" {
			return out, ErrValidation
		}
		loc.AssetID, err = write("assets", map[string]any{"name": loc.AssetName, "area_id": loc.AreaID, "type": "equipment"})
		if err != nil {
			return out, err
		}
	}
	out.ConnectionID = in.ConnectionID
	if out.ConnectionID == "" {
		body := map[string]any{}
		for k, v := range in.Connection {
			body[k] = v
		}
		body["site_id"] = loc.SiteID
		if body["name"] == nil || body["name"] == "" {
			body["name"] = in.DeviceName + " · Kết nối"
		}
		out.ConnectionID, err = write("connections", body)
		if err != nil {
			return out, err
		}
	}
	template := in.TemplateID
	if template == "" {
		if len(in.Signals) == 0 || len(in.Signals) > 1000 {
			return out, ErrValidation
		}
		var protocol string
		if err = tx.QueryRow(ctx, "SELECT protocol FROM connections WHERE id=$1 AND deleted_at IS NULL", out.ConnectionID).Scan(&protocol); err != nil {
			return out, err
		}
		definitions := make([]any, len(in.Signals))
		for i, d := range in.Signals {
			definitions[i] = d
		}
		name := in.TemplateName
		if name == "" {
			name = in.DeviceName + " · Mẫu thiết bị"
		}
		template, err = write("device_templates", map[string]any{"name": name, "protocol": protocol, "tag_definitions": definitions})
		if err != nil {
			return out, err
		}
	}
	address := in.DeviceAddress
	if address == "" {
		address = "1"
	}
	out.DeviceID, err = write("devices", map[string]any{"name": in.DeviceName, "asset_id": loc.AssetID, "connection_id": out.ConnectionID, "template_id": template, "protocol_device_address": address})
	if err != nil {
		return out, err
	}
	out.EntityID = "legacy:devices:" + out.DeviceID
	if err = tx.QueryRow(ctx, "SELECT count(*) FROM entity_metric_bindings WHERE entity_id=$1", out.EntityID).Scan(&out.Mapped); err != nil {
		return out, err
	}
	if err = tx.QueryRow(ctx, "SELECT jsonb_array_length(v.metrics) FROM entities e JOIN entity_profile_versions v ON v.profile_id=e.profile_id AND v.version=e.profile_version WHERE e.id=$1", out.EntityID).Scan(&out.Total); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO onboarding_requests(request_id,user_id,fingerprint,result) VALUES($1,$2,$3,$4)", in.RequestID, actor, fingerprint, out); err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}
