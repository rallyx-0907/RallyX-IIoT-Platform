package realtime

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestBroadcastReachesConnectedClient(t *testing.T) {
	hub := NewHub()
	server := httptest.NewServer(hub)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.CloseNow()
	if _, _, err = connection.Read(ctx); err != nil {
		t.Fatal(err)
	}
	hub.Broadcast(map[string]any{"type": "telemetry", "asset_id": "pump-a", "quality": "stale"})
	_, data, err := connection.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	if json.Unmarshal(data, &got) != nil || got["asset_id"] != "pump-a" || got["quality"] != "stale" {
		t.Fatalf("wrong event: %s", data)
	}
}
