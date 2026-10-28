package rules

import (
	"fmt"
	"time"
)

// RuntimeState is the persisted debounce state for one rule.
type RuntimeState struct {
	State           RuleStateName `json:"state"`
	PendingSince    time.Time     `json:"pending_since,omitempty"`
	LastEvaluatedAt time.Time     `json:"last_evaluated_at,omitempty"`
}

type Action string

const (
	ActionNone     Action = "none"
	ActionActivate Action = "activate"
	ActionClear    Action = "clear"
)

// Transition is a proposed persisted state and alarm action. Callers persist
// State and apply Action together in their transaction.
type Transition struct {
	State  RuntimeState `json:"state"`
	Action Action       `json:"action"`
	Reason string       `json:"reason,omitempty"`
}

// Advance advances one rule's persisted debounce state using the supplied
// evaluation and clock. It has no side effects; callers persist the returned
// state and apply the requested alarm action atomically.
func Advance(rule Rule, previous RuntimeState, evaluation EvaluationResult, at time.Time) (Transition, error) {
	if rule.ActivationDelay < 0 || rule.ClearDelay < 0 || rule.ActivationDelayMS < 0 || rule.ClearDelayMS < 0 {
		return Transition{}, fmt.Errorf("rule delays must be nonnegative")
	}
	if !validRuleState(previous.State) {
		return Transition{}, fmt.Errorf("unsupported previous rule state %q", previous.State)
	}
	unchanged := Transition{State: previous, Action: ActionNone}
	if !previous.LastEvaluatedAt.IsZero() && at.Before(previous.LastEvaluatedAt) {
		return unchanged, nil
	}
	next := RuntimeState{State: previous.State, LastEvaluatedAt: at}
	transition := Transition{State: next, Action: ActionNone}
	if !rule.Enabled {
		transition.State.State = StateInactive
		if previous.State == StateActive || previous.State == StatePendingClear {
			transition.Action = ActionClear
			transition.Reason = "rule_disabled"
		}
		return transition, nil
	}
	if !evaluation.Known {
		if previous.State == StateActive || previous.State == StatePendingClear {
			transition.State.State = StateActive
		} else {
			transition.State.State = StateInactive
		}
		return transition, nil
	}
	if evaluation.Matched {
		switch previous.State {
		case StateInactive:
			return advancePending(transition, StatePendingActive, rule.ActivationDelay, rule.ActivationDelayMS, at, ActionActivate, StateActive)
		case StatePendingActive:
			return advancePending(transition, StatePendingActive, rule.ActivationDelay, rule.ActivationDelayMS, at, ActionActivate, StateActive, previous.PendingSince)
		case StateActive, StatePendingClear:
			transition.State.State = StateActive
			return transition, nil
		}
	}
	switch previous.State {
	case StateActive:
		return advancePending(transition, StatePendingClear, rule.ClearDelay, rule.ClearDelayMS, at, ActionClear, StateInactive)
	case StatePendingClear:
		return advancePending(transition, StatePendingClear, rule.ClearDelay, rule.ClearDelayMS, at, ActionClear, StateInactive, previous.PendingSince)
	case StateInactive, StatePendingActive:
		transition.State.State = StateInactive
		return transition, nil
	}
	return transition, nil
}

func advancePending(transition Transition, pendingState RuleStateName, delay time.Duration, delayMS int64, at time.Time, action Action, settledState RuleStateName, starts ...time.Time) (Transition, error) {
	if delay == 0 && delayMS > 0 {
		delay = time.Duration(delayMS) * time.Millisecond
	}
	since := at
	if len(starts) > 0 && !starts[0].IsZero() {
		since = starts[0]
	}
	if at.Before(since) {
		since = at
	}
	if delay <= 0 || !at.Before(since.Add(delay)) {
		transition.State.State = settledState
		transition.State.PendingSince = time.Time{}
		transition.Action = action
		if action == ActionActivate {
			transition.Reason = "condition_matched"
		} else {
			transition.Reason = "condition_cleared"
		}
		return transition, nil
	}
	transition.State.State = pendingState
	transition.State.PendingSince = since
	return transition, nil
}

func validRuleState(state RuleStateName) bool {
	switch state {
	case StateInactive, StatePendingActive, StateActive, StatePendingClear:
		return true
	default:
		return false
	}
}
