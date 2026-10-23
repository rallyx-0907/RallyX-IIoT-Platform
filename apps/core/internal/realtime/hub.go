package realtime

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type Hub struct {
	mu           sync.Mutex
	clients      map[chan []byte]struct{}
	SessionValid func(*http.Request) bool
}

func NewHub() *Hub { return &Hub{clients: make(map[chan []byte]struct{})} }
func (h *Hub) Broadcast(value any) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for client := range h.clients {
		select {
		case client <- data:
		default:
			close(client)
			delete(h.clients, client)
		}
	}
}
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	connection, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer connection.CloseNow()
	ctx := connection.CloseRead(r.Context())
	queue := make(chan []byte, 32)
	h.mu.Lock()
	h.clients[queue] = struct{}{}
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.clients, queue); h.mu.Unlock() }()
	write := func(data []byte) error {
		deadline, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return connection.Write(deadline, websocket.MessageText, data)
	}
	if write([]byte(`{"type":"connected"}`)) != nil {
		return
	}
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case data, ok := <-queue:
			if !ok {
				_ = connection.Close(websocket.StatusTryAgainLater, "reconnect and refresh snapshot")
				return
			}
			if write(data) != nil {
				return
			}
		case <-ticker.C:
			if h.SessionValid != nil && !h.SessionValid(r) {
				_ = connection.Close(websocket.StatusPolicyViolation, "session expired")
				return
			}
			deadline, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := connection.Ping(deadline)
			cancel()
			if err != nil {
				return
			}
		}
	}
}
