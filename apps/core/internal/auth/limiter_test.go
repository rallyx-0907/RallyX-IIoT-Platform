package auth

import "testing"

func TestLoginThrottleSeparatesClientsAndAccounts(t *testing.T) {
	m := New(nil)
	for i := 0; i < 10; i++ {
		if !m.allowAttempt("client-a", "target") {
			t.Fatal("throttled before limit")
		}
	}
	if m.allowAttempt("client-a", "target") {
		t.Fatal("failed attempts were not limited")
	}
	if !m.allowAttempt("client-b", "target") {
		t.Fatal("one client denied another client")
	}
	m.loginSucceeded("client-a", "other-account")
	if m.allowAttempt("client-a", "target") {
		t.Fatal("another account reset target account throttling")
	}
	m.loginSucceeded("client-a", "target")
	if !m.allowAttempt("client-a", "target") {
		t.Fatal("successful target login did not reset its own peer limiter")
	}
}
