package migrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMigrationsAndSeed(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("integration: set TEST_DATABASE_URL to a dedicated *_test database")
	}
	ctx := context.Background()
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(config.ConnConfig.Database, "_test") {
		t.Fatal("refusing a database without _test suffix")
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := Apply(ctx, pool); err != nil {
		t.Fatalf("second apply must be idempotent: %v", err)
	}
	if err := Seed(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := Seed(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var tags int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM tags WHERE id IN ('demo-motor-run','demo-motor-fault','demo-motor-current')").Scan(&tags); err != nil {
		t.Fatal(err)
	}
	if tags != 3 {
		t.Fatalf("demo motor tags=%d want 3", tags)
	}
	// An existing V1 installation gains the metadata column with an empty
	// object. Demo adoption must supply a simulator value without overwriting
	// an explicitly configured one on later restarts.
	var originalMetadata string
	if err := pool.QueryRow(ctx, "SELECT metadata::text FROM tags WHERE id='demo-motor-run'").Scan(&originalMetadata); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, "UPDATE tags SET metadata=$1::jsonb WHERE id='demo-motor-run'", originalMetadata)
	if _, err := pool.Exec(ctx, "UPDATE tags SET metadata='{}' WHERE id='demo-motor-run'"); err != nil {
		t.Fatal(err)
	}
	if err := Seed(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var defaulted bool
	if err := pool.QueryRow(ctx, "SELECT metadata ? 'simulator_value' FROM tags WHERE id='demo-motor-run'").Scan(&defaulted); err != nil || !defaulted {
		t.Fatalf("existing demo tag has no simulator default: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE tags SET metadata='{"simulator_value":true,"custom":"retained"}' WHERE id='demo-motor-run'`); err != nil {
		t.Fatal(err)
	}
	if err := Seed(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var retained bool
	if err := pool.QueryRow(ctx, `SELECT metadata->'simulator_value'='true'::jsonb AND metadata->>'custom'='retained' FROM tags WHERE id='demo-motor-run'`).Scan(&retained); err != nil || !retained {
		t.Fatalf("demo adoption overwrote configured metadata: %v", err)
	}
	_, err = pool.Exec(ctx, "INSERT INTO tags(id,asset_id,key,name,datatype) VALUES('orphan','does-not-exist','x','X','boolean')")
	if err == nil {
		t.Fatal("foreign key must reject orphan tags")
	}
	var hypertables int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name='telemetry_samples'").Scan(&hypertables); err != nil {
		t.Fatal(err)
	}
	if hypertables != 1 {
		t.Fatal("telemetry_samples is not a hypertable")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO telemetry_samples(tag_id,ts,value,quality) VALUES('demo-sensor-value','2026-01-01T00:00:00Z','25','good') ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	var samples int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM telemetry_samples WHERE tag_id='demo-sensor-value' AND ts>='2026-01-01T00:00:00Z' AND ts<'2026-01-02T00:00:00Z'`).Scan(&samples); err != nil || samples != 1 {
		t.Fatalf("time-range samples=%d err=%v", samples, err)
	}
}
