package auth

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"
)

func (m *Manager) allowAttempt(client, account string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for key, entry := range m.attempts {
		if now.After(entry.Until) {
			delete(m.attempts, key)
		}
	}
	account = strings.ToLower(account)
	peerKey := "peer:" + client + "\x00" + account
	accountKey := "account:" + account
	peer, global := m.attempts[peerKey], m.attempts[accountKey]
	if peer.Count >= 10 || global.Count >= 30 || len(m.attempts) >= 10000 {
		return false
	}
	if peer.Count == 0 {
		peer.Until = now.Add(5 * time.Minute)
	}
	if global.Count == 0 {
		global.Until = now.Add(5 * time.Minute)
	}
	peer.Count++
	global.Count++
	m.attempts[peerKey] = peer
	m.attempts[accountKey] = global
	return true
}

func (m *Manager) loginSucceeded(client, account string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	account = strings.ToLower(account)
	delete(m.attempts, "peer:"+client+"\x00"+account)
	delete(m.attempts, "account:"+account)
}

func (m *Manager) clientAddress(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	forwarded := net.ParseIP(r.Header.Get("X-Real-IP"))
	if m.ProxyHost == "" || forwarded == nil {
		return ip
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Second)
	defer cancel()
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, m.ProxyHost)
	if err != nil {
		return ip
	}
	peer := net.ParseIP(ip)
	for _, address := range addresses {
		if address.IP.Equal(peer) {
			return forwarded.String()
		}
	}
	return ip
}
