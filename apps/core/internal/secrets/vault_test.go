package secrets

import (
	"bytes"
	"testing"
)

func TestCredentialsAreEncryptedAndBoundToConnection(t *testing.T) {
	vault, err := New("test-only-installation-secret-32-bytes-minimum")
	if err != nil {
		t.Fatal(err)
	}
	credentials := Credentials{Username: "test-publisher", Password: "test-only-mqtt-password"}
	nonce, ciphertext, err := vault.Seal("connection-a", credentials)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(ciphertext, []byte(credentials.Password)) || bytes.Contains(ciphertext, []byte(credentials.Username)) {
		t.Fatal("credential material stored in plaintext")
	}
	opened, err := vault.Open("connection-a", nonce, ciphertext)
	if err != nil || opened != credentials {
		t.Fatalf("round trip failed: %v", err)
	}
	if _, err := vault.Open("connection-b", nonce, ciphertext); err == nil {
		t.Fatal("credentials can be moved to another connection")
	}
	ciphertext[len(ciphertext)-1] ^= 1
	if _, err := vault.Open("connection-a", nonce, ciphertext); err == nil {
		t.Fatal("tampered ciphertext accepted")
	}
}

func TestVaultRequiresInstallationKey(t *testing.T) {
	if _, err := New("short"); err == nil {
		t.Fatal("short encryption key accepted")
	}
}
