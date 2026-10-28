package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"rallyx.local/core/internal/auth"
)

type DashboardBoard struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s Registry) ListDashboardBoards(ctx context.Context, userID string) (json.RawMessage, error) {
	return s.List(ctx, "SELECT id,name FROM dashboard_boards WHERE user_id=$1 ORDER BY created_at,id", userID)
}
func (s Registry) CreateDashboardBoard(ctx context.Context, userID, name string) (DashboardBoard, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return DashboardBoard{}, ErrValidation
	}
	id := auth.RandomID()
	var out DashboardBoard
	err := s.Pool.QueryRow(ctx, "INSERT INTO dashboard_boards(id,user_id,name) VALUES($1,$2,$3) RETURNING id,name", id, userID, name).Scan(&out.ID, &out.Name)
	if err != nil {
		return DashboardBoard{}, err
	}
	return out, nil
}
func (s Registry) RenameDashboardBoard(ctx context.Context, userID, id, name string) (DashboardBoard, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return DashboardBoard{}, ErrValidation
	}
	var out DashboardBoard
	err := s.Pool.QueryRow(ctx, "UPDATE dashboard_boards SET name=$3,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id,name", id, userID, name).Scan(&out.ID, &out.Name)
	if err != nil {
		return DashboardBoard{}, fmt.Errorf("dashboard board: %w", err)
	}
	return out, nil
}
