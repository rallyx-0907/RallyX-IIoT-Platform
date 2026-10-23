package storage

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type CSVError struct {
	Row     int    `json:"row"`
	Column  string `json:"column"`
	Message string `json:"message"`
}
type CSVRow struct {
	Row int            `json:"row"`
	Tag map[string]any `json:"tag"`
}
type CSVPreview struct {
	Rows   []CSVRow   `json:"rows"`
	Errors []CSVError `json:"errors"`
	Total  int        `json:"total"`
}
type CSVValidationError struct{ Preview CSVPreview }

func (e *CSVValidationError) Error() string { return "CSV validation failed; no rows were imported" }

var csvColumns = map[string]string{
	"device": "device_id", "tag": "key", "name": "name", "address": "address", "data_type": "data_type", "unit": "unit", "scale": "scale", "offset": "offset", "deadband": "deadband", "function_code": "function_code", "byte_order": "byte_order", "word_order": "word_order", "poll_interval_ms": "poll_interval_ms", "store_history": "store_history", "realtime_enabled": "realtime_enabled", "enabled": "enabled", "semantic": "semantic", "stale_seconds": "stale_seconds",
}

func (s Registry) PreviewCSV(ctx context.Context, content string) (CSVPreview, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return CSVPreview{}, err
	}
	defer tx.Rollback(ctx)
	return previewCSV(ctx, tx, content)
}

func previewCSV(ctx context.Context, tx pgx.Tx, content string) (CSVPreview, error) {
	result := CSVPreview{Rows: []CSVRow{}, Errors: []CSVError{}}
	issue := func(row int, column, message string) {
		result.Errors = append(result.Errors, CSVError{Row: row, Column: column, Message: message})
	}
	if len(content) > 2097152 {
		issue(1, "csv", "CSV exceeds 2 MiB")
		return result, nil
	}
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(content, "\ufeff")))
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true
	header, err := reader.Read()
	if err != nil {
		issue(1, "csv", "CSV header is missing or malformed")
		return result, nil
	}
	seenHeaders := map[string]bool{}
	for index, name := range header {
		name = strings.TrimSpace(strings.ToLower(name))
		header[index] = name
		if _, ok := csvColumns[name]; !ok {
			issue(1, name, "Unknown column")
		}
		if seenHeaders[name] {
			issue(1, name, "Duplicate column")
		}
		seenHeaders[name] = true
	}
	for _, required := range []string{"device", "tag", "data_type"} {
		if !seenHeaders[required] {
			issue(1, required, "Required column is missing")
		}
	}
	if len(result.Errors) > 0 {
		return result, nil
	}
	seenKeys := map[string]int{}
	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			line := result.Total + 2
			var parseError *csv.ParseError
			if errors.As(err, &parseError) {
				line = parseError.Line
			}
			issue(line, "csv", "Malformed CSV record")
			break
		}
		line, _ := reader.FieldPos(0)
		result.Total++
		if result.Total > 10000 {
			issue(line, "csv", "Import is limited to 10000 rows")
			break
		}
		if len(record) != len(header) {
			issue(line, "csv", "Column count does not match header")
			continue
		}
		body := map[string]any{}
		before := len(result.Errors)
		for index, text := range record {
			column := header[index]
			field := csvColumns[column]
			text = strings.TrimSpace(text)
			if text == "" {
				continue
			}
			switch field {
			case "scale", "offset", "deadband", "function_code", "poll_interval_ms", "stale_seconds":
				number, err := strconv.ParseFloat(text, 64)
				if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
					issue(line, column, "A finite number is required")
				} else {
					body[field] = number
				}
			case "store_history", "realtime_enabled", "enabled":
				lower := strings.ToLower(text)
				if lower != "true" && lower != "false" {
					issue(line, column, "Expected true or false")
				} else {
					body[field] = lower == "true"
				}
			default:
				if strings.HasPrefix(text, "'") && len(text) > 1 && strings.ContainsAny(text[1:2], "=+-@") {
					text = text[1:]
				}
				body[field] = text
			}
		}
		if len(result.Errors) > before {
			continue
		}
		device, _ := body["device_id"].(string)
		key, _ := body["key"].(string)
		if device == "" {
			issue(line, "device", "Device is required")
			continue
		}
		if key == "" {
			issue(line, "tag", "Tag key is required")
			continue
		}
		rows, err := tx.Query(ctx, "SELECT id FROM devices WHERE deleted_at IS NULL AND (id=$1 OR name=$1) ORDER BY (id=$1) DESC,id LIMIT 2", device)
		if err != nil {
			return result, err
		}
		var identities []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return result, err
			}
			identities = append(identities, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return result, err
		}
		if len(identities) == 0 {
			issue(line, "device", "Device does not exist")
			continue
		}
		if len(identities) > 1 && identities[0] != device {
			issue(line, "device", "Device name is ambiguous; use its ID")
			continue
		}
		body["device_id"] = identities[0]
		if _, ok := body["name"]; !ok {
			body["name"] = key
		}
		body, err = normalizeConfiguration("tags", "", body)
		if err != nil {
			issue(line, "data_type", err.Error())
			continue
		}
		invalid := false
		for field, value := range body {
			kind, ok := resources["tags"].Fields[field]
			if !ok || !valid(kind, value) {
				column := field
				if field == "key" {
					column = "tag"
				}
				issue(line, column, "Invalid value")
				invalid = true
			}
		}
		if invalid {
			continue
		}
		if err := prepareTag(ctx, tx, "", body); err != nil {
			column := "tag"
			if strings.Contains(err.Error(), "address") {
				column = "address"
			}
			issue(line, column, err.Error())
			continue
		}
		identity := identities[0] + "\x00" + key
		if first, exists := seenKeys[identity]; exists {
			issue(line, "tag", fmt.Sprintf("Duplicate key for this device; first occurs at row %d", first))
			continue
		}
		seenKeys[identity] = line
		var exists bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM tags WHERE device_id=$1 AND key=$2 AND deleted_at IS NULL)", identities[0], key).Scan(&exists); err != nil {
			return result, err
		}
		if exists {
			issue(line, "tag", "Tag key already exists on this device")
			continue
		}
		result.Rows = append(result.Rows, CSVRow{Row: line, Tag: body})
	}
	if result.Total == 0 {
		issue(2, "csv", "CSV contains no tag rows")
	}
	return result, nil
}

func (s Registry) ImportCSV(ctx context.Context, content, actor string) (int, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	preview, err := previewCSV(ctx, tx, content)
	if err != nil {
		return 0, err
	}
	if len(preview.Errors) > 0 {
		return 0, &CSVValidationError{Preview: preview}
	}
	for _, row := range preview.Rows {
		if _, err := s.write(ctx, tx, "tags", "", row.Tag, actor); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(preview.Rows), nil
}

func csvText(value string) string {
	if value != "" && strings.ContainsAny(value[:1], "=+-@\t\r") {
		return "'" + value
	}
	return value
}

func (s Registry) ExportTagsCSV(ctx context.Context, deviceID string) (string, error) {
	rows, err := s.Pool.Query(ctx, `SELECT device_id,key,name,address,data_type,COALESCE(function_code::text,''),byte_order,word_order,unit,scale,"offset",deadband,COALESCE(poll_interval_ms::text,''),store_history,realtime_enabled,enabled,semantic,stale_seconds FROM tags WHERE deleted_at IS NULL AND ($1='' OR device_id=$1) ORDER BY device_id,key,id`, deviceID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	if err := writer.Write([]string{"device", "tag", "name", "address", "data_type", "function_code", "byte_order", "word_order", "unit", "scale", "offset", "deadband", "poll_interval_ms", "store_history", "realtime_enabled", "enabled", "semantic", "stale_seconds"}); err != nil {
		return "", err
	}
	for rows.Next() {
		var device, key, name, address, dataType, function, byteOrder, wordOrder, unit, interval, semantic string
		var scale, offset, deadband float64
		var history, realtime, enabled bool
		var stale int
		if err := rows.Scan(&device, &key, &name, &address, &dataType, &function, &byteOrder, &wordOrder, &unit, &scale, &offset, &deadband, &interval, &history, &realtime, &enabled, &semantic, &stale); err != nil {
			return "", err
		}
		if err := writer.Write([]string{csvText(device), csvText(key), csvText(name), csvText(address), dataType, function, byteOrder, wordOrder, csvText(unit), strconv.FormatFloat(scale, 'g', -1, 64), strconv.FormatFloat(offset, 'g', -1, 64), strconv.FormatFloat(deadband, 'g', -1, 64), interval, strconv.FormatBool(history), strconv.FormatBool(realtime), strconv.FormatBool(enabled), semantic, strconv.Itoa(stale)}); err != nil {
			return "", err
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	writer.Flush()
	return buffer.String(), writer.Error()
}
