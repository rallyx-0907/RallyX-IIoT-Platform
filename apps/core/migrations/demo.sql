INSERT INTO sites(id,name) VALUES('demo-site','Demo Site') ON CONFLICT DO NOTHING;
INSERT INTO areas(id,site_id,name) VALUES('demo-area','demo-site','Demo Area') ON CONFLICT DO NOTHING;
INSERT INTO panels(id,area_id,name) VALUES('demo-panel','demo-area','Electrical Panel 01') ON CONFLICT DO NOTHING;
INSERT INTO assets(id,area_id,name,type) VALUES
  ('demo-motor','demo-area','Motor 01','motor'),
  ('demo-sensor','demo-area','Analog Sensor 01','sensor') ON CONFLICT DO NOTHING;
INSERT INTO connections(id,site_id,name,protocol,protocol_config) VALUES('demo-simulator','demo-site','Zero-hardware simulator','simulator','{"enabled":true}') ON CONFLICT DO NOTHING;
INSERT INTO devices(id,connection_id,asset_id,name) VALUES
  ('demo-motor-device','demo-simulator','demo-motor','Simulated motor'),
  ('demo-sensor-device','demo-simulator','demo-sensor','Simulated sensor') ON CONFLICT DO NOTHING;
INSERT INTO tags(id,asset_id,device_id,key,name,datatype,data_type,source_type,unit,semantic,metadata) VALUES
  ('demo-motor-run','demo-motor','demo-motor-device','run','Run','boolean','bool','simulator','','run','{"simulator_value":false}'),
  ('demo-motor-fault','demo-motor','demo-motor-device','fault','Fault','boolean','bool','simulator','','fault','{"simulator_value":false}'),
  ('demo-motor-current','demo-motor','demo-motor-device','current','Current','number','float32','simulator','A','','{"simulator_value":0}'),
  ('demo-sensor-value','demo-sensor','demo-sensor-device','value','Value','number','float32','simulator','°C','','{"simulator_value":25}')
ON CONFLICT(id) DO UPDATE SET metadata=tags.metadata || EXCLUDED.metadata
WHERE tags.source_type='simulator' AND NOT (tags.metadata ? 'simulator_value') AND tags.deleted_at IS NULL;
INSERT INTO rules(id,tag_id,name,type,threshold,severity) VALUES
  ('demo-fault','demo-motor-fault','Motor fault','fault',NULL,'critical'),
  ('demo-current-high','demo-motor-current','Motor current high','high',10,'warning'),
  ('demo-sensor-high','demo-sensor-value','Temperature high','high',80,'warning'),
  ('demo-communication','demo-motor-run','Motor communication stale','stale',NULL,'warning') ON CONFLICT DO NOTHING;
