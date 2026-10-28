package mqtt

import "testing"

func TestLateAcknowledgementAfterDisconnectCannotCrashCore(t *testing.T) {
	ch := make(chan int)
	close(ch)
	if safeAck(func() { ch <- 1 }) {
		t.Fatal("disconnected delivery reported acknowledged")
	}
	called := false
	if !safeAck(func() { called = true }) || !called {
		t.Fatal("live acknowledgement was dropped")
	}
}
func TestAcknowledgementDoesNotHideOtherProgrammingErrors(t *testing.T) {
	defer func() {
		if recover() != "unexpected" {
			t.Fatal("unexpected panic was hidden")
		}
	}()
	safeAck(func() { panic("unexpected") })
}
