package rules

import (
	"fmt"
	"math"
	"reflect"
	"strings"
	"time"
)

const maxDurationMS int64 = 24 * 60 * 60 * 1000

type Logic string
type Operator string
type Severity string
type RuleStateName string
type TagID string

const (
	LogicAll           Logic         = "all"
	LogicAny           Logic         = "any"
	SeverityInfo       Severity      = "info"
	SeverityWarning    Severity      = "warning"
	SeverityCritical   Severity      = "critical"
	StateInactive      RuleStateName = "inactive"
	StatePendingActive RuleStateName = "pending_active"
	StateActive        RuleStateName = "active"
	StatePendingClear  RuleStateName = "pending_clear"
	OpGT               Operator      = "gt"
	OpGTE              Operator      = "gte"
	OpLT               Operator      = "lt"
	OpLTE              Operator      = "lte"
	OpEQ               Operator      = "eq"
	OpNEQ              Operator      = "neq"
	OpIsTrue           Operator      = "is_true"
	OpIsFalse          Operator      = "is_false"
	OpStaleFor         Operator      = "stale_for"
)

type Condition struct {
	ID         string        `json:"id,omitempty"`
	TagID      TagID         `json:"tag_id"`
	Operator   Operator      `json:"operator"`
	Value      any           `json:"value,omitempty"`
	Threshold  *float64      `json:"threshold,omitempty"`
	Duration   time.Duration `json:"-"`
	DurationMS int64         `json:"duration_ms,omitempty"`
	Hysteresis float64       `json:"hysteresis,omitempty"`
}

type Rule struct {
	ID                string        `json:"id,omitempty"`
	Name              string        `json:"name"`
	Enabled           bool          `json:"enabled"`
	Logic             Logic         `json:"logic"`
	Severity          Severity      `json:"severity"`
	ActivationDelay   time.Duration `json:"-"`
	ActivationDelayMS int64         `json:"activation_delay_ms,omitempty"`
	ClearDelay        time.Duration `json:"-"`
	ClearDelayMS      int64         `json:"clear_delay_ms,omitempty"`
	Conditions        []Condition   `json:"conditions"`
}

type TagState struct {
	Value           any       `json:"value,omitempty"`
	Present         bool      `json:"present"`
	Quality         string    `json:"quality"`
	Timestamp       time.Time `json:"timestamp,omitempty"`
	LastGoodAt      time.Time `json:"last_good_at,omitempty"`
	MonitoringSince time.Time `json:"monitoring_since,omitempty"`
}

type ConditionResult struct {
	ConditionID string    `json:"condition_id,omitempty"`
	TagID       TagID     `json:"tag_id"`
	Operator    Operator  `json:"operator"`
	Known       bool      `json:"known"`
	Matched     bool      `json:"matched"`
	Reason      string    `json:"reason"`
	Value       any       `json:"value,omitempty"`
	Quality     string    `json:"quality,omitempty"`
	Timestamp   time.Time `json:"timestamp,omitempty"`
}

type EvaluationResult struct {
	Known      bool               `json:"known"`
	Matched    bool               `json:"matched"`
	Logic      Logic              `json:"logic"`
	Conditions []ConditionResult  `json:"conditions"`
	Snapshot   map[TagID]TagState `json:"snapshot"`
}

// EvaluationInput is a transport-friendly alternative for callers that prefer a single input value.
type EvaluationInput struct {
	Rule        Rule
	States      map[TagID]TagState
	At          time.Time
	AlarmActive bool
}

func Validate(rule Rule, tagDatatypes map[TagID]string) error {
	if strings.TrimSpace(rule.Name) == "" {
		return fmt.Errorf("rule name is required")
	}
	logic := rule.Logic
	if logic == "" {
		logic = LogicAll
	}
	if logic != LogicAll && logic != LogicAny {
		return fmt.Errorf("unsupported rule logic %q", rule.Logic)
	}
	if rule.Severity != "" && rule.Severity != SeverityInfo && rule.Severity != SeverityWarning && rule.Severity != SeverityCritical {
		return fmt.Errorf("unsupported severity %q", rule.Severity)
	}
	if rule.ActivationDelay < 0 || rule.ClearDelay < 0 || rule.ActivationDelayMS < 0 || rule.ClearDelayMS < 0 {
		return fmt.Errorf("delays must be nonnegative")
	}
	if rule.ActivationDelayMS > maxDurationMS || rule.ClearDelayMS > maxDurationMS {
		return fmt.Errorf("delays must not exceed 86400000 milliseconds")
	}
	if rule.Enabled && len(rule.Conditions) == 0 {
		return fmt.Errorf("enabled rule requires at least one condition")
	}
	for i, c := range rule.Conditions {
		if c.TagID == "" {
			return fmt.Errorf("condition %d requires tag_id", i)
		}
		dtype, ok := tagDatatypes[c.TagID]
		if !ok {
			return fmt.Errorf("condition %d references unknown tag %q", i, c.TagID)
		}
		dtype = canonicalType(dtype)
		if c.Hysteresis < 0 || math.IsNaN(c.Hysteresis) || math.IsInf(c.Hysteresis, 0) {
			return fmt.Errorf("condition %d hysteresis must be finite and nonnegative", i)
		}
		switch c.Operator {
		case OpGT, OpGTE, OpLT, OpLTE:
			if dtype != "number" {
				return fmt.Errorf("condition %d numeric operator requires number tag", i)
			}
			v, has := threshold(c)
			if !has || !finite(v) {
				return fmt.Errorf("condition %d requires finite numeric threshold", i)
			}
		case OpEQ, OpNEQ:
			if c.Hysteresis != 0 {
				return fmt.Errorf("condition %d equality does not support hysteresis", i)
			}
			if !compatibleValue(dtype, c.Value) {
				return fmt.Errorf("condition %d equality value does not match tag datatype", i)
			}
		case OpIsTrue, OpIsFalse:
			if dtype != "boolean" {
				return fmt.Errorf("condition %d boolean operator requires boolean tag", i)
			}
			if c.Hysteresis != 0 {
				return fmt.Errorf("condition %d boolean operator does not support hysteresis", i)
			}
		case OpStaleFor:
			if c.Hysteresis != 0 {
				return fmt.Errorf("condition %d stale operator does not support hysteresis", i)
			}
			if duration(c) <= 0 {
				return fmt.Errorf("condition %d stale_for duration must be positive", i)
			}
			if c.DurationMS > maxDurationMS {
				return fmt.Errorf("condition %d stale_for duration must not exceed 86400000 milliseconds", i)
			}
		default:
			return fmt.Errorf("condition %d has unsupported operator %q", i, c.Operator)
		}
	}
	return nil
}

func canonicalType(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "number", "numeric", "int", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float", "float32", "float64", "double":
		return "number"
	case "bool", "boolean":
		return "boolean"
	case "string", "text":
		return "string"
	default:
		return s
	}
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func threshold(c Condition) (float64, bool) {
	if c.Threshold != nil {
		return *c.Threshold, true
	}
	return number(c.Value)
}
func duration(c Condition) time.Duration {
	if c.Duration != 0 {
		return c.Duration
	}
	return time.Duration(c.DurationMS) * time.Millisecond
}
func compatibleValue(t string, v any) bool {
	switch t {
	case "number":
		_, ok := number(v)
		return ok
	case "boolean":
		_, ok := v.(bool)
		return ok
	case "string":
		_, ok := v.(string)
		return ok
	default:
		return false
	}
}
func number(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, finite(x)
	case float32:
		return float64(x), finite(float64(x))
	case int:
		return exactInteger(int64(x))
	case int8:
		return exactInteger(int64(x))
	case int16:
		return exactInteger(int64(x))
	case int32:
		return exactInteger(int64(x))
	case int64:
		return exactInteger(x)
	case uint:
		return exactUnsigned(uint64(x))
	case uint8:
		return exactUnsigned(uint64(x))
	case uint16:
		return exactUnsigned(uint64(x))
	case uint32:
		return exactUnsigned(uint64(x))
	case uint64:
		return exactUnsigned(x)
	default:
		return 0, false
	}
}
func exactInteger(v int64) (float64, bool) {
	if v > 1<<53 || v < -(1<<53) {
		return 0, false
	}
	return float64(v), true
}
func exactUnsigned(v uint64) (float64, bool) {
	if v > 1<<53 {
		return 0, false
	}
	return float64(v), true
}
func scalarEqual(a, b any) (bool, bool) {
	if an, aok := number(a); aok {
		if bn, bok := number(b); bok {
			return an == bn, true
		}
		return false, false
	}
	if _, bok := number(b); bok {
		return false, false
	}
	if reflect.TypeOf(a) != reflect.TypeOf(b) {
		return false, false
	}
	switch a.(type) {
	case bool, string:
		return reflect.DeepEqual(a, b), true
	default:
		return false, false
	}
}
