package mqtt

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
	"rallyx.local/core/internal/telemetry"
	"rallyx.local/core/internal/testutil"
)

func TestBrokerTelemetryPersistsBeforeAcknowledgement(t *testing.T) {
	address := os.Getenv("TEST_MQTT_URL")
	if address == "" {
		t.Skip("integration: TEST_MQTT_URL not set")
	}
	pool := testutil.Database(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	id := fmt.Sprintf("mqtt-%d", time.Now().UnixNano())
	if _, err := pool.Exec(ctx, "INSERT INTO assets(id,panel_id,name) VALUES($1,'demo-panel',$1)", id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO tags(id,asset_id,key,name,datatype,semantic) VALUES($1,$2,'run','Run','boolean','run')", id+"-run", id); err != nil {
		t.Fatal(err)
	}
	client, err := Connect(ctx, address, id, &telemetry.Engine{Pool: pool})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	publisher := paho.NewClient(paho.NewClientOptions().AddBroker(address).SetClientID(id + "-publisher"))
	token := publisher.Connect()
	if !token.WaitTimeout(5*time.Second) || token.Error() != nil {
		t.Fatal("publisher connect failed")
	}
	defer publisher.Disconnect(100)
	payload := fmt.Sprintf(`{"ts":%q,"tags":{"run":true},"quality":"good"}`, time.Now().UTC().Format(time.RFC3339Nano))
	for i := 0; i < 2; i++ {
		token = publisher.Publish("rallyx/demo-site/"+id+"/telemetry", 1, false, payload)
		if !token.WaitTimeout(5*time.Second) || token.Error() != nil {
			t.Fatal("publish failed")
		}
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		var starts int
		err := pool.QueryRow(ctx, "SELECT count(*) FROM events WHERE asset_id=$1 AND kind='start'", id).Scan(&starts)
		if err != nil {
			t.Fatal(err)
		}
		if starts == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("ingestion not observed: starts=%d", starts)
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !client.Healthy(ctx) {
		t.Fatal("MQTT health false after successful subscription")
	}
}
