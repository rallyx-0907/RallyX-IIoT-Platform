package rules

import (
	"fmt"
	"time"
)

// EvaluateCondition evaluates one condition. Stale checks use the current wall clock;
// callers needing deterministic evaluation should use EvaluateRule with an explicit time.
func EvaluateCondition(condition Condition, state TagState, alarmActive bool) (ConditionResult, error) {
	return evaluateCondition(condition, state, alarmActive, time.Now())
}

func evaluateCondition(c Condition, s TagState, active bool, at time.Time) (ConditionResult, error) {
	r := ConditionResult{ConditionID: c.ID, TagID: c.TagID, Operator: c.Operator, Value: s.Value, Quality: s.Quality, Timestamp: s.Timestamp}
	unknown := func(reason string) ConditionResult { r.Reason = reason; return r }
	if c.Operator == OpStaleFor {
		d := duration(c)
		if d <= 0 || c.DurationMS > maxDurationMS {
			return r, fmt.Errorf("stale_for duration must be between 1 and 86400000 milliseconds")
		}
		anchor := s.LastGoodAt
		if anchor.IsZero() && (s.Quality == "GOOD" || s.Quality == "good") {
			anchor = s.Timestamp
		}
		if anchor.IsZero() {
			anchor = s.MonitoringSince
		}
		if anchor.IsZero() {
			r.Reason = "no accepted-good or monitoring-start timestamp"
			return r, nil
		}
		r.Known = true
		r.Matched = !at.Before(anchor.Add(d))
		if r.Matched {
			r.Reason = fmt.Sprintf("no fresh good-quality value for at least %s", d)
		} else {
			r.Reason = "a fresh good-quality value is within the stale duration"
		}
		return r, nil
	}
	if !s.Present {
		return unknown("tag value is missing"), nil
	}
	quality := s.Quality
	if quality == "" {
		quality = "unknown"
	}
	if quality != "GOOD" && quality != "good" {
		return unknown("tag quality is not good"), nil
	}
	r.Known = true
	switch c.Operator {
	case OpGT, OpGTE, OpLT, OpLTE:
		v, ok := number(s.Value)
		t, has := threshold(c)
		if !ok || !has || !finite(t) {
			r.Known = false
			return unknown("value or threshold is not a finite number"), nil
		}
		if active && c.Hysteresis > 0 {
			switch c.Operator {
			case OpGT:
				t -= c.Hysteresis
				r.Matched = v > t
			case OpGTE:
				t -= c.Hysteresis
				r.Matched = v >= t
			case OpLT:
				t += c.Hysteresis
				r.Matched = v < t
			case OpLTE:
				t += c.Hysteresis
				r.Matched = v <= t
			}
		} else {
			switch c.Operator {
			case OpGT:
				r.Matched = v > t
			case OpGTE:
				r.Matched = v >= t
			case OpLT:
				r.Matched = v < t
			case OpLTE:
				r.Matched = v <= t
			}
		}
		r.Reason = fmt.Sprintf("%v %s %v", s.Value, c.Operator, t)
	case OpEQ, OpNEQ:
		eq, compatible := scalarEqual(s.Value, c.Value)
		if !compatible {
			r.Known = false
			return unknown("current value and condition operand have incompatible scalar types"), nil
		}
		r.Matched = eq
		if c.Operator == OpNEQ {
			r.Matched = !eq
		}
		r.Reason = fmt.Sprintf("%v %s %v", s.Value, c.Operator, c.Value)
	case OpIsTrue, OpIsFalse:
		v, ok := s.Value.(bool)
		if !ok {
			r.Known = false
			return unknown("value is not boolean"), nil
		}
		r.Matched = (v == (c.Operator == OpIsTrue))
		r.Reason = fmt.Sprintf("%v %s", v, c.Operator)
	default:
		return r, fmt.Errorf("unsupported operator %q", c.Operator)
	}
	return r, nil
}

// EvaluateRule returns condition diagnostics and a snapshot of every referenced tag.
// Unknown values propagate through aggregation unless a known result is decisive.
func EvaluateRule(rule Rule, states map[TagID]TagState, at time.Time, alarmActive bool) (EvaluationResult, error) {
	logic := rule.Logic
	if logic == "" {
		logic = LogicAll
	}
	if logic != LogicAll && logic != LogicAny {
		return EvaluationResult{}, fmt.Errorf("unsupported rule logic %q", logic)
	}
	if len(rule.Conditions) == 0 {
		return EvaluationResult{}, fmt.Errorf("rule requires at least one condition")
	}
	out := EvaluationResult{Logic: logic, Known: true, Conditions: make([]ConditionResult, 0, len(rule.Conditions)), Snapshot: make(map[TagID]TagState, len(rule.Conditions))}
	matchedCount, knownCount := 0, 0
	for _, c := range rule.Conditions {
		s, ok := states[c.TagID]
		if !ok {
			s = TagState{Quality: "unknown"}
		}
		out.Snapshot[c.TagID] = s
		cr, err := evaluateCondition(c, s, alarmActive, at)
		if err != nil {
			return EvaluationResult{}, err
		}
		out.Conditions = append(out.Conditions, cr)
		if cr.Known {
			knownCount++
			if cr.Matched {
				matchedCount++
			}
		}
	}
	// Unusable input must never clear an active rule, even when another condition
	// makes an ALL/ANY clear aggregate appear decisive.
	if alarmActive && knownCount < len(rule.Conditions) {
		out.Known = false
		out.Matched = false
		return out, nil
	}
	if logic == LogicAll {
		if matchedCount < len(rule.Conditions) && knownCount > matchedCount {
			out.Known = true
			out.Matched = false
			return out, nil
		}
		if knownCount < len(rule.Conditions) {
			out.Known = false
			out.Matched = false
			return out, nil
		}
		out.Matched = matchedCount == len(rule.Conditions)
	} else {
		if matchedCount > 0 {
			out.Matched = true
			return out, nil
		}
		if knownCount < len(rule.Conditions) {
			out.Known = false
			out.Matched = false
			return out, nil
		}
		out.Matched = false
	}
	return out, nil
}

func Evaluate(input EvaluationInput) (EvaluationResult, error) {
	return EvaluateRule(input.Rule, input.States, input.At, input.AlarmActive)
}
