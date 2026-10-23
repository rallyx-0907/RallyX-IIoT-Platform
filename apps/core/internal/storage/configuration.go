package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"rallyx.local/core/internal/auth"
)

func normalizeConfiguration(resource, id string, body map[string]any) (map[string]any, error) {
	if resource == "tags" {
		if value, ok := body["address"].(float64); ok {
			body["address"] = strconv.FormatFloat(value, 'f', -1, 64)
		}
		dataType, hasTyped := body["data_type"].(string)
		if !hasTyped {
			if coarse, ok := body["datatype"].(string); ok {
				switch coarse {
				case "boolean":
					dataType = "bool"
				case "number":
					dataType = "float64"
				case "string":
					dataType = "string"
				default:
					return nil, fmt.Errorf("%w: invalid datatype", ErrValidation)
				}
				body["data_type"] = dataType
			}
		}
		if dataType != "" {
			switch dataType {
			case "bool":
				body["datatype"] = "boolean"
			case "int16", "uint16", "int32", "uint32", "float32", "float64":
				body["datatype"] = "number"
			case "string":
				body["datatype"] = "string"
			default:
				return nil, fmt.Errorf("%w: unsupported data_type", ErrValidation)
			}
		} else if id == "" {
			return nil, fmt.Errorf("%w: data_type is required", ErrValidation)
		}
		if history, ok := body["store_history"].(bool); ok {
			if !history {
				body["sample_policy"] = "none"
			} else if _, set := body["sample_policy"]; !set {
				body["sample_policy"] = "all"
			}
		}
		if policy, ok := body["sample_policy"].(string); ok {
			body["store_history"] = policy != "none"
		}
	}
	switch resource {
	case "connections", "devices", "device_templates", "tags", "rules":
		if id != "" {
			body["updated_at"] = time.Now().UTC()
		}
	}
	return body, nil
}

func prepareConfiguration(ctx context.Context, tx pgx.Tx, resource, id string, body map[string]any) error {
	switch resource {
	case "connections":
		protocol, _ := body["protocol"].(string)
		if id != "" {
			var oldProtocol string
			if err := tx.QueryRow(ctx, "SELECT protocol FROM connections WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", id).Scan(&oldProtocol); err != nil {
				return err
			}
			if protocol == "" {
				protocol = oldProtocol
			} else if protocol != oldProtocol {
				return fmt.Errorf("%w: create a new connection to change protocol", ErrValidation)
			}
		}
		config, provided := body["protocol_config"].(map[string]any)
		if !provided && id == "" {
			config = map[string]any{}
			body["protocol_config"] = config
			provided = true
		}
		if provided {
			if err := validateProtocolConfig(protocol, config); err != nil {
				return err
			}
		}
		if retry, ok := body["retry_policy"].(map[string]any); ok {
			for key, value := range retry {
				number, ok := value.(float64)
				if !ok || number != float64(int64(number)) {
					return fmt.Errorf("%w: invalid retry policy", ErrValidation)
				}
				switch key {
				case "max_attempts":
					if number < 0 || number > 10 {
						return ErrValidation
					}
				case "backoff_ms":
					if number < 100 || number > 60000 {
						return ErrValidation
					}
				case "max_backoff_ms":
					if number < 100 || number > 300000 {
						return ErrValidation
					}
				default:
					return fmt.Errorf("%w: unknown retry policy field", ErrValidation)
				}
			}
		}
	case "devices":
		assetID, _ := body["asset_id"].(string)
		connectionID, _ := body["connection_id"].(string)
		if id != "" {
			var existingAsset, existingConnection string
			if err := tx.QueryRow(ctx, "SELECT asset_id,connection_id FROM devices WHERE id=$1 AND deleted_at IS NULL", id).Scan(&existingAsset, &existingConnection); err != nil {
				return err
			}
			if assetID == "" {
				assetID = existingAsset
			}
			if connectionID == "" {
				connectionID = existingConnection
			}
		}
		var assetSite, areaID, connectionSite, protocol string
		if err := tx.QueryRow(ctx, "SELECT ar.site_id,a.area_id FROM assets a JOIN areas ar ON ar.id=a.area_id WHERE a.id=$1 AND a.deleted_at IS NULL", assetID).Scan(&assetSite, &areaID); err != nil {
			return fmt.Errorf("%w: asset does not exist", ErrValidation)
		}
		if err := tx.QueryRow(ctx, "SELECT site_id,protocol FROM connections WHERE id=$1 AND deleted_at IS NULL FOR SHARE", connectionID).Scan(&connectionSite, &protocol); err != nil {
			return fmt.Errorf("%w: connection does not exist", ErrValidation)
		}
		if assetSite != connectionSite {
			return fmt.Errorf("%w: connection and asset must belong to the same site", ErrValidation)
		}
		if id == "" {
			body["area_id"] = areaID
		}
		if address, ok := body["protocol_device_address"].(string); ok {
			if protocol == "modbus-tcp" || protocol == "modbus-rtu" {
				unit, err := strconv.Atoi(address)
				minimum, maximum := 0, 255
				if protocol == "modbus-rtu" {
					minimum, maximum = 1, 247
				}
				if err != nil || unit < minimum || unit > maximum {
					return fmt.Errorf("%w: invalid Modbus unit/slave address", ErrValidation)
				}
			} else if strings.ContainsAny(address, "+#\x00\r\n") {
				return fmt.Errorf("%w: invalid protocol device address", ErrValidation)
			}
		}
		if templateID, ok := body["template_id"].(string); ok {
			if id != "" {
				return fmt.Errorf("%w: template assignment is immutable; instances keep their cloned tags", ErrValidation)
			}
			var templateProtocol, manufacturer, model string
			var version int
			if err := tx.QueryRow(ctx, "SELECT protocol,version,manufacturer,model FROM device_templates WHERE id=$1 AND deleted_at IS NULL FOR SHARE", templateID).Scan(&templateProtocol, &version, &manufacturer, &model); err != nil {
				return fmt.Errorf("%w: template does not exist", ErrValidation)
			}
			if templateProtocol != protocol {
				return fmt.Errorf("%w: template and connection protocols differ", ErrValidation)
			}
			body["template_version"] = float64(version)
			if _, set := body["manufacturer"]; !set {
				body["manufacturer"] = manufacturer
			}
			if _, set := body["model"]; !set {
				body["model"] = model
			}
		}
	case "tags":
		return prepareTag(ctx, tx, id, body)
	case "device_templates":
		protocol, _ := body["protocol"].(string)
		if id != "" {
			var version int
			var oldProtocol string
			if err := tx.QueryRow(ctx, "SELECT version,protocol FROM device_templates WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", id).Scan(&version, &oldProtocol); err != nil {
				return err
			}
			body["version"] = float64(version + 1)
			if protocol == "" {
				protocol = oldProtocol
			} else if protocol != oldProtocol {
				return fmt.Errorf("%w: template protocol is immutable", ErrValidation)
			}
		}
		if definitions, ok := body["tag_definitions"].([]any); ok {
			seen := map[string]bool{}
			for index, raw := range definitions {
				definition, ok := raw.(map[string]any)
				if !ok {
					return fmt.Errorf("%w: template tag %d is not an object", ErrValidation, index+1)
				}
				tag, err := templateDefinition(definition, protocol)
				if err != nil {
					return fmt.Errorf("%w: template tag %d: %s", ErrValidation, index+1, err)
				}
				key := tag["key"].(string)
				if seen[key] {
					return fmt.Errorf("%w: duplicate template tag key %s", ErrValidation, key)
				}
				seen[key] = true
			}
		}
	}
	return nil
}

func prepareTag(ctx context.Context, tx pgx.Tx, id string, body map[string]any) error {
	deviceID, _ := body["device_id"].(string)
	if id != "" {
		if err := tx.QueryRow(ctx, "SELECT device_id FROM tags WHERE id=$1 AND deleted_at IS NULL", id).Scan(&deviceID); err != nil {
			return err
		}
	}
	var assetID, protocol string
	if err := tx.QueryRow(ctx, "SELECT d.asset_id,c.protocol FROM devices d JOIN connections c ON c.id=d.connection_id WHERE d.id=$1 AND d.deleted_at IS NULL AND c.deleted_at IS NULL", deviceID).Scan(&assetID, &protocol); err != nil {
		return fmt.Errorf("%w: device does not exist", ErrValidation)
	}
	if err := validateDecodingMetadata(body); err != nil {
		return err
	}
	if provided, ok := body["asset_id"].(string); ok && provided != assetID {
		return fmt.Errorf("%w: tag asset must match its device", ErrValidation)
	}
	if source, ok := body["source_type"].(string); ok && source != protocol {
		return fmt.Errorf("%w: tag source_type must match its connection", ErrValidation)
	}
	if id == "" {
		body["asset_id"] = assetID
		body["source_type"] = protocol
	}
	if address, ok := body["address"].(string); ok && (protocol == "modbus-tcp" || protocol == "modbus-rtu") {
		register, err := strconv.Atoi(address)
		if err != nil || register < 0 || register > 65535 {
			return fmt.Errorf("%w: Modbus address must be a zero-based register 0–65535", ErrValidation)
		}
	}
	if id == "" && (protocol == "modbus-tcp" || protocol == "modbus-rtu") {
		if _, ok := body["address"]; !ok {
			return fmt.Errorf("%w: Modbus address is required", ErrValidation)
		}
		if _, ok := body["function_code"]; !ok {
			body["function_code"] = float64(3)
		}
	}
	if semantic, ok := body["semantic"].(string); ok && semantic != "" {
		datatype, _ := body["datatype"].(string)
		if datatype == "" && id != "" {
			if err := tx.QueryRow(ctx, "SELECT datatype FROM tags WHERE id=$1", id).Scan(&datatype); err != nil {
				return err
			}
		}
		if datatype != "boolean" {
			return fmt.Errorf("%w: runtime/fault semantics require bool tags", ErrValidation)
		}
	}
	return nil
}

func validateProtocolConfig(protocol string, config map[string]any) error {
	allowed := map[string]bool{}
	for _, key := range []string{"unit_id"} {
		allowed[key] = true
	}
	switch protocol {
	case "simulator":
		for _, key := range []string{"enabled", "values"} {
			allowed[key] = true
		}
		if value, set := config["enabled"]; set {
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("%w: simulator enabled must be boolean", ErrValidation)
			}
		}
	case "modbus-tcp":
		for _, key := range []string{"host", "port"} {
			allowed[key] = true
		}
		host, ok := config["host"].(string)
		if !ok || host == "" || len(host) > 253 || strings.ContainsAny(host, "/\x00\r\n ") {
			return fmt.Errorf("%w: Modbus TCP host is required", ErrValidation)
		}
		if strings.Contains(host, ":") && net.ParseIP(host) == nil {
			return fmt.Errorf("%w: provide host and port separately", ErrValidation)
		}
		if _, ok := config["port"]; !ok {
			config["port"] = float64(502)
		}
		if !boundedInteger(config["port"], 1, 65535) {
			return fmt.Errorf("%w: invalid TCP port", ErrValidation)
		}
	case "modbus-rtu":
		for _, key := range []string{"serial_port", "baudrate", "data_bits", "parity", "stop_bits"} {
			allowed[key] = true
		}
		port, ok := config["serial_port"].(string)
		if !ok || !strings.HasPrefix(port, "/dev/") || strings.Contains(port, "..") || strings.ContainsAny(port, "\x00\r\n") {
			return fmt.Errorf("%w: serial_port must be a mapped /dev path", ErrValidation)
		}
		defaults := map[string]any{"baudrate": float64(9600), "data_bits": float64(8), "parity": "none", "stop_bits": float64(1)}
		for key, value := range defaults {
			if _, ok := config[key]; !ok {
				config[key] = value
			}
		}
		baud, ok := config["baudrate"].(float64)
		validBaud := false
		for _, candidate := range []float64{1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400} {
			validBaud = validBaud || baud == candidate
		}
		if !ok || !validBaud {
			return fmt.Errorf("%w: unsupported serial baudrate", ErrValidation)
		}
		if !boundedInteger(config["data_bits"], 7, 8) || !boundedInteger(config["stop_bits"], 1, 2) {
			return fmt.Errorf("%w: invalid serial framing", ErrValidation)
		}
		parity, _ := config["parity"].(string)
		if parity != "none" && parity != "even" && parity != "odd" {
			return fmt.Errorf("%w: invalid serial parity", ErrValidation)
		}
	case "mqtt":
		for _, key := range []string{"broker_url", "host", "port", "tls", "topic", "payload_mapping", "ca"} {
			allowed[key] = true
		}
		broker, _ := config["broker_url"].(string)
		if broker == "" {
			host, _ := config["host"].(string)
			if host == "" || strings.ContainsAny(host, "/\x00\r\n ") {
				return fmt.Errorf("%w: MQTT broker_url or host is required", ErrValidation)
			}
			tls, _ := config["tls"].(bool)
			scheme, port := "mqtt", 1883
			if tls {
				scheme, port = "mqtts", 8883
			}
			if value, ok := config["port"]; ok {
				if !boundedInteger(value, 1, 65535) {
					return ErrValidation
				}
				port = int(value.(float64))
			}
			broker = scheme + "://" + net.JoinHostPort(host, strconv.Itoa(port))
			config["broker_url"] = broker
		}
		parsed, err := url.Parse(broker)
		if err != nil || (parsed.Scheme != "mqtt" && parsed.Scheme != "mqtts") || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return fmt.Errorf("%w: invalid MQTT URL; provide credentials separately", ErrValidation)
		}
		topic, ok := config["topic"].(string)
		if !ok || topic == "" || len(topic) > 1024 || strings.ContainsAny(topic, "\x00\r\n") {
			return fmt.Errorf("%w: MQTT subscription topic is required", ErrValidation)
		}
	default:
		return fmt.Errorf("%w: unsupported protocol", ErrValidation)
	}
	for key := range config {
		if !allowed[key] {
			return fmt.Errorf("%w: unsupported protocol config field %s", ErrValidation, key)
		}
	}
	if unit, ok := config["unit_id"]; ok && !boundedInteger(unit, 0, 255) {
		return fmt.Errorf("%w: invalid unit_id", ErrValidation)
	}
	return nil
}

func boundedInteger(value any, minimum, maximum float64) bool {
	number, ok := value.(float64)
	return ok && number >= minimum && number <= maximum && number == float64(int64(number))
}

func validateDecodingMetadata(body map[string]any) error {
	metadata, _ := body["metadata"].(map[string]any)
	if bit, ok := metadata["bit_index"]; ok && !boundedInteger(bit, 0, 15) {
		return fmt.Errorf("%w: bit_index must be an integer 0–15", ErrValidation)
	}
	if count, ok := metadata["register_count"]; ok && !boundedInteger(count, 1, 125) {
		return fmt.Errorf("%w: register_count must be an integer 1–125", ErrValidation)
	}
	return nil
}

func templateDefinition(input map[string]any, protocol string) (map[string]any, error) {
	body := make(map[string]any, len(input))
	for key, value := range input {
		switch key {
		case "id", "asset_id", "device_id", "updated_at", "source_type":
			return nil, fmt.Errorf("template definitions cannot set %s", key)
		}
		body[key] = value
	}
	if _, ok := body["name"]; !ok {
		body["name"] = body["key"]
	}
	var err error
	body, err = normalizeConfiguration("tags", "", body)
	if err != nil {
		return nil, err
	}
	if err := validateDecodingMetadata(body); err != nil {
		return nil, err
	}
	for _, required := range []string{"key", "name", "data_type"} {
		if _, ok := body[required]; !ok {
			return nil, fmt.Errorf("missing %s", required)
		}
	}
	for key, value := range body {
		kind, ok := resources["tags"].Fields[key]
		if !ok || !valid(kind, value) {
			return nil, fmt.Errorf("invalid %s", key)
		}
	}
	if protocol == "modbus-tcp" || protocol == "modbus-rtu" {
		address, ok := body["address"].(string)
		register, err := strconv.Atoi(address)
		if !ok || err != nil || register < 0 || register > 65535 {
			return nil, fmt.Errorf("valid zero-based address required")
		}
		if _, ok := body["function_code"]; !ok {
			body["function_code"] = float64(3)
		}
	}
	if semantic, _ := body["semantic"].(string); semantic != "" && body["datatype"] != "boolean" {
		return nil, fmt.Errorf("runtime/fault semantics require bool")
	}
	return body, nil
}

func cloneDeviceTemplate(ctx context.Context, tx pgx.Tx, deviceID string, device map[string]any, overrides map[string]any, actor string) error {
	templateID, ok := device["template_id"].(string)
	if !ok {
		return nil
	}
	var raw json.RawMessage
	var protocol string
	if err := tx.QueryRow(ctx, "SELECT tag_definitions,protocol FROM device_templates WHERE id=$1", templateID).Scan(&raw, &protocol); err != nil {
		return err
	}
	var definitions []map[string]any
	if err := json.Unmarshal(raw, &definitions); err != nil {
		return err
	}
	known := map[string]bool{}
	for _, definition := range definitions {
		key, _ := definition["key"].(string)
		known[key] = true
		if override, ok := overrides[key]; ok {
			fields, ok := override.(map[string]any)
			if !ok {
				return ErrValidation
			}
			for name, value := range fields {
				if name == "key" {
					return fmt.Errorf("%w: template key cannot be overridden", ErrValidation)
				}
				definition[name] = value
			}
		}
		body, err := templateDefinition(definition, protocol)
		if err != nil {
			return fmt.Errorf("%w: %s", ErrValidation, err)
		}
		body["id"] = auth.RandomID()
		body["device_id"] = deviceID
		if err := prepareTag(ctx, tx, "", body); err != nil {
			return err
		}
		keys := make([]string, 0, len(body))
		slots := make([]string, 0, len(body))
		args := make([]any, 0, len(body))
		for name, value := range body {
			kind, ok := resources["tags"].Fields[name]
			if !ok || !valid(kind, value) {
				return ErrValidation
			}
			keys = append(keys, pgx.Identifier{name}.Sanitize())
			args = append(args, value)
			slots = append(slots, fmt.Sprintf("$%d", len(args)))
		}
		if _, err := tx.Exec(ctx, "INSERT INTO tags("+strings.Join(keys, ",")+") VALUES("+strings.Join(slots, ",")+")", args...); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO audit_log(user_id,action,resource) VALUES($1,'create:tags',$2)", actor, body["id"]); err != nil {
			return err
		}
	}
	for key := range overrides {
		if !known[key] {
			return fmt.Errorf("%w: unknown template override %s", ErrValidation, key)
		}
	}
	return nil
}
