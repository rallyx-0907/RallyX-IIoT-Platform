CREATE TABLE dashboard_boards (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dashboard_widgets DROP CONSTRAINT dashboard_widgets_type_check;
ALTER TABLE dashboard_widgets ADD CONSTRAINT dashboard_widgets_type_check CHECK(type IN ('value','status','trend','gauge','level'));
ALTER TABLE dashboard_widgets DROP CONSTRAINT dashboard_widgets_user_id_tag_id_type_key;
ALTER TABLE dashboard_widgets ADD COLUMN board_id text REFERENCES dashboard_boards(id) ON DELETE CASCADE;
CREATE INDEX dashboard_widgets_board_idx ON dashboard_widgets(user_id,board_id,position,created_at);
