package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/secrets"
	"rallyx.local/core/internal/testutil"
)

func TestDynamicConfigurationTemplatesAndWriteOnlyCredentials(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	id := auth.RandomID()
	if err := auth.Bootstrap(ctx, pool, id, "dynamic-config-test-password-123"); err != nil {
		t.Fatal(err)
	}
	var actor string
	if err := pool.QueryRow(ctx, "SELECT id FROM users WHERE username=$1", id).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	vault, err := secrets.New("test-only-configuration-encryption-key-minimum-32")
	if err != nil {
		t.Fatal(err)
	}
	registry := Registry{Pool: pool, Vault: vault}
	if _, err := registry.Write(ctx, "connections", "", map[string]any{"site_id": "demo-site", "name": "Invalid", "protocol": "modbus-tcp", "protocol_config": map[string]any{}}, actor); !errors.Is(err, ErrValidation) {
		t.Fatalf("invalid protocol config accepted: %v", err)
	}
	connectionID := id + "-c"
	result, err := registry.Write(ctx, "connections", "", map[string]any{"id": connectionID, "site_id": "demo-site", "name": id, "protocol": "modbus-tcp", "protocol_config": map[string]any{"host": "127.0.0.1", "port": float64(502)}, "credentials": map[string]any{"username": "test-client", "password": "test-only-secret-password"}}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := registry.Write(ctx, "devices", "", map[string]any{"id": id + "-metadata-device", "asset_id": "demo-motor", "connection_id": connectionID, "name": "Metadata fixture"}, actor); err != nil {
		t.Fatal(err)
	}
	for _, metadata := range []map[string]any{{"bit_index": float64(16)}, {"bit_index": float64(-1)}, {"register_count": float64(1.5)}, {"register_count": float64(126)}} {
		if _, err := registry.Write(ctx, "tags", "", map[string]any{"device_id": id + "-metadata-device", "key": auth.RandomID(), "name": "Invalid metadata", "data_type": "bool", "address": "0", "metadata": metadata}, actor); !errors.Is(err, ErrValidation) {
			t.Fatalf("invalid decoding metadata accepted: %v", err)
		}
	}
	if bytes.Contains(result, []byte("test-only-secret-password")) || bytes.Contains(result, []byte("credentials")) {
		t.Fatal("browser connection response contains credentials")
	}
	var nonce, ciphertext []byte
	if err := pool.QueryRow(ctx, "SELECT nonce,ciphertext FROM connection_credentials WHERE connection_id=$1", connectionID).Scan(&nonce, &ciphertext); err != nil {
		t.Fatal(err)
	}
	credentials, err := vault.Open(connectionID, nonce, ciphertext)
	if err != nil || credentials.Password != "test-only-secret-password" {
		t.Fatalf("stored encrypted credentials unusable: %v", err)
	}
	definitions := []any{
		map[string]any{"key": "run", "name": "Run", "data_type": "bool", "semantic": "run", "address": "0", "function_code": float64(3)},
		map[string]any{"key": "current", "name": "Current", "data_type": "float32", "address": "1", "function_code": float64(3), "unit": "A", "scale": float64(0.1)},
	}
	templateID := id + "-tpl"
	if _, err := registry.Write(ctx, "device_templates", "", map[string]any{"id": templateID, "name": "Test drive template", "protocol": "modbus-tcp", "manufacturer": "Test manufacturer", "model": "Test model", "tag_definitions": definitions}, actor); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		deviceID := fmt.Sprintf("%s-d%d", id, i)
		if _, err := registry.Write(ctx, "devices", "", map[string]any{"id": deviceID, "asset_id": "demo-motor", "connection_id": connectionID, "template_id": templateID, "name": fmt.Sprintf("Configured drive %d %s", i, id), "protocol_device_address": fmt.Sprint(i + 1)}, actor); err != nil {
			t.Fatalf("instantiate device %d: %v", i, err)
		}
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM tags t JOIN devices d ON d.id=t.device_id WHERE d.template_id=$1", templateID).Scan(&count); err != nil || count != 20 {
		t.Fatalf("template instances tags=%d err=%v", count, err)
	}
	definitions = append(definitions, map[string]any{"key": "extra", "name": "Extra", "data_type": "uint16", "address": "4", "function_code": float64(3)})
	updated, err := registry.Write(ctx, "device_templates", templateID, map[string]any{"tag_definitions": definitions}, actor)
	if err != nil {
		t.Fatal(err)
	}
	var template struct {
		Version int `json:"version"`
	}
	if json.Unmarshal(updated, &template) != nil || template.Version != 2 {
		t.Fatalf("template version not incremented: %s", updated)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM tags t JOIN devices d ON d.id=t.device_id WHERE d.template_id=$1", templateID).Scan(&count); err != nil || count != 20 {
		t.Fatal("template update mutated existing tag instances")
	}
}
