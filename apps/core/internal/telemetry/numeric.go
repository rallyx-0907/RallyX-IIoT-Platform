package telemetry

import "math"

func numberMatchesType(kind string, value float64) bool {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return false
	}
	switch kind {
	case "int16":
		return value >= -32768 && value <= 32767 && math.Trunc(value) == value
	case "uint16":
		return value >= 0 && value <= 65535 && math.Trunc(value) == value
	case "int32":
		return value >= -2147483648 && value <= 2147483647 && math.Trunc(value) == value
	case "uint32":
		return value >= 0 && value <= 4294967295 && math.Trunc(value) == value
	case "float32":
		return value >= -math.MaxFloat32 && value <= math.MaxFloat32
	case "float64":
		return true
	}
	return false
}
