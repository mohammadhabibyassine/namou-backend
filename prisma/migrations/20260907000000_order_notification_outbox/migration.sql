CREATE TABLE order_notification_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind            VARCHAR(50) NOT NULL,
    queued_at       TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, kind)
);

CREATE INDEX idx_order_notification_outbox_pending
    ON order_notification_outbox(completed_at, queued_at, created_at)
    WHERE completed_at IS NULL;
