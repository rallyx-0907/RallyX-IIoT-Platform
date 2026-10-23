package telemetry

import "testing"

func TestTypedNumberBoundaries(t *testing.T) {
	for _, tc := range []struct {
		kind  string
		value float64
		want  bool
	}{
		{"int16", -32768, true}, {"int16", 32767, true}, {"int16", 32768, false}, {"int16", 1.5, false},
		{"uint16", 65535, true}, {"uint16", -1, false}, {"uint16", 65536, false},
		{"int32", 2147483647, true}, {"int32", 2147483648, false},
		{"uint32", 4294967295, true}, {"uint32", 4294967296, false},
		{"float32", 7.42, true}, {"float32", 1e40, false}, {"float64", 1e100, true},
	} {
		if got := numberMatchesType(tc.kind, tc.value); got != tc.want {
			t.Errorf("%s %v accepted=%v want %v", tc.kind, tc.value, got, tc.want)
		}
	}
}
