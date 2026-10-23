package mqtt

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync/atomic"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
	"rallyx.local/core/internal/contracts"
	"rallyx.local/core/internal/telemetry"
)

type Client struct {
	client     paho.Client
	subscribed atomic.Bool
	cancel     context.CancelFunc
}

func Connect(parent context.Context, address, clientID string, engine *telemetry.Engine) (*Client, error) {
	ctx, cancel := context.WithCancel(parent)
	result := &Client{cancel: cancel}
	subscribed := make(chan error, 1)
	dispatch := newDispatcher(ctx, 32)
	options := paho.NewClientOptions().AddBroker(address).SetClientID(clientID).
		SetCleanSession(false).SetResumeSubs(true).SetAutoReconnect(true).
		SetMaxReconnectInterval(5 * time.Second).SetConnectTimeout(5 * time.Second).
		SetKeepAlive(15 * time.Second).SetOrderMatters(true).SetAutoAckDisabled(true)
	options.SetConnectionLostHandler(func(_ paho.Client, err error) { result.subscribed.Store(false); slog.Warn("MQTT connection lost") })
	options.SetOnConnectHandler(func(client paho.Client) {
		token := client.Subscribe(contracts.TelemetrySubscription, 1, func(_ paho.Client, message paho.Message) {
			dispatch(message.Topic(), func() {
				parsed, parseErr := telemetry.Parse(message.Topic(), message.Payload())
				for {
					err := parseErr
					if err == nil {
						operation, done := context.WithTimeout(ctx, 10*time.Second)
						err = engine.Process(operation, parsed)
						done()
					}
					if err == nil {
						message.Ack()
						return
					}
					if ctx.Err() != nil {
						return
					}
					if parseErr != nil || errors.Is(err, telemetry.ErrRejected) {
						slog.Warn("telemetry rejected", "topic", message.Topic(), "reason", err.Error())
						operation, done := context.WithTimeout(ctx, 3*time.Second)
						_, diagnosticErr := engine.Pool.Exec(operation, "INSERT INTO ingestion_diagnostics(topic,reason) VALUES($1,$2)", message.Topic(), err.Error())
						done()
						if diagnosticErr == nil {
							message.Ack()
							return
						}
					}
					slog.Warn("ingestion pending; message remains unacknowledged")
					select {
					case <-ctx.Done():
						return
					case <-time.After(time.Second):
					}
				}
			})
		})
		var err error
		if !token.WaitTimeout(5 * time.Second) {
			err = errors.New("MQTT subscribe timeout")
		} else {
			err = token.Error()
		}
		result.subscribed.Store(err == nil)
		select {
		case subscribed <- err:
		default:
		}
	})
	result.client = paho.NewClient(options)
	token := result.client.Connect()
	if !token.WaitTimeout(10 * time.Second) {
		cancel()
		result.client.Disconnect(0)
		return nil, errors.New("MQTT connect timeout")
	}
	if err := token.Error(); err != nil {
		cancel()
		return nil, fmt.Errorf("MQTT connect: %w", err)
	}
	select {
	case err := <-subscribed:
		if err != nil {
			result.Close()
			return nil, err
		}
	case <-ctx.Done():
		result.Close()
		return nil, ctx.Err()
	case <-time.After(7 * time.Second):
		result.Close()
		return nil, errors.New("MQTT subscription not ready")
	}
	return result, nil
}

func (c *Client) Healthy(context.Context) bool {
	return c.client.IsConnectionOpen() && c.subscribed.Load()
}
func (c *Client) Close() { c.cancel(); c.client.Disconnect(250) }
