package mqtt

import (
	"context"
	"hash/fnv"
)

// newDispatcher is called from Paho's ordered, short-lived callback. Each key
// always reaches the same FIFO worker; unrelated partitions progress independently.
func newDispatcher(ctx context.Context, partitions int) func(string, func()) {
	queues := make([]chan func(), partitions)
	for i := range queues {
		queue := make(chan func(), 64)
		queues[i] = queue
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case work := <-queue:
					if ctx.Err() == nil {
						work()
					}
				}
			}
		}()
	}
	return func(key string, work func()) {
		hash := fnv.New32a()
		_, _ = hash.Write([]byte(key))
		queue := queues[int(hash.Sum32()%uint32(partitions))]
		select {
		case queue <- work:
		case <-ctx.Done():
		}
	}
}
