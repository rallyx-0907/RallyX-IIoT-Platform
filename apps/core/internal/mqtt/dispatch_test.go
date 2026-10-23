package mqtt

import (
	"context"
	"testing"
	"time"
)

func TestDispatcherPreservesPerAssetOrderAndAllowsOtherAssets(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	dispatch := newDispatcher(ctx, 32)
	started := make(chan struct{})
	release := make(chan struct{})
	results := make(chan int, 3)
	dispatch("asset-a", func() { close(started); <-release; results <- 1 })
	<-started
	dispatch("asset-a", func() { results <- 2 })
	dispatch("asset-b", func() { results <- 3 })
	select {
	case got := <-results:
		if got != 3 {
			t.Fatalf("same asset overtook blocked first delivery: %d", got)
		}
	case <-time.After(time.Second):
		t.Fatal("unrelated asset was blocked")
	}
	close(release)
	for _, want := range []int{1, 2} {
		select {
		case got := <-results:
			if got != want {
				t.Fatalf("delivery=%d want %d", got, want)
			}
		case <-time.After(time.Second):
			t.Fatal("delivery did not finish")
		}
	}
}
