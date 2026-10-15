-- Append-only audit trail of who did what to which record (healthcare systems need to answer "who looked at this?").
-- actor_id is deliberately NOT a foreign key: the trail must outlive the user row.
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_id      uuid,
  actor_role    text,
  action        text NOT NULL,
  resource_type text,
  resource_id   text,
  ip            text,
  request_id    text,
  meta          jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_at_idx       ON audit_log (at DESC);
CREATE INDEX audit_actor_idx    ON audit_log (actor_id, at DESC);
CREATE INDEX audit_resource_idx ON audit_log (resource_type, resource_id, at DESC);

CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Hot paths used by the portals
CREATE INDEX IF NOT EXISTS appt_status_start_idx ON appointments (status, start_at);
