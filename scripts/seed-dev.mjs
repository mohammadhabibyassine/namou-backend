import 'dotenv/config';
import argon2 from 'argon2';
import pg from 'pg';

const { Client } = pg;

const productImagePath = '/images/home-editorial.jpg';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

function toPgUrl(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete('schema');
  parsed.searchParams.delete('connection_limit');
  parsed.searchParams.delete('pool_timeout');
  parsed.searchParams.delete('socket_timeout');
  return parsed.toString();
}

const client = new Client({ connectionString: toPgUrl(databaseUrl) });

async function one(sql, values = []) {
  const result = await client.query(sql, values);
  return result.rows[0];
}

async function upsertUser({ email, firstName, lastName, roleName }) {
  const passwordHash = await argon2.hash('namou-dev-password');
  const row = await one(
    `
      INSERT INTO users (
        email,
        password_hash,
        first_name,
        last_name,
        role_id,
        email_verified_at
      )
      SELECT $1, $2, $3, $4, roles.id, now()
      FROM roles
      WHERE roles.name = $5
      ON CONFLICT (email) DO UPDATE
      SET
        password_hash = EXCLUDED.password_hash,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        role_id = EXCLUDED.role_id,
        is_active = true,
        deleted_at = NULL,
        updated_at = now()
      RETURNING id
    `,
    [email, passwordHash, firstName, lastName, roleName],
  );

  return row.id;
}

async function upsertAddress(userId) {
  await client.query(
    `
      INSERT INTO user_addresses (
        user_id,
        label,
        recipient_name,
        address_line_1,
        city,
        state,
        postal_code,
        country_code,
        phone,
        is_default
      )
      VALUES (
        $1,
        'Studio',
        'Namou Tester',
        '101 Technical Ave',
        'Los Angeles',
        'CA',
        '90015',
        'US',
        '+12125550100',
        true
      )
      ON CONFLICT (user_id) WHERE is_default AND deleted_at IS NULL
      DO UPDATE
      SET
        label = EXCLUDED.label,
        recipient_name = EXCLUDED.recipient_name,
        address_line_1 = EXCLUDED.address_line_1,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        postal_code = EXCLUDED.postal_code,
        country_code = EXCLUDED.country_code,
        phone = EXCLUDED.phone,
        updated_at = now()
    `,
    [userId],
  );
}

async function upsertCategory({ name, slug, parentSlug = null, sortOrder }) {
  const row = await one(
    `
      WITH parent AS (
        SELECT id FROM categories WHERE slug = $3
      )
      INSERT INTO categories (name, slug, parent_id, sort_order)
      VALUES ($1, $2, (SELECT id FROM parent), $4)
      ON CONFLICT (slug) DO UPDATE
      SET
        name = EXCLUDED.name,
        parent_id = EXCLUDED.parent_id,
        sort_order = EXCLUDED.sort_order,
        deleted_at = NULL,
        updated_at = now()
      RETURNING id
    `,
    [name, slug, parentSlug, sortOrder],
  );
  return row.id;
}

async function upsertAttributeType({ name, slug, sortOrder }) {
  const row = await one(
    `
      INSERT INTO attribute_types (name, slug, sort_order)
      VALUES ($1, $2, $3)
      ON CONFLICT (slug) DO UPDATE
      SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, updated_at = now()
      RETURNING id
    `,
    [name, slug, sortOrder],
  );
  return row.id;
}

async function upsertAttributeValue({ attributeTypeId, value, sortOrder }) {
  const row = await one(
    `
      INSERT INTO attribute_values (attribute_type_id, value, sort_order)
      VALUES ($1, $2, $3)
      ON CONFLICT (attribute_type_id, value) DO UPDATE
      SET sort_order = EXCLUDED.sort_order, updated_at = now()
      RETURNING id
    `,
    [attributeTypeId, value, sortOrder],
  );
  return row.id;
}

async function upsertProduct(product) {
  const row = await one(
    `
      INSERT INTO products (
        category_id,
        title,
        slug,
        description,
        base_price,
        currency_code,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, 'USD', true)
      ON CONFLICT (slug) DO UPDATE
      SET
        category_id = EXCLUDED.category_id,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        base_price = EXCLUDED.base_price,
        currency_code = EXCLUDED.currency_code,
        is_active = true,
        deleted_at = NULL,
        updated_at = now()
      RETURNING id
    `,
    [
      product.categoryId,
      product.title,
      product.slug,
      product.description,
      product.basePrice,
    ],
  );
  return row.id;
}

async function configureProductAttributes(productId, attributes) {
  for (const [sortOrder, attributeTypeId] of attributes.entries()) {
    await client.query(
      `
        INSERT INTO product_attribute_types (
          product_id,
          attribute_type_id,
          sort_order
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (product_id, attribute_type_id) DO UPDATE
        SET sort_order = EXCLUDED.sort_order, updated_at = now()
      `,
      [productId, attributeTypeId, sortOrder],
    );
  }
}

async function offerProductAttributeValues(productId, options) {
  for (const option of options) {
    await client.query(
      `
        INSERT INTO product_attribute_values (
          product_id,
          attribute_type_id,
          attribute_value_id
        )
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `,
      [productId, option.attributeTypeId, option.attributeValueId],
    );
  }
}

async function upsertVariant(productId, variant) {
  const row = await one(
    `
      INSERT INTO product_variants (
        product_id,
        sku,
        price_override,
        stock_quantity,
        is_default
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (sku) DO UPDATE
      SET
        price_override = EXCLUDED.price_override,
        stock_quantity = EXCLUDED.stock_quantity,
        is_default = EXCLUDED.is_default,
        deleted_at = NULL,
        updated_at = now()
      RETURNING id
    `,
    [
      productId,
      variant.sku,
      variant.priceOverride ?? null,
      variant.stockQuantity,
      variant.isDefault,
    ],
  );

  await client.query(
    'DELETE FROM variant_attribute_values WHERE variant_id = $1',
    [row.id],
  );

  for (const option of variant.options) {
    await client.query(
      `
        INSERT INTO variant_attribute_values (
          variant_id,
          product_id,
          attribute_type_id,
          attribute_value_id
        )
        VALUES ($1, $2, $3, $4)
      `,
      [row.id, productId, option.attributeTypeId, option.attributeValueId],
    );
  }

  return row.id;
}

async function upsertProductImage({
  productId,
  variantId = null,
  sortOrder,
  altText,
}) {
  const updated = await client.query(
    `
      UPDATE product_images
      SET
        variant_id = $2,
        image_url = $3,
        alt_text = $4,
        updated_at = now()
      WHERE product_id = $1
        AND sort_order = $5
    `,
    [productId, variantId, productImagePath, altText, sortOrder],
  );

  if (updated.rowCount > 0) return;

  await client.query(
    `
      INSERT INTO product_images (
        product_id,
        variant_id,
        image_url,
        alt_text,
        sort_order
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [productId, variantId, productImagePath, altText, sortOrder],
  );
}

await client.connect();

try {
  await client.query('BEGIN');

  const adminId = await upsertUser({
    email: 'admin@namou.test',
    firstName: 'Namou',
    lastName: 'Admin',
    roleName: 'admin',
  });
  const customerId = await upsertUser({
    email: 'customer@namou.test',
    firstName: 'Namou',
    lastName: 'Customer',
    roleName: 'customer',
  });
  await upsertUser({
    email: 'support@namou.test',
    firstName: 'Namou',
    lastName: 'Support',
    roleName: 'support_agent',
  });
  await upsertAddress(customerId);

  const categoryIds = {
    shop: await upsertCategory({ name: 'Shop', slug: 'shop', sortOrder: 0 }),
    outerwear: await upsertCategory({
      name: 'Outerwear',
      slug: 'outerwear',
      parentSlug: 'shop',
      sortOrder: 10,
    }),
    footwear: await upsertCategory({
      name: 'Footwear',
      slug: 'footwear',
      parentSlug: 'shop',
      sortOrder: 20,
    }),
    carry: await upsertCategory({
      name: 'Carry',
      slug: 'carry',
      parentSlug: 'shop',
      sortOrder: 30,
    }),
    objects: await upsertCategory({
      name: 'Objects',
      slug: 'objects',
      parentSlug: 'shop',
      sortOrder: 40,
    }),
  };

  const colorTypeId = await upsertAttributeType({
    name: 'Color',
    slug: 'color',
    sortOrder: 0,
  });
  const sizeTypeId = await upsertAttributeType({
    name: 'Size',
    slug: 'size',
    sortOrder: 1,
  });

  const colorIds = {
    black: await upsertAttributeValue({
      attributeTypeId: colorTypeId,
      value: 'Black',
      sortOrder: 0,
    }),
    graphite: await upsertAttributeValue({
      attributeTypeId: colorTypeId,
      value: 'Graphite',
      sortOrder: 1,
    }),
    olive: await upsertAttributeValue({
      attributeTypeId: colorTypeId,
      value: 'Olive',
      sortOrder: 2,
    }),
  };
  const sizeIds = {
    s: await upsertAttributeValue({
      attributeTypeId: sizeTypeId,
      value: 'S',
      sortOrder: 0,
    }),
    m: await upsertAttributeValue({
      attributeTypeId: sizeTypeId,
      value: 'M',
      sortOrder: 1,
    }),
    l: await upsertAttributeValue({
      attributeTypeId: sizeTypeId,
      value: 'L',
      sortOrder: 2,
    }),
    os: await upsertAttributeValue({
      attributeTypeId: sizeTypeId,
      value: 'OS',
      sortOrder: 3,
    }),
  };

  const products = [
    {
      title: 'Technical Jacket',
      slug: 'technical-jacket',
      description:
        'A quiet weather shell with modular pocket geometry, articulated sleeves, and a clean city profile.',
      basePrice: '420.00',
      categoryId: categoryIds.outerwear,
      sizes: [sizeIds.s, sizeIds.m, sizeIds.l],
      colors: [colorIds.black, colorIds.olive],
      skuPrefix: 'NMU-JK-2401',
      stock: [9, 4, 7, 6, 3, 5],
    },
    {
      title: 'Motion 01',
      slug: 'motion-01',
      description:
        'A monochrome everyday runner tuned for long walks, quick turns, and clean technical styling.',
      basePrice: '220.00',
      categoryId: categoryIds.footwear,
      sizes: [sizeIds.s, sizeIds.m, sizeIds.l],
      colors: [colorIds.black, colorIds.graphite],
      skuPrefix: 'NMU-FT-0101',
      stock: [12, 8, 6, 9, 2, 7],
    },
    {
      title: 'Modular Bag',
      slug: 'modular-bag',
      description:
        'Compact carry with layered compartments, a structured strap, and enough organization for daily movement.',
      basePrice: '280.00',
      categoryId: categoryIds.carry,
      sizes: [sizeIds.os],
      colors: [colorIds.black, colorIds.graphite, colorIds.olive],
      skuPrefix: 'NMU-BG-0202',
      stock: [10, 5, 3],
    },
    {
      title: 'Wearable Object',
      slug: 'wearable-object',
      description:
        'A small utility accessory with a sculptural buckle form and a discreet hardware-inspired finish.',
      basePrice: '160.00',
      categoryId: categoryIds.objects,
      sizes: [sizeIds.os],
      colors: [colorIds.black, colorIds.graphite],
      skuPrefix: 'NMU-AC-0003',
      stock: [14, 4],
    },
  ];

  for (const product of products) {
    const productId = await upsertProduct(product);
    await configureProductAttributes(productId, [colorTypeId, sizeTypeId]);

    const offeredOptions = [
      ...product.colors.map((attributeValueId) => ({
        attributeTypeId: colorTypeId,
        attributeValueId,
      })),
      ...product.sizes.map((attributeValueId) => ({
        attributeTypeId: sizeTypeId,
        attributeValueId,
      })),
    ];
    await offerProductAttributeValues(productId, offeredOptions);

    let index = 0;
    await upsertProductImage({
      productId,
      sortOrder: 0,
      altText: product.title,
    });

    for (const colorId of product.colors) {
      for (const sizeId of product.sizes) {
        const variantId = await upsertVariant(productId, {
          sku: `${product.skuPrefix}-${index + 1}`,
          stockQuantity: product.stock[index] ?? 6,
          isDefault: index === 0,
          options: [
            { attributeTypeId: colorTypeId, attributeValueId: colorId },
            { attributeTypeId: sizeTypeId, attributeValueId: sizeId },
          ],
        });

        await upsertProductImage({
          productId,
          variantId,
          sortOrder: index + 1,
          altText: `${product.title} variant ${index + 1}`,
        });
        index += 1;
      }
    }
  }

  await client.query('COMMIT');
  console.log('Seeded Namou dev data.');
  console.log('Admin login: admin@namou.test / namou-dev-password');
  console.log('Customer login: customer@namou.test / namou-dev-password');
  console.log(`Admin user id: ${adminId}`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
