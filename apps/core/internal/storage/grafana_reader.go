package storage

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"regexp"
)

const GrafanaReaderRole = "rallyx_grafana_reader"

// ConfigureGrafanaReader never grants access to business tables or connection credentials.
func ConfigureGrafanaReader(ctx context.Context, pool *pgxpool.Pool, role, password string) error {
	if !regexp.MustCompile(`^[a-z][a-z0-9_]{2,62}$`).MatchString(role) || len(password) < 32 || len(password) > 128 || role == pool.Config().ConnConfig.User {
		return errors.New("invalid Grafana reader configuration")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7261692)"); err != nil {
		return err
	}
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)", role).Scan(&exists); err != nil {
		return err
	}
	quoted := pgx.Identifier{role}.Sanitize()
	if !exists {
		if _, err = tx.Exec(ctx, "CREATE ROLE "+quoted+" LOGIN"); err != nil {
			return errors.New("cannot create Grafana reader")
		}
	}
	var literal string
	if err = tx.QueryRow(ctx, "SELECT quote_literal($1::text)", password).Scan(&literal); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "ALTER ROLE "+quoted+" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 3 PASSWORD "+literal); err != nil {
		return errors.New("cannot configure Grafana reader")
	}
	rows, err := tx.Query(ctx, "SELECT parent.rolname FROM pg_auth_members m JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid WHERE child.rolname=$1", role)
	if err != nil {
		return err
	}
	var memberships []string
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		memberships = append(memberships, name)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, group := range memberships {
		if _, err = tx.Exec(ctx, "REVOKE "+pgx.Identifier{group}.Sanitize()+" FROM "+quoted); err != nil {
			return err
		}
	}
	for _, sql := range []string{
		"ALTER ROLE " + quoted + " SET statement_timeout='5s'",
		"ALTER ROLE " + quoted + " SET lock_timeout='1s'",
		"ALTER ROLE " + quoted + " SET idle_in_transaction_session_timeout='5s'",
		"ALTER ROLE " + quoted + " SET default_transaction_read_only=on",
		"ALTER ROLE " + quoted + " SET work_mem='4MB'",
		"ALTER ROLE " + quoted + " SET temp_file_limit='32MB'",
		"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM " + quoted,
		"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM " + quoted,
		"REVOKE ALL ON SCHEMA public FROM " + quoted,
		"GRANT USAGE ON SCHEMA rallyx_reporting TO " + quoted,
		"GRANT SELECT ON ALL TABLES IN SCHEMA rallyx_reporting TO " + quoted,
	} {
		if _, err = tx.Exec(ctx, sql); err != nil {
			return errors.New("cannot grant restricted Grafana reporting access")
		}
	}
	return tx.Commit(ctx)
}
