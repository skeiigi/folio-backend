CREATE TABLE users (
  id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, roles JSONB NOT NULL DEFAULT '["client"]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','deleted')),
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id UUID PRIMARY KEY, user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  public_name TEXT NOT NULL, specialization JSONB NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '',
  layout_config JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE artworks (
  id UUID PRIMARY KEY, author_profile_id UUID NOT NULL REFERENCES creator_profiles(id),
  title TEXT NOT NULL, description TEXT NOT NULL, work_type TEXT NOT NULL CHECK (work_type IN ('model3d','illustration','animation','other')),
  style TEXT NOT NULL, technical_details JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE services (
  id UUID PRIMARY KEY, author_profile_id UUID NOT NULL REFERENCES creator_profiles(id),
  title TEXT NOT NULL, description TEXT NOT NULL, price_range JSONB NOT NULL,
  estimated_days INTEGER CHECK (estimated_days IS NULL OR estimated_days > 0), revision_rounds INTEGER NOT NULL DEFAULT 2 CHECK (revision_rounds >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE briefs (
  id UUID PRIMARY KEY, client_user_id UUID NOT NULL REFERENCES users(id), author_profile_id UUID NOT NULL REFERENCES creator_profiles(id),
  title TEXT NOT NULL, description TEXT NOT NULL, budget_range JSONB NOT NULL, desired_deadline DATE,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','in_discussion','accepted','in_progress','completed','rejected','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Technical storage adapter. Business metadata remains in MediaFile.
CREATE TABLE storage_objects (key TEXT PRIMARY KEY, bytes BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE media_files (
  id UUID PRIMARY KEY, artwork_id UUID REFERENCES artworks(id) ON DELETE CASCADE, brief_id UUID REFERENCES briefs(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('cover','preview','model','reference')),
  file_name TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((artwork_id IS NULL) <> (brief_id IS NULL)),
  CHECK ((brief_id IS NOT NULL AND purpose='reference') OR (artwork_id IS NOT NULL AND purpose IN ('cover','preview','model')))
);
CREATE UNIQUE INDEX media_single_cover ON media_files(artwork_id) WHERE purpose='cover';
CREATE UNIQUE INDEX media_single_model ON media_files(artwork_id) WHERE purpose='model';
CREATE TABLE brief_events (
  id UUID PRIMARY KEY, brief_id UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id), from_status TEXT, to_status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Transactional outbox: notifications and future CRM/BPMS hooks never roll back a saved brief.
CREATE TABLE event_outbox (
  id UUID PRIMARY KEY, event_type TEXT NOT NULL, target TEXT NOT NULL, payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), delivered_at TIMESTAMPTZ
);
CREATE INDEX artworks_discovery ON artworks(status,work_type,created_at DESC);
CREATE INDEX profiles_status ON creator_profiles(status);
CREATE INDEX briefs_client ON briefs(client_user_id,created_at DESC);
CREATE INDEX briefs_author ON briefs(author_profile_id,created_at DESC);
CREATE INDEX media_artwork ON media_files(artwork_id);
CREATE INDEX media_brief ON media_files(brief_id);
CREATE INDEX outbox_pending ON event_outbox(status,next_attempt_at);
