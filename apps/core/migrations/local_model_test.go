package migrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLocalDeviceModelConstraints(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("integration: TEST_DATABASE_URL not set")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil || !strings.HasSuffix(config.ConnConfig.Database, "_test") {
		t.Fatal("dedicated test database required")
	}
	ctx := context.Background()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := Seed(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var tables int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('connections','device_templates','dashboard_widgets')").Scan(&tables); err != nil || tables != 3 {
		t.Fatalf("local extensibility tables=%d err=%v", tables, err)
	}
	var traceable bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM tags t JOIN devices d ON d.id=t.device_id JOIN assets a ON a.id=d.asset_id JOIN areas ar ON ar.id=a.area_id JOIN connections c ON c.id=d.connection_id WHERE t.id='demo-motor-run' AND t.asset_id=a.id)").Scan(&traceable); err != nil || !traceable {
		t.Fatalf("device/asset/connection trace missing: %v", err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO devices(id,asset_id,connection_id,name) VALUES('device-key-scope-a','demo-motor','demo-simulator','Scope A'),('device-key-scope-b','demo-motor','demo-simulator','Scope B') ON CONFLICT DO NOTHING`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO tags(id,asset_id,device_id,key,name,datatype,data_type) VALUES('device-key-scope-a-value','demo-motor','device-key-scope-a','shared','Shared','number','float32'),('device-key-scope-b-value','demo-motor','device-key-scope-b','shared','Shared','number','float32') ON CONFLICT(id) DO NOTHING`)
	if err != nil {
		t.Fatalf("same key on distinct devices must be allowed: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO tags(id,asset_id,device_id,key,name,datatype,data_type) VALUES('device-key-scope-duplicate','demo-motor','device-key-scope-a','shared','Duplicate','number','float32')`); err == nil {
		t.Fatal("duplicate key on one device accepted")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO tags(id,asset_id,device_id,key,name,datatype,data_type) VALUES('device-asset-mismatch','demo-sensor','device-key-scope-a','wrong','Wrong','number','float32')`); err == nil {
		t.Fatal("tag can point at another asset than its device")
	}
}
