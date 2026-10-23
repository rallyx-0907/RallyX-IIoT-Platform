package telemetry

import "rallyx.local/core/internal/contracts"

var Identifier = contracts.Identifier

type Message = contracts.Telemetry

func Parse(topic string, payload []byte) (Message, error) {
	return contracts.DecodeTelemetry(topic, payload)
}
