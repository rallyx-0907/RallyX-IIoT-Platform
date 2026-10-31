-- Versioned semantic projection of adapter templates. Existing source IDs/history stay intact.
ALTER TABLE entity_profiles ADD COLUMN origin_template_id text REFERENCES device_templates(id);
ALTER TABLE entity_profiles ADD COLUMN origin_template_version integer;
CREATE TABLE device_template_profile_versions (
 template_id text NOT NULL REFERENCES device_templates(id), template_version integer NOT NULL,
 profile_id text NOT NULL, profile_version integer NOT NULL,
 PRIMARY KEY(template_id,template_version),
 FOREIGN KEY(profile_id,profile_version) REFERENCES entity_profile_versions(profile_id,version)
);
CREATE TABLE onboarding_requests (
 request_id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
 fingerprint text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
