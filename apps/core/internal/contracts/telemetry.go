package contracts

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

const TelemetrySubscription = "rallyx/v1/device/+/telemetry"
const MaxPayloadBytes = 262144

type Telemetry struct {
	DeviceID  string                     `json:"device_id"`
	AssetID   string                     `json:"asset_id"`
	Timestamp time.Time                  `json:"timestamp"`
	Tags      map[string]json.RawMessage `json:"values"`
	Quality   string                     `json:"quality"`
}

func DeviceTopic(deviceID, kind string) (string, error) {
	if !Identifier.MatchString(deviceID) || (kind != "telemetry" && kind != "event" && kind != "status") {
		return "", errors.New("invalid device topic")
	}
	return "rallyx/v1/device/" + deviceID + "/" + kind, nil
}

func DecodeTelemetry(topic string, payload []byte) (Telemetry, error) {
	var result Telemetry
	parts := strings.Split(topic, "/")
	if len(parts) != 5 || parts[0] != "rallyx" || parts[1] != "v1" || parts[2] != "device" || parts[4] != "telemetry" || !Identifier.MatchString(parts[3]) {
		return result, errors.New("invalid device telemetry topic")
	}
	if len(payload) > MaxPayloadBytes {
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
	if result.DeviceID != parts[3] || !Identifier.MatchString(result.AssetID) {
		return result, errors.New("payload device/asset identity does not match topic")
	}
	if result.Timestamp.IsZero() {
		return result, errors.New("timestamp required with timezone")
	}
	if len(result.Tags) == 0 || len(result.Tags) > 1024 {
		return result, errors.New("values must contain 1 to 1024 tags")
	}
	switch result.Quality {
	case "GOOD", "BAD", "UNCERTAIN", "STALE":
	default:
		return result, errors.New("invalid telemetry quality")
	}
	for key, raw := range result.Tags {
		if !Identifier.MatchString(key) {
			return result, errors.New("invalid tag key")
		}
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return result, errors.New("invalid tag value")
		}
		switch value.(type) {
		case bool, float64, string:
		default:
			return result, errors.New("tag values must be non-null scalars")
		}
	}
	result.Timestamp = result.Timestamp.UTC()
	return result, nil
}
