CREATE TABLE dashboards (
 id text PRIMARY KEY,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 type text NOT NULL CHECK(type IN ('standard','simulation')),
 owner_user_id text REFERENCES users(id),
 canvas jsonb NOT NULL CHECK(jsonb_typeof(canvas)='object'),
 layout jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(layout)='array'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by text REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
