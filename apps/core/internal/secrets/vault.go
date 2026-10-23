package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
)

type Credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}
type Vault struct{ aead cipher.AEAD }

func New(installationKey string) (*Vault, error) {
	if len(installationKey) < 32 {
		return nil, errors.New("installation encryption key must contain at least 32 bytes")
	}
	key := sha256.Sum256([]byte(installationKey))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Vault{aead: aead}, nil
}

func (v *Vault) Seal(connectionID string, credentials Credentials) ([]byte, []byte, error) {
	data, err := json.Marshal(credentials)
	if err != nil {
		return nil, nil, err
	}
	nonce := make([]byte, v.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	return nonce, v.aead.Seal(nil, nonce, data, []byte(connectionID)), nil
}

func (v *Vault) Open(connectionID string, nonce, ciphertext []byte) (Credentials, error) {
	var credentials Credentials
	if len(nonce) != v.aead.NonceSize() {
		return credentials, errors.New("invalid credential envelope")
	}
	data, err := v.aead.Open(nil, nonce, ciphertext, []byte(connectionID))
	if err != nil {
		return credentials, errors.New("cannot decrypt connection credentials")
	}
	if err := json.Unmarshal(data, &credentials); err != nil {
		return credentials, errors.New("invalid credential envelope")
	}
	return credentials, nil
}
