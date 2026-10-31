// Package units recognizes spelling aliases, never numeric conversions.
package units

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed aliases.json
var data []byte
var aliases = func() map[string]string {
	var out map[string]string
	if err := json.Unmarshal(data, &out); err != nil {
		panic(err)
	}
	return out
}()

func Canonical(value string) string {
	value = strings.TrimSpace(value)
	if unit, ok := aliases[strings.ToLower(value)]; ok {
		return unit
	}
	// Unknown SI symbols remain case-sensitive: mW and MW differ by 10^9.
	return value
}
