package rules

import (
	"math"
	"testing"
	"time"
)

func ptr(v float64) *float64 { return &v }
func TestNumericBoundariesAndHysteresis(t *testing.T) {
	tests := []struct {
		op              Operator
		v, threshold, h float64
		active, want    bool
	}{{OpGT, 71, 70, 0, false, true}, {OpGT, 70, 70, 0, false, false}, {OpGT, 69, 70, 2, true, true}, {OpGT, 68, 70, 2, true, false}, {OpGTE, 67.99, 70, 2, true, false}, {OpGTE, 68.01, 70, 2, true, true}, {OpLT, 2, 3, .5, true, true}, {OpLT, 3.5, 3, .5, true, false}, {OpLTE, 3.5, 3, .5, true, true}, {OpLTE, 3.51, 3, .5, true, false}}
	for _, tt := range tests {
		t.Run(string(tt.op)+"/"+string(rune(int(tt.v*100))), func(t *testing.T) {
			c := Condition{Operator: tt.op, Threshold: ptr(tt.threshold), Hysteresis: tt.h}
			r, e := EvaluateCondition(c, TagState{Present: true, Value: tt.v, Quality: "GOOD"}, tt.active)
			if e != nil || !r.Known || r.Matched != tt.want {
				t.Fatalf("got %#v err %v want %v", r, e, tt.want)
			}
		})
	}
}

func TestQualityAndMissingAreUnknown(t *testing.T) {
	c := Condition{Operator: OpGT, Threshold: ptr(0)}
	for _, s := range []TagState{{}, {Present: true, Value: 0, Quality: "BAD"}, {Present: true, Value: 100, Quality: "STALE"}, {Present: true, Value: true, Quality: "GOOD"}} {
		r, e := EvaluateCondition(c, s, false)
		if e != nil || r.Known {
			t.Fatalf("expected unknown for %#v: %#v %v", s, r, e)
		}
	}
}

func TestBooleanTypedEqualityAndStaleness(t *testing.T) {
	for _, tc := range []struct {
		op               Operator
		current, operand any
		known, want      bool
	}{{OpIsTrue, true, nil, true, true}, {OpIsFalse, false, nil, true, true}, {OpEQ, float64(2), float64(2), true, true}, {OpNEQ, "2", float64(2), false, false}, {OpEQ, float64(2), "2", false, false}} {
		c := Condition{Operator: tc.op, Value: tc.operand}
		r, e := EvaluateCondition(c, TagState{Present: true, Value: tc.current, Quality: "GOOD"}, false)
		if e != nil || r.Known != tc.known || r.Matched != tc.want {
			t.Fatalf("%s got %#v %v", tc.op, r, e)
		}
	}
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	c := Condition{Operator: OpStaleFor, Duration: time.Second}
	for _, tt := range []struct {
		stamp time.Time
		want  bool
	}{{now.Add(-time.Second), true}, {now.Add(-time.Second + time.Nanosecond), false}} {
		r, e := evaluateCondition(c, TagState{Present: true, Value: 999, Quality: "GOOD", Timestamp: tt.stamp}, false, now)
		if e != nil || !r.Known || r.Matched != tt.want {
			t.Fatalf("stale got %#v err %v", r, e)
		}
	}
	r, e := evaluateCondition(c, TagState{Present: true, Value: 999, Quality: "BAD", Timestamp: now, LastGoodAt: now.Add(-time.Second)}, false, now)
	if e != nil || !r.Known || !r.Matched {
		t.Fatalf("bad quality must be stale: %#v err %v", r, e)
	}
}

func TestStaleUsesLastGoodOrMonitoringAnchor(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	c := Condition{Operator: OpStaleFor, Duration: 30 * time.Second}
	cases := []struct {
		name         string
		state        TagState
		known, stale bool
	}{
		{"fresh bad for five seconds", TagState{Present: true, Value: 1, Quality: "BAD", Timestamp: now, LastGoodAt: now.Add(-5 * time.Second)}, true, false},
		{"good value forty seconds old despite fresh bad update", TagState{Present: true, Value: 1, Quality: "BAD", Timestamp: now, LastGoodAt: now.Add(-40 * time.Second)}, true, true},
		{"no timestamp anchor", TagState{Quality: "unknown"}, false, false},
		{"missing value monitored twenty nine seconds", TagState{Quality: "unknown", MonitoringSince: now.Add(-29 * time.Second)}, true, false},
		{"missing value monitored thirty seconds", TagState{Quality: "unknown", MonitoringSince: now.Add(-30 * time.Second)}, true, true},
		{"good timestamp is a fallback anchor", TagState{Present: true, Value: 1, Quality: "GOOD", Timestamp: now.Add(-30 * time.Second)}, true, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, e := evaluateCondition(c, tc.state, false, now)
			if e != nil || r.Known != tc.known || r.Matched != tc.stale {
				t.Fatalf("result %#v err %v", r, e)
			}
		})
	}
}

func TestNumericEqualityComparesCompatibleTypesAndRejectsIncompatible(t *testing.T) {
	cases := []struct {
		name             string
		op               Operator
		current, operand any
		known, matched   bool
	}{
		{"int and float equal", OpEQ, int(1), float64(1), true, true},
		{"int and float unequal", OpNEQ, int(1), float64(2), true, true},
		{"string and number neq is unknown", OpNEQ, "1", float64(1), false, false},
		{"unsafe integer is unknown", OpEQ, uint64(9007199254740993), float64(9007199254740992), false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, e := EvaluateCondition(Condition{Operator: tc.op, Value: tc.operand}, TagState{Present: true, Value: tc.current, Quality: "GOOD"}, false)
			if e != nil || r.Known != tc.known || r.Matched != tc.matched {
				t.Fatalf("result %#v err %v", r, e)
			}
		})
	}
}

func TestAggregateUnknownSemanticsAndCrossTagSnapshot(t *testing.T) {
	now := time.Now()
	rule := Rule{Logic: LogicAny, Conditions: []Condition{{TagID: "asset-a/device-1/temp", Operator: OpGT, Threshold: ptr(70)}, {TagID: "asset-b/device-2/run", Operator: OpIsTrue}}}
	states := map[TagID]TagState{"asset-a/device-1/temp": {Present: true, Value: 72., Quality: "GOOD", Timestamp: now}, "asset-b/device-2/run": {Present: true, Value: false, Quality: "BAD", Timestamp: now}}
	r, e := EvaluateRule(rule, states, now, false)
	if e != nil || !r.Known || !r.Matched || len(r.Conditions) != 2 || len(r.Snapshot) != 2 {
		t.Fatalf("any decisive result %#v %v", r, e)
	}
	rule.Logic = LogicAll
	r, e = EvaluateRule(rule, states, now, true)
	if e != nil || r.Known {
		t.Fatalf("active all with unknown must remain undecided: %#v %v", r, e)
	}
	states["asset-a/device-1/temp"] = TagState{Present: true, Value: 0., Quality: "GOOD"}
	r, e = EvaluateRule(rule, states, now, true)
	if e != nil || r.Known || r.Matched {
		t.Fatalf("all unknown should not clear: %#v %v", r, e)
	}
	rule.Logic = LogicAny
	states["asset-a/device-1/temp"] = TagState{Present: true, Value: 0., Quality: "GOOD"}
	r, e = EvaluateRule(rule, states, now, false)
	if e != nil || r.Known {
		t.Fatalf("any unknown should not activate: %#v %v", r, e)
	}
}

func TestValidation(t *testing.T) {
	base := Rule{Name: "ok", Enabled: true, Logic: LogicAll, Severity: SeverityWarning, Conditions: []Condition{{TagID: "n", Operator: OpGT, Threshold: ptr(1)}}}
	types := map[TagID]string{"n": "number", "b": "bool", "s": "string"}
	if e := Validate(base, types); e != nil {
		t.Fatal(e)
	}
	cases := []struct {
		name    string
		edit    func(*Rule)
		types   map[TagID]string
		wantErr bool
	}{{"numeric on bool", func(r *Rule) { r.Conditions[0].TagID = "b" }, types, true}, {"boolean on numeric", func(r *Rule) { r.Conditions[0] = Condition{TagID: "n", Operator: OpIsTrue} }, types, true}, {"negative hysteresis", func(r *Rule) { r.Conditions[0].Hysteresis = -1 }, types, true}, {"stale zero", func(r *Rule) { r.Conditions[0] = Condition{TagID: "n", Operator: OpStaleFor, DurationMS: 0} }, types, true}, {"empty enabled", func(r *Rule) { r.Conditions = nil }, types, true}, {"typed eq mismatch", func(r *Rule) { r.Conditions[0] = Condition{TagID: "n", Operator: OpEQ, Value: "1"} }, types, true}, {"nan threshold", func(r *Rule) { r.Conditions[0].Threshold = ptr(math.NaN()) }, types, true}, {"stale duration over one day", func(r *Rule) { r.Conditions[0] = Condition{TagID: "n", Operator: OpStaleFor, DurationMS: 86400001} }, types, true}, {"activation delay over one day", func(r *Rule) { r.ActivationDelayMS = 86400001 }, types, true}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := base
			r.Conditions = append([]Condition(nil), base.Conditions...)
			tc.edit(&r)
			if e := Validate(r, tc.types); (e != nil) != tc.wantErr {
				t.Fatalf("Validate err %v", e)
			}
		})
	}
}
