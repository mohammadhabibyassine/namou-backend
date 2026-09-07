-- ============================================================================
-- Mini e-commerce platform -- corrected PostgreSQL 16 schema
-- ============================================================================
-- Design targets:
--   * adjacency-list categories with cycle-safe recursive tree queries
--   * normalized, product-scoped variant attributes
--   * one stock location: every active product has active variant rows
--   * unique purchasable attribute combinations per product
--   * authenticated-only carts and wishlists
--   * immutable order snapshots and atomic, concurrency-safe checkout
--   * database-enforced soft deletion for products and categories
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE order_status AS ENUM (
    'pending',
    'confirmed',
    'shipped',
    'delivered',
    'cancelled'
);

CREATE TYPE chat_conversation_status AS ENUM (
    'open',
    'closed',
    'archived'
);

-- ============================================================================
-- 1. RBAC
-- ============================================================================

CREATE TABLE roles (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            CITEXT      NOT NULL UNIQUE,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (btrim(name::text) <> '')
);

CREATE TABLE permissions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            CITEXT      NOT NULL UNIQUE,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (btrim(name::text) <> '')
);

CREATE TABLE role_permissions (
    role_id         UUID        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID        NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

-- The primary key already indexes role_id as its leading column.
CREATE INDEX idx_role_permissions_permission_id
    ON role_permissions(permission_id);

-- ============================================================================
-- 2. Users, refresh tokens, and saved addresses
-- ============================================================================

CREATE TABLE users (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email               CITEXT       NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    first_name          VARCHAR(100),
    last_name           VARCHAR(100),
    phone               VARCHAR(32),
    role_id             UUID         NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    is_active           BOOLEAN      NOT NULL DEFAULT true,
    email_verified_at   TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (btrim(email::text) <> ''),
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_active
    ON users(id)
    WHERE is_active AND deleted_at IS NULL;

CREATE TABLE refresh_tokens (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash              CHAR(64)    NOT NULL UNIQUE,
    token_family_id         UUID        NOT NULL DEFAULT gen_random_uuid(),
    replaced_by_token_id    UUID        REFERENCES refresh_tokens(id) ON DELETE SET NULL,
    expires_at              TIMESTAMPTZ NOT NULL,
    revoked_at              TIMESTAMPTZ,
    device_info             TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (token_hash ~ '^[0-9A-Fa-f]{64}$'),
    CHECK (expires_at > created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    CHECK (replaced_by_token_id IS NULL OR replaced_by_token_id <> id)
);

CREATE INDEX idx_refresh_tokens_active_user
    ON refresh_tokens(user_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE INDEX idx_refresh_tokens_family
    ON refresh_tokens(token_family_id, created_at);

CREATE INDEX idx_refresh_tokens_expiry_cleanup
    ON refresh_tokens(expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE user_addresses (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label               VARCHAR(50),
    recipient_name      VARCHAR(200) NOT NULL,
    address_line_1      VARCHAR(255) NOT NULL,
    address_line_2      VARCHAR(255),
    city                VARCHAR(100) NOT NULL,
    state               VARCHAR(100),
    postal_code         VARCHAR(20)  NOT NULL,
    country_code        VARCHAR(2)   NOT NULL,
    phone               VARCHAR(32),
    is_default          BOOLEAN      NOT NULL DEFAULT false,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (country_code ~ '^[A-Z]{2}$'),
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE INDEX idx_user_addresses_active_user
    ON user_addresses(user_id)
    WHERE deleted_at IS NULL;

-- This enforces "at most one" immediately. A deferred trigger below also
-- enforces "exactly one" whenever a user has at least one active address.
CREATE UNIQUE INDEX uq_user_addresses_one_active_default
    ON user_addresses(user_id)
    WHERE is_default AND deleted_at IS NULL;

-- ============================================================================
-- 3. Categories
-- ============================================================================

CREATE TABLE categories (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id       UUID         REFERENCES categories(id) ON DELETE RESTRICT,
    name            VARCHAR(255) NOT NULL,
    slug            CITEXT       NOT NULL UNIQUE,
    description     TEXT,
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (btrim(name) <> ''),
    CHECK (btrim(slug::text) <> ''),
    CHECK (parent_id IS NULL OR parent_id <> id),
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE INDEX idx_categories_parent_sort
    ON categories(parent_id, sort_order, name);

CREATE INDEX idx_categories_active_parent_sort
    ON categories(parent_id, sort_order, name)
    WHERE deleted_at IS NULL;

-- A queryable full forest. The cycle-prevention trigger below guarantees the
-- recursive term cannot loop.
CREATE VIEW category_tree AS
WITH RECURSIVE tree AS (
    SELECT
        c.id,
        c.parent_id,
        c.name,
        c.slug,
        c.description,
        c.sort_order,
        c.deleted_at,
        0::INTEGER                         AS depth,
        ARRAY[c.id]::UUID[]                AS id_path,
        ARRAY[c.name]::TEXT[]              AS name_path,
        ARRAY[c.sort_order]::INTEGER[]     AS sort_path
    FROM categories AS c
    WHERE c.parent_id IS NULL

    UNION ALL

    SELECT
        c.id,
        c.parent_id,
        c.name,
        c.slug,
        c.description,
        c.sort_order,
        c.deleted_at,
        t.depth + 1,
        t.id_path || c.id,
        t.name_path || c.name::TEXT,
        t.sort_path || c.sort_order
    FROM categories AS c
    JOIN tree AS t ON t.id = c.parent_id
)
SELECT * FROM tree;

-- Returns one category and all descendants. Set p_include_deleted to true for
-- administrative/history views.
CREATE FUNCTION category_subtree(
    p_category_id UUID,
    p_include_deleted BOOLEAN DEFAULT false
)
RETURNS TABLE (
    id UUID,
    parent_id UUID,
    name VARCHAR(255),
    slug CITEXT,
    depth INTEGER,
    id_path UUID[]
)
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE subtree AS (
        SELECT
            c.id,
            c.parent_id,
            c.name,
            c.slug,
            0::INTEGER AS depth,
            ARRAY[c.id]::UUID[] AS id_path
        FROM categories AS c
        WHERE c.id = p_category_id
          AND (p_include_deleted OR c.deleted_at IS NULL)

        UNION ALL

        SELECT
            c.id,
            c.parent_id,
            c.name,
            c.slug,
            s.depth + 1,
            s.id_path || c.id
        FROM categories AS c
        JOIN subtree AS s ON s.id = c.parent_id
        WHERE p_include_deleted OR c.deleted_at IS NULL
    )
    SELECT * FROM subtree;
$$;

-- ============================================================================
-- 4. Products and normalized variant configuration
-- ============================================================================

CREATE TABLE products (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id     UUID           NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    title           VARCHAR(255)   NOT NULL,
    slug            CITEXT         NOT NULL UNIQUE,
    description     TEXT,
    base_price      NUMERIC(12, 2) NOT NULL CHECK (base_price >= 0),
    currency_code   VARCHAR(3)     NOT NULL DEFAULT 'USD',
    is_active       BOOLEAN        NOT NULL DEFAULT true,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    search_vector   TSVECTOR       GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(description, '')), 'B')
    ) STORED,
    CHECK (btrim(title) <> ''),
    CHECK (btrim(slug::text) <> ''),
    CHECK (currency_code ~ '^[A-Z]{3}$'),
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

-- General FK/admin lookup plus listing-oriented partial indexes.
CREATE INDEX idx_products_category_id ON products(category_id);

CREATE INDEX idx_products_active_category_created
    ON products(category_id, created_at DESC)
    WHERE is_active AND deleted_at IS NULL;

CREATE INDEX idx_products_active_category_base_price
    ON products(category_id, base_price)
    WHERE is_active AND deleted_at IS NULL;

CREATE INDEX idx_products_active_search
    ON products USING GIN(search_vector)
    WHERE is_active AND deleted_at IS NULL;

CREATE TABLE attribute_types (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name            CITEXT       NOT NULL UNIQUE,
    slug            CITEXT       NOT NULL UNIQUE,
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (btrim(name::text) <> ''),
    CHECK (btrim(slug::text) <> '')
);

CREATE TABLE attribute_values (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    attribute_type_id   UUID        NOT NULL REFERENCES attribute_types(id) ON DELETE RESTRICT,
    value               CITEXT      NOT NULL,
    sort_order          INTEGER     NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (attribute_type_id, value),
    UNIQUE (id, attribute_type_id),
    CHECK (btrim(value::text) <> '')
);

-- Declares the dimensions used by a product, such as Color and Size.
CREATE TABLE product_attribute_types (
    product_id          UUID        NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    attribute_type_id   UUID        NOT NULL REFERENCES attribute_types(id) ON DELETE RESTRICT,
    sort_order          INTEGER     NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, attribute_type_id)
);

CREATE INDEX idx_product_attribute_types_type_id
    ON product_attribute_types(attribute_type_id, product_id);

-- Declares which catalog values are offered by a particular product.
CREATE TABLE product_attribute_values (
    product_id          UUID        NOT NULL,
    attribute_type_id   UUID        NOT NULL,
    attribute_value_id  UUID        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, attribute_value_id),
    UNIQUE (product_id, attribute_type_id, attribute_value_id),
    FOREIGN KEY (product_id, attribute_type_id)
        REFERENCES product_attribute_types(product_id, attribute_type_id)
        ON DELETE CASCADE,
    FOREIGN KEY (attribute_value_id, attribute_type_id)
        REFERENCES attribute_values(id, attribute_type_id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_product_attribute_values_value_id
    ON product_attribute_values(attribute_value_id, product_id);

CREATE TABLE product_variants (
    id                      UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id              UUID           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    sku                     CITEXT         NOT NULL UNIQUE,
    price_override          NUMERIC(12, 2) CHECK (price_override IS NULL OR price_override >= 0),
    -- Denormalized and trigger-maintained so effective-price filtering is indexable.
    effective_price         NUMERIC(12, 2) NOT NULL CHECK (effective_price >= 0),
    stock_quantity          INTEGER        NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    is_default              BOOLEAN        NOT NULL DEFAULT false,
    deleted_at              TIMESTAMPTZ,
    -- The following two columns are trigger-maintained. A NULL owner excludes a
    -- soft-deleted variant from active combination uniqueness.
    combination_product_id  UUID           REFERENCES products(id) ON DELETE RESTRICT,
    combination_signature   JSONB          NOT NULL DEFAULT '{}'::jsonb,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
    UNIQUE (id, product_id),
    UNIQUE (combination_product_id, combination_signature)
        DEFERRABLE INITIALLY DEFERRED,
    CHECK (btrim(sku::text) <> ''),
    CHECK (jsonb_typeof(combination_signature) = 'object'),
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE INDEX idx_variants_active_product
    ON product_variants(product_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_variants_active_effective_price
    ON product_variants(effective_price, product_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_variants_in_stock
    ON product_variants(product_id, effective_price)
    WHERE deleted_at IS NULL AND stock_quantity > 0;

CREATE UNIQUE INDEX uq_variants_one_active_default
    ON product_variants(product_id)
    WHERE is_default AND deleted_at IS NULL;

-- Each active variant must have exactly one allowed value for every attribute
-- type configured on its product. Deferred triggers below enforce completeness.
CREATE TABLE variant_attribute_values (
    variant_id          UUID        NOT NULL,
    product_id          UUID        NOT NULL,
    attribute_type_id   UUID        NOT NULL,
    attribute_value_id  UUID        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (variant_id, attribute_type_id),
    FOREIGN KEY (variant_id, product_id)
        REFERENCES product_variants(id, product_id)
        ON DELETE RESTRICT,
    FOREIGN KEY (product_id, attribute_type_id, attribute_value_id)
        REFERENCES product_attribute_values(
            product_id,
            attribute_type_id,
            attribute_value_id
        )
        ON DELETE CASCADE
);

-- Supports exact-value filters and intersections across multiple dimensions.
CREATE INDEX idx_variant_attribute_values_filter
    ON variant_attribute_values(
        attribute_type_id,
        attribute_value_id,
        product_id,
        variant_id
    );

-- ============================================================================
-- 5. Product images
-- ============================================================================

CREATE TABLE product_images (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID         NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id      UUID,
    image_url       TEXT         NOT NULL,
    alt_text        VARCHAR(255),
    sort_order      INTEGER      NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    FOREIGN KEY (variant_id, product_id)
        REFERENCES product_variants(id, product_id)
        ON DELETE RESTRICT,
    UNIQUE (product_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
    CHECK (btrim(image_url) <> '')
);

-- The unique product/order constraint already indexes product_id.
CREATE INDEX idx_product_images_variant
    ON product_images(variant_id, product_id)
    WHERE variant_id IS NOT NULL;

-- ============================================================================
-- 6. Authenticated cart and wishlist
-- ============================================================================
-- There are intentionally no guest/session identifiers. Guest state remains on
-- the client and is merged into these rows after successful authentication.

CREATE TABLE cart_items (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    variant_id      UUID        NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity        INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, variant_id)
);

-- The unique constraint covers user_id; this index supports reverse FK checks
-- and product/variant administration.
CREATE INDEX idx_cart_items_variant_id ON cart_items(variant_id);

CREATE TABLE wishlist_items (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id      UUID        NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (variant_id, product_id)
        REFERENCES product_variants(id, product_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_wishlist_product_level
    ON wishlist_items(user_id, product_id)
    WHERE variant_id IS NULL;

CREATE UNIQUE INDEX uq_wishlist_variant_level
    ON wishlist_items(user_id, product_id, variant_id)
    WHERE variant_id IS NOT NULL;

CREATE INDEX idx_wishlist_items_user_created
    ON wishlist_items(user_id, created_at DESC);

CREATE INDEX idx_wishlist_items_variant
    ON wishlist_items(variant_id, product_id)
    WHERE variant_id IS NOT NULL;

-- ============================================================================
-- 7. Orders and immutable snapshots
-- ============================================================================

CREATE TABLE orders (
    id                      UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    order_number            VARCHAR(30)    NOT NULL UNIQUE,
    status                  order_status   NOT NULL DEFAULT 'pending',
    subtotal                NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_amount         NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    shipping_cost           NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
    tax_amount              NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total                   NUMERIC(14, 2) GENERATED ALWAYS AS (
        subtotal - discount_amount + shipping_cost + tax_amount
    ) STORED,
    currency_code           VARCHAR(3)     NOT NULL,
    shipping_recipient_name VARCHAR(200)   NOT NULL,
    shipping_address_line_1 VARCHAR(255)   NOT NULL,
    shipping_address_line_2 VARCHAR(255),
    shipping_city           VARCHAR(100)   NOT NULL,
    shipping_state          VARCHAR(100),
    shipping_postal_code    VARCHAR(20)    NOT NULL,
    shipping_country_code   VARCHAR(2)     NOT NULL,
    shipping_phone          VARCHAR(32),
    notes                   TEXT,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CHECK (discount_amount <= subtotal),
    CHECK (subtotal - discount_amount + shipping_cost + tax_amount >= 0),
    CHECK (currency_code ~ '^[A-Z]{3}$'),
    CHECK (shipping_country_code ~ '^[A-Z]{2}$')
);

CREATE INDEX idx_orders_user_created
    ON orders(user_id, created_at DESC);

CREATE INDEX idx_orders_status_created
    ON orders(status, created_at DESC);

CREATE TABLE order_items (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID           NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id      UUID           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id      UUID           NOT NULL,
    product_title   VARCHAR(255)   NOT NULL,
    variant_label   TEXT,
    sku             VARCHAR(100)   NOT NULL,
    image_url       TEXT,
    unit_price      NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    quantity        INTEGER        NOT NULL CHECK (quantity > 0),
    line_total      NUMERIC(18, 2) GENERATED ALWAYS AS (
        (unit_price * quantity)::NUMERIC(18, 2)
    ) STORED,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    FOREIGN KEY (variant_id, product_id)
        REFERENCES product_variants(id, product_id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_variant
    ON order_items(variant_id, product_id);

CREATE TABLE order_status_history (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_status     order_status,
    to_status       order_status  NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CHECK (
        (from_status IS NULL AND to_status = 'pending')
        OR from_status IS DISTINCT FROM to_status
    )
);

CREATE INDEX idx_order_status_history_timeline
    ON order_status_history(order_id, created_at, id);

-- ============================================================================
-- 8. Persisted customer-to-support chat
-- ============================================================================

CREATE TABLE chat_conversations (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID                     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_admin_id   UUID                     REFERENCES users(id) ON DELETE RESTRICT,
    subject             VARCHAR(255),
    status              chat_conversation_status NOT NULL DEFAULT 'open',
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    CHECK (assigned_admin_id IS NULL OR assigned_admin_id <> user_id)
);

CREATE INDEX idx_chat_conversations_user_updated
    ON chat_conversations(user_id, updated_at DESC);

CREATE INDEX idx_chat_conversations_admin_status_updated
    ON chat_conversations(assigned_admin_id, status, updated_at DESC)
    WHERE assigned_admin_id IS NOT NULL;

CREATE TABLE chat_messages (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id     UUID        NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_id           UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    content             TEXT        NOT NULL,
    read_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (btrim(content) <> ''),
    CHECK (read_at IS NULL OR read_at >= created_at)
);

CREATE INDEX idx_chat_messages_timeline
    ON chat_messages(conversation_id, created_at, id);

CREATE INDEX idx_chat_messages_sender_id
    ON chat_messages(sender_id);

CREATE INDEX idx_chat_messages_unread
    ON chat_messages(conversation_id, created_at)
    WHERE read_at IS NULL;

-- ============================================================================
-- 9. General timestamp trigger (explicit table allow-list)
-- ============================================================================

CREATE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'roles',
        'permissions',
        'users',
        'refresh_tokens',
        'user_addresses',
        'categories',
        'products',
        'attribute_types',
        'attribute_values',
        'product_attribute_types',
        'product_attribute_values',
        'product_variants',
        'variant_attribute_values',
        'product_images',
        'cart_items',
        'wishlist_items',
        'orders',
        'chat_conversations',
        'chat_messages'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_set_updated_at
             BEFORE UPDATE ON %1$I
             FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()',
            v_table
        );
    END LOOP;
END;
$$;

-- ============================================================================
-- 10. Integrity triggers
-- ============================================================================

-- Prevent category cycles, including indirect cycles, and prevent attaching an
-- active category beneath a soft-deleted parent.
CREATE FUNCTION fn_validate_category_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent_deleted_at TIMESTAMPTZ;
    v_cycle_found BOOLEAN;
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.parent_id = NEW.id THEN
        RAISE EXCEPTION 'A category cannot be its own parent';
    END IF;

    SELECT deleted_at
      INTO v_parent_deleted_at
      FROM categories
     WHERE id = NEW.parent_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent category % does not exist', NEW.parent_id;
    END IF;

    IF NEW.deleted_at IS NULL AND v_parent_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'An active category cannot have a deleted parent';
    END IF;

    WITH RECURSIVE ancestors AS (
        SELECT c.id, c.parent_id
          FROM categories AS c
         WHERE c.id = NEW.parent_id

        UNION

        SELECT c.id, c.parent_id
          FROM categories AS c
          JOIN ancestors AS a ON c.id = a.parent_id
    )
    SELECT EXISTS (
        SELECT 1 FROM ancestors WHERE id = NEW.id
    )
    INTO v_cycle_found;

    IF v_cycle_found THEN
        RAISE EXCEPTION 'Category parent change would create a cycle';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_categories_validate_parent
BEFORE INSERT OR UPDATE OF parent_id, deleted_at ON categories
FOR EACH ROW EXECUTE FUNCTION fn_validate_category_parent();

-- Do not allow deleting a category while non-deleted descendants or products
-- still depend on it. Reassign or soft-delete those rows first.
CREATE FUNCTION fn_validate_category_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        IF EXISTS (
            SELECT 1
              FROM categories
             WHERE parent_id = OLD.id
               AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Cannot soft-delete category % while it has active child categories', OLD.id;
        END IF;

        IF EXISTS (
            SELECT 1
              FROM products
             WHERE category_id = OLD.id
               AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Cannot soft-delete category % while it has non-deleted products', OLD.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Created after products exists because the function queries products.
CREATE TRIGGER trg_categories_validate_soft_delete
BEFORE UPDATE OF deleted_at ON categories
FOR EACH ROW EXECUTE FUNCTION fn_validate_category_soft_delete();

CREATE FUNCTION fn_validate_product_category()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.deleted_at IS NULL AND NOT EXISTS (
        SELECT 1
          FROM categories
         WHERE id = NEW.category_id
           AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'A non-deleted product must belong to a non-deleted category';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_validate_category
BEFORE INSERT OR UPDATE OF category_id, deleted_at ON products
FOR EACH ROW EXECUTE FUNCTION fn_validate_product_category();

-- Products and categories are soft-delete-only. Variants are also protected
-- because they own stock and are referenced by historical order snapshots.
CREATE FUNCTION fn_prevent_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Hard DELETE is disabled for %. Set deleted_at instead.', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_categories_prevent_delete
BEFORE DELETE ON categories
FOR EACH ROW EXECUTE FUNCTION fn_prevent_hard_delete();

CREATE TRIGGER trg_products_prevent_delete
BEFORE DELETE ON products
FOR EACH ROW EXECUTE FUNCTION fn_prevent_hard_delete();

CREATE TRIGGER trg_variants_prevent_delete
BEFORE DELETE ON product_variants
FOR EACH ROW EXECUTE FUNCTION fn_prevent_hard_delete();

CREATE TRIGGER trg_orders_prevent_delete
BEFORE DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_prevent_hard_delete();

-- A user with any non-deleted saved address must have exactly one default.
CREATE FUNCTION fn_check_user_default_address(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_active_count INTEGER;
    v_default_count INTEGER;
BEGIN
    SELECT
        count(*)::INTEGER,
        count(*) FILTER (WHERE is_default)::INTEGER
    INTO v_active_count, v_default_count
    FROM user_addresses
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;

    IF v_active_count > 0 AND v_default_count <> 1 THEN
        RAISE EXCEPTION 'User % must have exactly one default active address', p_user_id;
    END IF;
END;
$$;

CREATE FUNCTION fn_assert_user_default_address()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM fn_check_user_default_address(OLD.user_id);
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE')
       AND (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
        PERFORM fn_check_user_default_address(NEW.user_id);
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_user_addresses_require_default
AFTER INSERT OR UPDATE OR DELETE ON user_addresses
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_assert_user_default_address();

-- Derive effective price and the active uniqueness owner on every variant write.
-- Recomputing the small JSON signature also prevents clients from forging it.
CREATE FUNCTION fn_prepare_product_variant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_base_price NUMERIC(12, 2);
    v_product_deleted_at TIMESTAMPTZ;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN
        RAISE EXCEPTION 'A variant cannot be moved between products';
    END IF;

    SELECT base_price, deleted_at
      INTO v_base_price, v_product_deleted_at
      FROM products
     WHERE id = NEW.product_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % does not exist', NEW.product_id;
    END IF;

    IF NEW.deleted_at IS NULL AND v_product_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'An active variant cannot belong to a deleted product';
    END IF;

    NEW.effective_price := coalesce(NEW.price_override, v_base_price);
    NEW.combination_product_id := CASE
        WHEN NEW.deleted_at IS NULL THEN NEW.product_id
        ELSE NULL
    END;

    SELECT coalesce(
        jsonb_object_agg(
            vav.attribute_type_id::TEXT,
            to_jsonb(vav.attribute_value_id::TEXT)
            ORDER BY vav.attribute_type_id::TEXT
        ),
        '{}'::jsonb
    )
    INTO NEW.combination_signature
    FROM variant_attribute_values AS vav
    WHERE vav.variant_id = NEW.id;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_variants_prepare
BEFORE INSERT OR UPDATE ON product_variants
FOR EACH ROW EXECUTE FUNCTION fn_prepare_product_variant();

-- If a product base price changes, refresh variants that inherit that price.
CREATE FUNCTION fn_refresh_inherited_variant_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.base_price IS DISTINCT FROM OLD.base_price THEN
        UPDATE product_variants
           SET effective_price = NEW.base_price
         WHERE product_id = NEW.id
           AND price_override IS NULL;
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_products_refresh_variant_prices
AFTER UPDATE OF base_price ON products
FOR EACH ROW EXECUTE FUNCTION fn_refresh_inherited_variant_prices();

-- Touch affected variants after option assignment changes; the BEFORE UPDATE
-- trigger above recomputes their canonical combination signatures.
CREATE FUNCTION fn_refresh_variant_signature()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        UPDATE product_variants
           SET combination_signature = combination_signature
         WHERE id = OLD.variant_id;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE')
       AND (TG_OP = 'INSERT' OR NEW.variant_id IS DISTINCT FROM OLD.variant_id) THEN
        UPDATE product_variants
           SET combination_signature = combination_signature
         WHERE id = NEW.variant_id;
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_variant_attributes_refresh_signature
AFTER INSERT OR UPDATE OR DELETE ON variant_attribute_values
FOR EACH ROW EXECUTE FUNCTION fn_refresh_variant_signature();

-- At commit, every active product must have at least one active variant,
-- exactly one active default, and every active variant must contain one value
-- for each configured product attribute type. The deferral allows product,
-- variants, configuration, and values to be created in one transaction.
CREATE FUNCTION fn_check_product_variant_invariants(p_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_is_active BOOLEAN;
    v_variant_count INTEGER;
    v_default_count INTEGER;
    v_type_count INTEGER;
BEGIN
    SELECT is_active AND deleted_at IS NULL
      INTO v_is_active
      FROM products
     WHERE id = p_product_id;

    IF NOT FOUND OR NOT v_is_active THEN
        RETURN;
    END IF;

    SELECT
        count(*)::INTEGER,
        count(*) FILTER (WHERE is_default)::INTEGER
    INTO v_variant_count, v_default_count
    FROM product_variants
    WHERE product_id = p_product_id
      AND deleted_at IS NULL;

    IF v_variant_count = 0 THEN
        RAISE EXCEPTION 'Active product % must have at least one active variant', p_product_id;
    END IF;

    IF v_default_count <> 1 THEN
        RAISE EXCEPTION 'Active product % must have exactly one active default variant', p_product_id;
    END IF;

    SELECT count(*)::INTEGER
      INTO v_type_count
      FROM product_attribute_types
     WHERE product_id = p_product_id;

    IF EXISTS (
        SELECT 1
          FROM product_variants AS v
         WHERE v.product_id = p_product_id
           AND v.deleted_at IS NULL
           AND (
               SELECT count(*)
                 FROM variant_attribute_values AS vav
                WHERE vav.variant_id = v.id
           ) <> v_type_count
    ) THEN
        RAISE EXCEPTION 'Every active variant of product % must have one value for every configured attribute type', p_product_id;
    END IF;
END;
$$;

CREATE FUNCTION fn_assert_product_variant_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'products' THEN
        PERFORM fn_check_product_variant_invariants(NEW.id);
        RETURN NULL;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM fn_check_product_variant_invariants(OLD.product_id);
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE')
       AND (TG_OP = 'INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id) THEN
        PERFORM fn_check_product_variant_invariants(NEW.product_id);
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_products_variant_invariants
AFTER INSERT OR UPDATE ON products
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_assert_product_variant_invariants();

CREATE CONSTRAINT TRIGGER trg_variants_product_invariants
AFTER INSERT OR UPDATE OR DELETE ON product_variants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_assert_product_variant_invariants();

CREATE CONSTRAINT TRIGGER trg_variant_values_product_invariants
AFTER INSERT OR UPDATE OR DELETE ON variant_attribute_values
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_assert_product_variant_invariants();

CREATE CONSTRAINT TRIGGER trg_product_attribute_types_variant_invariants
AFTER INSERT OR UPDATE OR DELETE ON product_attribute_types
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_assert_product_variant_invariants();

-- Order status history cannot drift from orders.status: it is generated for the
-- initial state and every actual status change.
CREATE FUNCTION fn_record_order_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO order_status_history(order_id, from_status, to_status)
        VALUES (NEW.id, NULL, NEW.status);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO order_status_history(order_id, from_status, to_status)
        VALUES (NEW.id, OLD.status, NEW.status);
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_orders_record_status_history
AFTER INSERT OR UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION fn_record_order_status_history();

-- Order snapshots and history are append-only.
CREATE FUNCTION fn_prevent_order_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_order_items_immutable
BEFORE UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION fn_prevent_order_history_mutation();

CREATE TRIGGER trg_order_status_history_immutable
BEFORE UPDATE OR DELETE ON order_status_history
FOR EACH ROW EXECUTE FUNCTION fn_prevent_order_history_mutation();

-- Only the customer who owns a conversation or its assigned support user may
-- send messages. Assigned support users must actually possess manage_chat.
CREATE FUNCTION fn_validate_chat_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.assigned_admin_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM users AS u
          JOIN role_permissions AS rp ON rp.role_id = u.role_id
          JOIN permissions AS p ON p.id = rp.permission_id
         WHERE u.id = NEW.assigned_admin_id
           AND u.is_active
           AND u.deleted_at IS NULL
           AND p.name = 'manage_chat'
    ) THEN
        RAISE EXCEPTION 'Assigned support user must have the manage_chat permission';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chat_conversations_validate_assignment
BEFORE INSERT OR UPDATE OF assigned_admin_id ON chat_conversations
FOR EACH ROW EXECUTE FUNCTION fn_validate_chat_assignment();

CREATE FUNCTION fn_validate_chat_sender()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM chat_conversations AS c
         WHERE c.id = NEW.conversation_id
           AND (
               c.user_id = NEW.sender_id
               OR (
                   c.assigned_admin_id = NEW.sender_id
                   AND EXISTS (
                       SELECT 1
                         FROM users AS u
                         JOIN role_permissions AS rp ON rp.role_id = u.role_id
                         JOIN permissions AS p ON p.id = rp.permission_id
                        WHERE u.id = NEW.sender_id
                          AND u.is_active
                          AND u.deleted_at IS NULL
                          AND p.name = 'manage_chat'
                   )
               )
           )
    ) THEN
        RAISE EXCEPTION 'Sender is not a participant in conversation %', NEW.conversation_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chat_messages_validate_sender
BEFORE INSERT OR UPDATE OF conversation_id, sender_id ON chat_messages
FOR EACH ROW EXECUTE FUNCTION fn_validate_chat_sender();

CREATE FUNCTION fn_touch_chat_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE chat_conversations
       SET updated_at = now()
     WHERE id = NEW.conversation_id;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_chat_messages_touch_conversation
AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION fn_touch_chat_conversation();

-- ============================================================================
-- 11. Atomic checkout
-- ============================================================================
-- p_items is a JSON array such as:
--   [{"variant_id":"...","quantity":2},{"variant_id":"...","quantity":1}]
-- Duplicate variant IDs are aggregated. Variants are locked in UUID order to
-- reduce deadlock risk. Any error rolls back stock, order, items, and history.

CREATE FUNCTION place_order(
    p_user_id          UUID,
    p_address_id       UUID,
    p_items            JSONB,
    p_discount_amount NUMERIC(14, 2) DEFAULT 0,
    p_shipping_cost   NUMERIC(14, 2) DEFAULT 0,
    p_tax_amount      NUMERIC(14, 2) DEFAULT 0,
    p_notes           TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_order_id          UUID := gen_random_uuid();
    v_order_number      VARCHAR(30);
    v_address           user_addresses%ROWTYPE;
    v_item              RECORD;
    v_variant           RECORD;
    v_variant_label     TEXT;
    v_image_url         TEXT;
    v_subtotal          NUMERIC(14, 2) := 0;
    v_currency_code     VARCHAR(3) := NULL;
    v_rows_updated      INTEGER;
BEGIN
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'p_items must be a non-empty JSON array';
    END IF;

    IF p_discount_amount < 0 OR p_shipping_cost < 0 OR p_tax_amount < 0 THEN
        RAISE EXCEPTION 'Discount, shipping, and tax amounts cannot be negative';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM users
         WHERE id = p_user_id
           AND is_active
           AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'User is not active';
    END IF;

    SELECT *
      INTO v_address
      FROM user_addresses
     WHERE id = p_address_id
       AND user_id = p_user_id
       AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shipping address does not belong to the active user';
    END IF;

    v_order_number := 'ORD-'
        || to_char(clock_timestamp(), 'YYYYMMDD')
        || '-'
        || upper(substr(replace(v_order_id::TEXT, '-', ''), 1, 12));

    -- Insert the header first. It remains invisible outside this transaction and
    -- is rolled back if any subsequent validation or stock deduction fails.
    INSERT INTO orders (
        id,
        user_id,
        order_number,
        status,
        subtotal,
        discount_amount,
        shipping_cost,
        tax_amount,
        currency_code,
        shipping_recipient_name,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_city,
        shipping_state,
        shipping_postal_code,
        shipping_country_code,
        shipping_phone,
        notes
    )
    VALUES (
        v_order_id,
        p_user_id,
        v_order_number,
        'pending',
        0,
        0,
        p_shipping_cost,
        p_tax_amount,
        'USD',
        v_address.recipient_name,
        v_address.address_line_1,
        v_address.address_line_2,
        v_address.city,
        v_address.state,
        v_address.postal_code,
        v_address.country_code,
        v_address.phone,
        p_notes
    );

    FOR v_item IN
        SELECT
            (item ->> 'variant_id')::UUID AS variant_id,
            sum((item ->> 'quantity')::BIGINT) AS quantity
        FROM jsonb_array_elements(p_items) AS item
        GROUP BY (item ->> 'variant_id')::UUID
        ORDER BY (item ->> 'variant_id')::UUID
    LOOP
        IF v_item.quantity <= 0 OR v_item.quantity > 2147483647 THEN
            RAISE EXCEPTION 'Invalid quantity for variant %', v_item.variant_id;
        END IF;

        SELECT
            v.id AS variant_id,
            v.product_id,
            v.sku,
            v.effective_price,
            v.stock_quantity,
            p.title AS product_title,
            p.currency_code
        INTO v_variant
        FROM product_variants AS v
        JOIN products AS p ON p.id = v.product_id
        JOIN categories AS c ON c.id = p.category_id
        WHERE v.id = v_item.variant_id
          AND v.deleted_at IS NULL
          AND p.is_active
          AND p.deleted_at IS NULL
          AND c.deleted_at IS NULL
        FOR UPDATE OF v;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Variant % is unavailable', v_item.variant_id;
        END IF;

        IF v_currency_code IS NULL THEN
            v_currency_code := v_variant.currency_code;
            UPDATE orders
               SET currency_code = v_currency_code
             WHERE id = v_order_id;
        ELSIF v_currency_code <> v_variant.currency_code THEN
            RAISE EXCEPTION 'One order cannot contain multiple currencies';
        END IF;

        UPDATE product_variants
           SET stock_quantity = stock_quantity - v_item.quantity::INTEGER
         WHERE id = v_item.variant_id
           AND stock_quantity >= v_item.quantity::INTEGER;

        GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
        IF v_rows_updated <> 1 THEN
            RAISE EXCEPTION 'Insufficient stock for variant %', v_item.variant_id;
        END IF;

        SELECT string_agg(
                   at.name::TEXT || ': ' || av.value::TEXT,
                   ', '
                   ORDER BY pat.sort_order, at.name::TEXT
               )
          INTO v_variant_label
          FROM variant_attribute_values AS vav
          JOIN attribute_types AS at ON at.id = vav.attribute_type_id
          JOIN attribute_values AS av ON av.id = vav.attribute_value_id
          JOIN product_attribute_types AS pat
            ON pat.product_id = vav.product_id
           AND pat.attribute_type_id = vav.attribute_type_id
         WHERE vav.variant_id = v_item.variant_id;

        SELECT pi.image_url
          INTO v_image_url
          FROM product_images AS pi
         WHERE pi.product_id = v_variant.product_id
           AND (pi.variant_id = v_item.variant_id OR pi.variant_id IS NULL)
         ORDER BY
             (pi.variant_id = v_item.variant_id) DESC,
             pi.sort_order,
             pi.id
         LIMIT 1;

        INSERT INTO order_items (
            order_id,
            product_id,
            variant_id,
            product_title,
            variant_label,
            sku,
            image_url,
            unit_price,
            quantity
        )
        VALUES (
            v_order_id,
            v_variant.product_id,
            v_item.variant_id,
            v_variant.product_title,
            v_variant_label,
            v_variant.sku::TEXT,
            v_image_url,
            v_variant.effective_price,
            v_item.quantity::INTEGER
        );

        v_subtotal := v_subtotal
            + (v_variant.effective_price * v_item.quantity::INTEGER);
    END LOOP;

    IF p_discount_amount > v_subtotal THEN
        RAISE EXCEPTION 'Discount cannot exceed the order subtotal';
    END IF;

    UPDATE orders
       SET subtotal = v_subtotal,
           discount_amount = p_discount_amount
     WHERE id = v_order_id;

    RETURN v_order_id;
END;
$$;

COMMENT ON FUNCTION place_order(UUID, UUID, JSONB, NUMERIC, NUMERIC, NUMERIC, TEXT)
IS 'Atomically validates and locks variants, deducts stock, snapshots prices/address, and creates an order.';

-- PostgreSQL grants function execution to PUBLIC by default. Deployment should
-- grant this explicitly to the trusted checkout application role.
REVOKE ALL ON FUNCTION place_order(UUID, UUID, JSONB, NUMERIC, NUMERIC, NUMERIC, TEXT)
FROM PUBLIC;

-- ============================================================================
-- 12. Seed RBAC data (idempotent)
-- ============================================================================

INSERT INTO roles(name, description) VALUES
    ('admin', 'Full platform administrator'),
    ('customer', 'Regular customer'),
    ('support_agent', 'Customer support agent')
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description;

INSERT INTO permissions(name, description) VALUES
    ('manage_products', 'Create, edit, and soft-delete products'),
    ('manage_categories', 'Create, edit, and soft-delete categories'),
    ('manage_orders', 'View and update all orders'),
    ('manage_users', 'View and manage user accounts'),
    ('view_orders', 'View own orders'),
    ('manage_chat', 'Access and respond to support chats'),
    ('view_analytics', 'Access admin dashboard analytics')
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
CROSS JOIN permissions AS p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.name = 'view_orders'
WHERE r.name = 'customer'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.name IN ('manage_chat', 'manage_orders')
WHERE r.name = 'support_agent'
ON CONFLICT DO NOTHING;

COMMIT;
