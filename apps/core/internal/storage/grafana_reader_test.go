package storage

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
	"strings"
	"testing"
)

func TestGrafanaReaderIsBoundedAndCannotAccessBusinessWritesOrSecrets(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	role := "grafana_" + auth.RandomID()
	password := auth.RandomID()
	if err := ConfigureGrafanaReader(ctx, pool, role, password); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, "DROP OWNED BY "+role); pool.Exec(ctx, "DROP ROLE "+role) })
	config := pool.Config().Copy()
	config.ConnConfig.User = role
	config.ConnConfig.Password = password
	reader, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	var count int
	if err = reader.QueryRow(ctx, "SELECT count(*) FROM rallyx_reporting.tag_catalog").Scan(&count); err != nil || count == 0 {
		t.Fatalf("reporting metadata=%d err=%v", count, err)
	}
	for _, table := range []string{"current_values", "samples", "alarms", "events"} {
		if _, err = reader.Exec(ctx, "SELECT * FROM rallyx_reporting."+table+" LIMIT 1"); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
	}
	// A caller can override the default read-only setting, so prove SQL privileges still deny writes.
	if _, err = reader.Exec(ctx, "SET default_transaction_read_only=off"); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{"SELECT * FROM public.users", "SELECT * FROM public.sessions", "SELECT * FROM public.connection_credentials", "UPDATE public.tags SET name=name", "DELETE FROM public.telemetry_samples", "INSERT INTO public.events(asset_id,kind,ts) VALUES('demo-motor','probe',now())"} {
		_, err = reader.Exec(ctx, sql)
		var pg *pgconn.PgError
		if !errors.As(err, &pg) || pg.Code != "42501" {
			t.Fatalf("unsafe access was not denied: %s err=%v", sql, err)
		}
	}
	var timeout string
	if err = reader.QueryRow(ctx, "SHOW statement_timeout").Scan(&timeout); err != nil || timeout != "5s" {
		t.Fatalf("timeout=%s err=%v", timeout, err)
	}
	var super, bypass, create bool
	var limit int
	if err = reader.QueryRow(ctx, "SELECT rolsuper,rolbypassrls,rolcreaterole,rolconnlimit FROM pg_roles WHERE rolname=current_user").Scan(&super, &bypass, &create, &limit); err != nil || super || bypass || create || limit != 3 {
		t.Fatalf("unsafe role flags limit=%d err=%v", limit, err)
	}
	if err = ConfigureGrafanaReader(ctx, pool, role, strings.Repeat("a", 48)); err != nil {
		t.Fatalf("idempotent credential rotation: %v", err)
	}
}
