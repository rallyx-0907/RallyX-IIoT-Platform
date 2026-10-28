package rules

import (
	"testing"
	"time"
)

func TestAdvanceDebouncesActivationAndPreservesPendingAcrossRestart(t *testing.T) {
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rule := Rule{Enabled: true, ActivationDelay: 5 * time.Second}
	first, err := Advance(rule, RuntimeState{State: StateInactive}, EvaluationResult{Known: true, Matched: true}, at)
	if err != nil {
		t.Fatal(err)
	}
	if first.State.State != StatePendingActive || !first.State.PendingSince.Equal(at) || first.Action != ActionNone {
		t.Fatalf("first transition = %#v", first)
	}
	second, err := Advance(rule, first.State, EvaluationResult{Known: true, Matched: true}, at.Add(4*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if second.State.State != StatePendingActive || second.Action != ActionNone {
		t.Fatalf("second transition = %#v", second)
	}
	third, err := Advance(rule, second.State, EvaluationResult{Known: true, Matched: true}, at.Add(5*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if third.State.State != StateActive || third.Action != ActionActivate {
		t.Fatalf("third transition = %#v", third)
	}
}

func TestAdvanceUnknownBreaksPendingAndDoesNotClearActive(t *testing.T) {
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rule := Rule{Enabled: true, ActivationDelay: time.Second, ClearDelay: time.Second}
	pending := RuntimeState{State: StatePendingActive, PendingSince: at}
	got, err := Advance(rule, pending, EvaluationResult{Known: false}, at.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if got.State.State != StateInactive || !got.State.PendingSince.IsZero() || got.Action != ActionNone {
		t.Fatalf("unknown activation = %#v", got)
	}
	active := RuntimeState{State: StateActive}
	got, err = Advance(rule, active, EvaluationResult{Known: false}, at.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if got.State.State != StateActive || got.Action != ActionNone {
		t.Fatalf("unknown clear = %#v", got)
	}
}

func TestAdvanceClearDelayAndDisabledRule(t *testing.T) {
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rule := Rule{Enabled: true, ClearDelay: 3 * time.Second}
	got, err := Advance(rule, RuntimeState{State: StateActive}, EvaluationResult{Known: true, Matched: false}, at)
	if err != nil {
		t.Fatal(err)
	}
	if got.State.State != StatePendingClear {
		t.Fatalf("pending clear = %#v", got)
	}
	got, err = Advance(rule, got.State, EvaluationResult{Known: true, Matched: false}, at.Add(3*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if got.State.State != StateInactive || got.Action != ActionClear {
		t.Fatalf("clear = %#v", got)
	}
	got, err = Advance(Rule{Enabled: false}, RuntimeState{State: StateActive}, EvaluationResult{}, at)
	if err != nil {
		t.Fatal(err)
	}
	if got.State.State != StateInactive || got.Action != ActionClear || got.Reason != "rule_disabled" {
		t.Fatalf("disabled = %#v", got)
	}
}

func TestAdvanceZeroDelayAndBackwardsClock(t *testing.T) {
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	got, err := Advance(Rule{Enabled: true}, RuntimeState{State: StateInactive}, EvaluationResult{Known: true, Matched: true}, at)
	if err != nil {
		t.Fatal(err)
	}
	if got.State.State != StateActive || got.Action != ActionActivate {
		t.Fatalf("immediate = %#v", got)
	}
	backwards, err := Advance(Rule{Enabled: true}, got.State, EvaluationResult{Known: true, Matched: false}, at.Add(-time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if backwards.State != got.State || backwards.Action != ActionNone {
		t.Fatalf("backwards = %#v", backwards)
	}
}
