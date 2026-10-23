package telemetry

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
)

var Identifier = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

type Message struct {
	SiteID    string                     `json:"-"`
	AssetID   string                     `json:"-"`
	Timestamp time.Time                  `json:"ts"`
	Tags      map[string]json.RawMessage `json:"tags"`
	Quality   string                     `json:"quality"`
}

func Parse(topic string, payload []byte) (Message, error) {
	var result Message
	parts := strings.Split(topic, "/")
	if len(parts) != 4 || parts[0] != "rallyx" || parts[3] != "telemetry" || !Identifier.MatchString(parts[1]) || !Identifier.MatchString(parts[2]) {
		return result, errors.New("invalid telemetry topic")
	}
	if len(payload) > 262144 {
		return result, errors.New("payload exceeds 256 KiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return result, fmt.Errorf("invalid telemetry JSON: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return result, errors.New("trailing JSON data")
	}
	if result.Timestamp.IsZero() {
		return result, errors.New("timestamp required with timezone")
	}
	if len(result.Tags) == 0 || len(result.Tags) > 1024 {
		return result, errors.New("tags must contain 1 to 1024 values")
	}
	switch result.Quality {
	case "good", "bad", "stale", "unknown":
	default:
		return result, errors.New("invalid quality")
	}
	for key, value := range result.Tags {
		if !Identifier.MatchString(key) {
			return result, errors.New("invalid tag key")
		}
		var scalar any
		if err := json.Unmarshal(value, &scalar); err != nil {
			return result, err
		}
		switch scalar.(type) {
		case bool, float64, string:
		default:
			return result, errors.New("tag values must be non-null scalars")
		}
	}
	result.SiteID, result.AssetID = parts[1], parts[2]
	result.Timestamp = result.Timestamp.UTC()
	return result, nil
}
