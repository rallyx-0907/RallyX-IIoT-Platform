package storage

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"rallyx.local/core/internal/auth"
	"rallyx.local/core/internal/testutil"
)

func TestCSVPreviewAndAtomicHundredTagImport(t *testing.T) {
	pool := testutil.Database(t)
	ctx := context.Background()
	id := auth.RandomID()
	if err := auth.Bootstrap(ctx, pool, id, "csv-import-test-password-123"); err != nil {
		t.Fatal(err)
	}
	var actor string
	if err := pool.QueryRow(ctx, "SELECT id FROM users WHERE username=$1", id).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO devices(id,connection_id,asset_id,name) VALUES($1,'demo-simulator','demo-motor',$1)", id); err != nil {
		t.Fatal(err)
	}
	registry := Registry{Pool: pool}
	header := "device,tag,address,data_type,unit,scale,store_history\n"
	var content strings.Builder
	content.WriteString(header)
	for i := 0; i < 120; i++ {
		fmt.Fprintf(&content, "%s,tag_%03d,%d,float32,A,0.1,true\n", id, i, i)
	}
	preview, err := registry.PreviewCSV(ctx, content.String())
	if err != nil || len(preview.Errors) != 0 || len(preview.Rows) != 120 {
		t.Fatalf("preview rows=%d errors=%v err=%v", len(preview.Rows), preview.Errors, err)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM tags WHERE device_id=$1", id).Scan(&count); err != nil || count != 0 {
		t.Fatal("preview persisted tags")
	}
	invalid := content.String() + fmt.Sprintf("%s,bad,1,imaginary,A,1,true\n", id)
	bad, err := registry.PreviewCSV(ctx, invalid)
	if err != nil || len(bad.Errors) == 0 || bad.Errors[0].Row != 122 || bad.Errors[0].Column != "data_type" {
		t.Fatalf("row/column errors missing: %+v %v", bad.Errors, err)
	}
	if _, err := registry.ImportCSV(ctx, invalid, actor); err == nil {
		t.Fatal("invalid import accepted")
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM tags WHERE device_id=$1", id).Scan(&count); err != nil || count != 0 {
		t.Fatal("invalid import partially committed")
	}
	imported, err := registry.ImportCSV(ctx, content.String(), actor)
	if err != nil || imported != 120 {
		t.Fatalf("imported=%d err=%v", imported, err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM tags WHERE device_id=$1", id).Scan(&count); err != nil || count != 120 {
		t.Fatal("valid import incomplete")
	}
	exported, err := registry.ExportTagsCSV(ctx, id)
	if err != nil || !strings.Contains(exported, "tag_119") {
		t.Fatalf("export incomplete: %v", err)
	}
	if _, err := registry.ImportCSV(ctx, content.String(), actor); err == nil {
		t.Fatal("duplicate import overwrote existing configuration")
	}
}
