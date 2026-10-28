DROP INDEX IF EXISTS dashboard_widgets_board_idx;
ALTER TABLE dashboard_widgets DROP COLUMN IF EXISTS board_id;
ALTER TABLE dashboard_widgets ADD CONSTRAINT dashboard_widgets_user_id_tag_id_type_key UNIQUE(user_id,tag_id,type);
ALTER TABLE dashboard_widgets DROP CONSTRAINT dashboard_widgets_type_check;
ALTER TABLE dashboard_widgets ADD CONSTRAINT dashboard_widgets_type_check CHECK(type IN ('value','status','trend'));
DROP TABLE IF EXISTS dashboard_boards;
