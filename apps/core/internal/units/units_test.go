package units

import "testing"

func TestCanonicalUnits(t *testing.T) {
	for _, pair := range [][2]string{{"kw", "kW"}, {" kW ", "kW"}, {"degC", "°C"}, {"m3/h", "m³/h"}, {"pct", "%"}, {"mW", "mW"}, {"MW", "MW"}, {"pA", "pA"}, {"Pa", "Pa"}} {
		if got := Canonical(pair[0]); got != pair[1] {
			t.Fatalf("%q => %q, want %q", pair[0], got, pair[1])
		}
	}
}
