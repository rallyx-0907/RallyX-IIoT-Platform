// Package testutil provides isolated integration test fixtures, never runtime cleanup.
package testutil

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"rallyx.local/core/migrations"
)

func Database(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("integration: TEST_DATABASE_URL not set")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(config.ConnConfig.Database, "_test") {
		t.Fatal("refusing non-test database")
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Seed(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	return pool
}

func Device(t *testing.T, pool *pgxpool.Pool, assetID string) string {
	t.Helper()
	id := assetID + "-device"
	if _, err := pool.Exec(context.Background(), "INSERT INTO devices(id,connection_id,asset_id,name) VALUES($1,'demo-simulator',$2,$1)", id, assetID); err != nil {
		t.Fatal(err)
	}
	return id
}
