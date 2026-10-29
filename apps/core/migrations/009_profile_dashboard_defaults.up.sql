ALTER TABLE entity_profile_versions ADD COLUMN default_template_id text;
ALTER TABLE entity_profile_versions ADD COLUMN default_template_version integer;
ALTER TABLE entity_profile_versions ADD CONSTRAINT profile_version_dashboard_fk FOREIGN KEY(default_template_id,default_template_version) REFERENCES entity_dashboard_versions(template_id,version);
ALTER TABLE entity_profile_versions ADD CONSTRAINT profile_version_dashboard_pair CHECK((default_template_id IS NULL)=(default_template_version IS NULL));

-- A configurable generic overview, not a hard-coded equipment application.
INSERT INTO entity_dashboard_templates(id,name,draft,published_version) VALUES('rallyx-entity-overview','Tổng quan thực thể',
'{"schema_version":1,"pages":[{"id":"overview","name":"Tổng quan","widgets":[
 {"id":"status","type":"distribution","title":"Trạng thái thiết bị con","binding":{"scope":"children","metric":""},"aggregation":"count","layout":{"x":0,"y":0,"w":8,"h":8},"presentation":{"precision":0}},
 {"id":"children","type":"entity-table","title":"Khu vực / máy / thiết bị","binding":{"scope":"children","metric":""},"aggregation":"last","layout":{"x":8,"y":0,"w":16,"h":8},"presentation":{"precision":0}},
 {"id":"alarms","type":"alarm-table","title":"Vấn đề cần xử lý","binding":{"scope":"descendants","metric":""},"aggregation":"last","layout":{"x":0,"y":8,"w":24,"h":7},"presentation":{"precision":0}}
]}]}',1);
INSERT INTO entity_dashboard_versions(template_id,version,document) SELECT id,1,draft FROM entity_dashboard_templates WHERE id='rallyx-entity-overview';
INSERT INTO platform_settings(key,value) VALUES('native_default_dashboard_template','{"id":"rallyx-entity-overview","version":1}');
