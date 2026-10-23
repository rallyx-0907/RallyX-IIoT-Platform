package storage

import (
	"context"
	"encoding/json"
	"fmt"
)

func (s Registry) ConnectivityConfiguration(ctx context.Context) (json.RawMessage, error) {
	raw, err := s.List(ctx, `SELECT c.id,c.name,c.protocol,c.enabled,c.polling_interval_ms,c.timeout_ms,c.retry_policy,c.protocol_config,c.updated_at,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'asset_id',d.asset_id,'name',d.name,'protocol_device_address',d.protocol_device_address,'enabled',d.enabled AND a.enabled,'metadata',d.metadata,'updated_at',d.updated_at,'tags',COALESCE((
 SELECT jsonb_agg(jsonb_build_object('id',t.id,'key',t.key,'name',t.name,'data_type',t.data_type,'datatype',t.datatype,'address',t.address,'function_code',t.function_code,'byte_order',t.byte_order,'word_order',t.word_order,'scale',t.scale,'offset',t."offset",'poll_interval_ms',t.poll_interval_ms,'enabled',t.enabled,'metadata',t.metadata,'mapping',t.mapping,'updated_at',t.updated_at) ORDER BY t.id) FROM tags t WHERE t.device_id=d.id AND t.deleted_at IS NULL
 ),'[]'::jsonb)) ORDER BY d.id) FROM devices d JOIN assets a ON a.id=d.asset_id WHERE d.connection_id=c.id AND d.deleted_at IS NULL AND a.deleted_at IS NULL),'[]'::jsonb) AS devices
 FROM connections c WHERE c.deleted_at IS NULL ORDER BY c.id`)
	if err != nil {
		return nil, err
	}
	var connections []map[string]any
	if err := json.Unmarshal(raw, &connections); err != nil {
		return nil, err
	}
	index := map[string]map[string]any{}
	for _, connection := range connections {
		index[connection["id"].(string)] = connection
	}
	rows, err := s.Pool.Query(ctx, "SELECT connection_id,nonce,ciphertext FROM connection_credentials")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var nonce, ciphertext []byte
		if err := rows.Scan(&id, &nonce, &ciphertext); err != nil {
			return nil, err
		}
		connection, exists := index[id]
		if !exists {
			continue
		}
		if s.Vault == nil {
			connection["credential_error"] = true
			connection["enabled"] = false
			continue
		}
		credentials, err := s.Vault.Open(id, nonce, ciphertext)
		if err != nil {
			connection["credential_error"] = true
			connection["enabled"] = false
			continue
		}
		connection["credentials"] = credentials
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return json.Marshal(connections)
}

type TagReadError struct {
	TagID string `json:"tag_id"`
	Error string `json:"error"`
}
type ConnectivityStatus struct {
	DeviceID     string         `json:"device_id"`
	ConnectionID string         `json:"connection_id,omitempty"`
	Status       string         `json:"status"`
	Error        string         `json:"error"`
	Successful   bool           `json:"successful"`
	TagErrors    []TagReadError `json:"tag_errors"`
}

func (s Registry) UpdateConnectivityStatus(ctx context.Context, status ConnectivityStatus) error {
	if status.Status != "CONNECTED" && status.Status != "DISCONNECTED" && status.Status != "ERROR" && status.Status != "DISABLED" {
		return ErrValidation
	}
	if len(status.Error) > 1000 || len(status.TagErrors) > 1000 {
		return ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if status.DeviceID == "" {
		if status.ConnectionID == "" || len(status.TagErrors) > 0 {
			return ErrValidation
		}
		var id string
		if err := tx.QueryRow(ctx, "UPDATE connections SET status=CASE WHEN enabled AND deleted_at IS NULL THEN $2 ELSE 'DISABLED' END,last_error=$3,last_seen=now() WHERE id=$1 RETURNING id", status.ConnectionID, status.Status, status.Error).Scan(&id); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if err := lockConfigurationAssets(ctx, tx, "devices", status.DeviceID, nil); err != nil {
		return err
	}
	var connectionID string
	if err := tx.QueryRow(ctx, "SELECT connection_id FROM devices WHERE id=$1 AND deleted_at IS NULL", status.DeviceID).Scan(&connectionID); err != nil {
		return err
	}
	if status.ConnectionID != "" && status.ConnectionID != connectionID {
		return fmt.Errorf("%w: stale worker configuration", ErrValidation)
	}
	if _, err := tx.Exec(ctx, "SELECT id FROM connections WHERE id=$1 FOR UPDATE", connectionID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE devices d SET status=CASE WHEN d.enabled AND c.enabled AND a.enabled AND d.deleted_at IS NULL AND c.deleted_at IS NULL AND a.deleted_at IS NULL THEN $2 ELSE 'DISABLED' END,last_seen=now(),last_error=$3,last_successful_poll=CASE WHEN $4 AND $2='CONNECTED' AND d.enabled AND c.enabled AND a.enabled THEN now() ELSE d.last_successful_poll END FROM connections c,assets a WHERE d.id=$1 AND c.id=d.connection_id AND a.id=d.asset_id`, status.DeviceID, status.Status, status.Error, status.Successful)
	if err != nil {
		return err
	}
	for _, failure := range status.TagErrors {
		if len(failure.Error) > 1000 {
			return ErrValidation
		}
		var tag string
		if err := tx.QueryRow(ctx, "UPDATE tags SET quality='BAD',last_error=$3 WHERE id=$1 AND device_id=$2 AND deleted_at IS NULL RETURNING id", failure.TagID, status.DeviceID, failure.Error).Scan(&tag); err != nil {
			return fmt.Errorf("%w: read error references an unknown device tag", ErrValidation)
		}
		if _, err := tx.Exec(ctx, "UPDATE tag_current_state SET quality='BAD' WHERE tag_id=$1", tag); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE connections c SET last_seen=now(),last_error=$2,last_successful_poll=CASE WHEN $3 THEN now() ELSE c.last_successful_poll END,status=CASE WHEN NOT c.enabled OR c.deleted_at IS NOT NULL THEN 'DISABLED' WHEN EXISTS(SELECT 1 FROM devices d WHERE d.connection_id=c.id AND d.enabled AND d.deleted_at IS NULL AND d.status='ERROR') THEN 'ERROR' WHEN EXISTS(SELECT 1 FROM devices d WHERE d.connection_id=c.id AND d.enabled AND d.deleted_at IS NULL AND d.status='CONNECTED') THEN 'CONNECTED' ELSE 'DISCONNECTED' END WHERE c.id=$1`, connectionID, status.Error, status.Successful)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
