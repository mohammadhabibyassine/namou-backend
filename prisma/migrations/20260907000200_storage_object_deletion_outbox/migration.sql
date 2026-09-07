CREATE TABLE storage_object_deletion_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    object_key      TEXT NOT NULL,
    processing_at   TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, object_key)
);

CREATE INDEX idx_storage_object_deletion_pending
    ON storage_object_deletion_outbox(completed_at, created_at)
    WHERE completed_at IS NULL;

CREATE TRIGGER trg_storage_object_deletion_outbox_set_updated_at
BEFORE UPDATE ON storage_object_deletion_outbox
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
