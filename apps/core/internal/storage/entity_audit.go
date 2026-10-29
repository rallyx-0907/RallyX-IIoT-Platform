package storage

import (
	"context"
	"github.com/jackc/pgx/v5"
)

type entityActorKey struct{}

func WithEntityActor(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, entityActorKey{}, userID)
}
func commitEntity(ctx context.Context, tx pgx.Tx, action, id string) error {
	if actor, ok := ctx.Value(entityActorKey{}).(string); ok && actor != "" {
		if _, err := tx.Exec(ctx, "INSERT INTO audit_log(user_id,action,resource) VALUES($1,$2,$3)", actor, action, id); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
