-- Keep the outbox timestamp consistent with the rest of the schema.
CREATE TRIGGER trg_order_notification_outbox_set_updated_at
BEFORE UPDATE ON order_notification_outbox
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
