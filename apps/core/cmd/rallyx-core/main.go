package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"rallyx.local/core/internal/api"
	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/mqtt"
	"rallyx.local/core/internal/realtime"
	"rallyx.local/core/internal/telemetry"
	"rallyx.local/core/migrations"
)

func main() {
	probe := flag.Bool("healthcheck", false, "check the local Core health endpoint")
	flag.Parse()
	if *probe {
		client := &http.Client{Timeout: 4 * time.Second}
		addr := os.Getenv("HTTP_ADDR")
		if addr == "" {
			addr = ":8081"
		}
		_, port, err := net.SplitHostPort(addr)
		if err != nil {
			os.Exit(1)
		}
		resp, err := client.Get("http://127.0.0.1:" + port + "/health")
		if err != nil {
			os.Exit(1)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		slog.Error("startup failed", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	if os.Getenv("DATABASE_URL") == "" || os.Getenv("MQTT_URL") == "" {
		return errors.New("DATABASE_URL and MQTT_URL are required")
	}
	config, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		return errors.New("invalid DATABASE_URL")
	}
	config.MaxConns = 10
	config.ConnConfig.RuntimeParams["statement_timeout"] = "10000"
	reportingZone := os.Getenv("TZ")
	if reportingZone == "" {
		reportingZone = "UTC"
	}
	if _, err := time.LoadLocation(reportingZone); err != nil {
		return errors.New("invalid TZ")
	}
	config.ConnConfig.RuntimeParams["timezone"] = reportingZone
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return errors.New("cannot create database pool")
	}
	defer pool.Close()
	startup, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if err := pool.Ping(startup); err != nil {
		return errors.New("database unavailable at startup")
	}
	if err := migrations.Apply(startup, pool); err != nil {
		return err
	}
	if os.Getenv("DEMO_SEED") == "true" {
		if err := migrations.Seed(startup, pool); err != nil {
			return err
		}
	}
	if err := auth.Bootstrap(startup, pool, os.Getenv("ADMIN_USERNAME"), os.Getenv("ADMIN_PASSWORD")); err != nil {
		return err
	}
	hub := realtime.NewHub()
	engine := &telemetry.Engine{Pool: pool, Broadcast: hub.Broadcast}
	if err := engine.RecoverRules(ctx); err != nil {
		return fmt.Errorf("rule engine recovery: %w", err)
	}
	clientID := os.Getenv("MQTT_CLIENT_ID")
	if clientID == "" {
		clientID = "rallyx-core"
	}
	broker, err := mqtt.Connect(ctx, os.Getenv("MQTT_URL"), clientID, engine)
	if err != nil {
		return errors.New("MQTT unavailable at startup")
	}
	defer broker.Close()
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				operation, done := context.WithTimeout(ctx, 10*time.Second)
				if err := engine.Sweep(operation, now); err != nil && ctx.Err() == nil {
					slog.Warn("stale-data evaluation failed")
				}
				done()
			}
		}
	}()
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8081"
	}
	server := &http.Server{Addr: addr, Handler: api.NewServer(pool, broker.Healthy, hub), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("RallyX Core listening", "address", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
