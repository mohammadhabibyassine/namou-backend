import 'dotenv/config';
import argon2 from 'argon2';
import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required in environment');
  process.exit(1);
}

const nodeEnvironment = process.env.NODE_ENV ?? 'development';
const allowDestructiveSeed = process.env.ALLOW_DESTRUCTIVE_SEED === 'true';
const database = new URL(databaseUrl);
const databaseName = database.pathname.replace(/^\//, '');
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

if (nodeEnvironment === 'production') {
  throw new Error('The development seed cannot run in production');
}
if (!allowDestructiveSeed) {
  throw new Error(
    'Refusing destructive seed. Set ALLOW_DESTRUCTIVE_SEED=true explicitly',
  );
}
if (!localHosts.has(database.hostname) || !/^namou(?:[-_](?:dev|test))?$/.test(databaseName)) {
  throw new Error(
    'Refusing destructive seed unless DATABASE_URL points to a local namou database',
  );
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

async function purgeDatabase() {
  await client.query(`
    TRUNCATE TABLE
      order_status_history,
      order_items,
      orders,
      cart_items,
      wishlist_items,
      chat_messages,
      chat_conversations,
      refresh_tokens,
      user_addresses,
      product_images,
      variant_attribute_values,
      product_variants,
      product_attribute_values,
      product_attribute_types,
      attribute_values,
      attribute_types,
      products,
      categories,
      users
    CASCADE;
  `);
}

async function upsertUser({ email, firstName, lastName, roleName, phone = null }) {
  const passwordHash = await argon2.hash('namou-dev-password');
  const row = await one(
    `
      INSERT INTO users (
        email,
        password_hash,
        first_name,
        last_name,
        phone,
        role_id,
        email_verified_at,
        is_active
      )
      SELECT $1, $2, $3, $4, $5, roles.id, now(), true
      FROM roles
      WHERE roles.name = $6
      ON CONFLICT (email) DO UPDATE
      SET
        password_hash = EXCLUDED.password_hash,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        phone = EXCLUDED.phone,
        role_id = EXCLUDED.role_id,
        is_active = true,
        deleted_at = NULL,
        updated_at = now()
      RETURNING id
    `,
    [email, passwordHash, firstName, lastName, phone, roleName],
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
        address_line_2,
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
        'Elena Vance',
        '452 Articulated Way',
        'Suite 4B',
        'San Francisco',
        'CA',
        '94103',
        'US',
        '+14155550198',
        true
      )
      ON CONFLICT (user_id) WHERE is_default AND deleted_at IS NULL
      DO UPDATE
      SET
        label = EXCLUDED.label,
        recipient_name = EXCLUDED.recipient_name,
        address_line_1 = EXCLUDED.address_line_1,
        address_line_2 = EXCLUDED.address_line_2,
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

async function upsertCategory({ name, slug, parentSlug = null, description = null, sortOrder }) {
  const row = await one(
    `
      WITH parent AS (
        SELECT id FROM categories WHERE slug = $3
      )
      INSERT INTO categories (name, slug, parent_id, description, sort_order)
      VALUES ($1, $2, (SELECT id FROM parent), $4, $5)
      ON CONFLICT (slug) DO UPDATE
      SET
        name = EXCLUDED.name,
        parent_id = EXCLUDED.parent_id,
        description = EXCLUDED.description,
        sort_order = EXCLUDED.sort_order,
        deleted_at = NULL,
        updated_at = now()
      RETURNING id
    `,
    [name, slug, parentSlug, description, sortOrder],
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
  imageUrl,
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
    [productId, variantId, imageUrl, altText, sortOrder],
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
    [productId, variantId, imageUrl, altText, sortOrder],
  );
}

async function createSampleOrders(customerId, sampleVariants) {
  if (sampleVariants.length < 3) return;

  const order1Row = await one(
    `
      INSERT INTO orders (
        user_id, order_number, status, subtotal, discount_amount, shipping_cost, tax_amount,
        currency_code, shipping_recipient_name, shipping_address_line_1, shipping_city,
        shipping_state, shipping_postal_code, shipping_country_code, shipping_phone,
        notes, created_at, updated_at
      )
      VALUES (
        $1, 'ORD-20260827-0104', 'delivered', $2, 0, 15.00, $3,
        'USD', 'Elena Vance', '452 Articulated Way, Apt 4B', 'San Francisco',
        'CA', '94103', 'US', '+14155550198',
        'Deliver to parcel locker in lobby.', now() - interval '10 days', now() - interval '8 days'
      )
      RETURNING id
    `,
    [
      customerId,
      sampleVariants[0].effectivePrice,
      (Number(sampleVariants[0].effectivePrice) * 0.085).toFixed(2),
    ],
  );

  await client.query(
    `
      INSERT INTO order_items (
        order_id, product_id, variant_id, product_title, variant_label, sku,
        image_url, unit_price, quantity
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
    `,
    [
      order1Row.id,
      sampleVariants[0].productId,
      sampleVariants[0].id,
      sampleVariants[0].productTitle,
      sampleVariants[0].label,
      sampleVariants[0].sku,
      sampleVariants[0].imageUrl,
      sampleVariants[0].effectivePrice,
    ],
  );

  const order2Subtotal = (
    Number(sampleVariants[1].effectivePrice) + Number(sampleVariants[2].effectivePrice)
  ).toFixed(2);
  const order2Tax = (Number(order2Subtotal) * 0.085).toFixed(2);

  const order2Row = await one(
    `
      INSERT INTO orders (
        user_id, order_number, status, subtotal, discount_amount, shipping_cost, tax_amount,
        currency_code, shipping_recipient_name, shipping_address_line_1, shipping_city,
        shipping_state, shipping_postal_code, shipping_country_code, shipping_phone,
        notes, created_at, updated_at
      )
      VALUES (
        $1, 'ORD-20260904-0288', 'shipped', $2, 0, 0.00, $3,
        'USD', 'Elena Vance', '452 Articulated Way, Apt 4B', 'San Francisco',
        'CA', '94103', 'US', '+14155550198',
        'Direct signature required.', now() - interval '2 days', now() - interval '1 day'
      )
      RETURNING id
    `,
    [customerId, order2Subtotal, order2Tax],
  );

  await client.query(
    `
      INSERT INTO order_items (
        order_id, product_id, variant_id, product_title, variant_label, sku,
        image_url, unit_price, quantity
      )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, 1),
        ($1, $9, $10, $11, $12, $13, $14, $15, 1)
    `,
    [
      order2Row.id,
      sampleVariants[1].productId,
      sampleVariants[1].id,
      sampleVariants[1].productTitle,
      sampleVariants[1].label,
      sampleVariants[1].sku,
      sampleVariants[1].imageUrl,
      sampleVariants[1].effectivePrice,
      sampleVariants[2].productId,
      sampleVariants[2].id,
      sampleVariants[2].productTitle,
      sampleVariants[2].label,
      sampleVariants[2].sku,
      sampleVariants[2].imageUrl,
      sampleVariants[2].effectivePrice,
    ],
  );
}

await client.connect();

try {
  console.log('=== NAMOU DEV SEED STARTED ===');
  await client.query('BEGIN');

  // Purge all previous records to ensure a fresh, clean state
  console.log('Clearing old catalog and transactional data...');
  await purgeDatabase();

  // 1. Users
  console.log('Creating users...');
  const adminId = await upsertUser({
    email: 'admin@namou.test',
    firstName: 'Namou',
    lastName: 'Admin',
    roleName: 'admin',
  });
  const customerId = await upsertUser({
    email: 'customer@namou.test',
    firstName: 'Elena',
    lastName: 'Vance',
    roleName: 'customer',
    phone: '+14155550198',
  });
  await upsertUser({
    email: 'support@namou.test',
    firstName: 'Kai',
    lastName: 'Ren',
    roleName: 'support_agent',
  });
  await upsertAddress(customerId);

  // 2. Categories
  console.log('Creating categories...');
  const categoryIds = {
    shop: await upsertCategory({ name: 'Shop', slug: 'shop', sortOrder: 0 }),
    outerwear: await upsertCategory({
      name: 'Outerwear',
      slug: 'outerwear',
      parentSlug: 'shop',
      description: 'Technical weather protection, modular shells, and active insulation.',
      sortOrder: 10,
    }),
    technicalShells: await upsertCategory({
      name: 'Technical Shells',
      slug: 'technical-shells',
      parentSlug: 'outerwear',
      description: '3-layer waterproof breathable membranes with storm-grade articulation.',
      sortOrder: 11,
    }),
    insulatedParkas: await upsertCategory({
      name: 'Insulated Parkas',
      slug: 'insulated-parkas',
      parentSlug: 'outerwear',
      description: 'Sub-zero thermal defense with internal carry harness straps.',
      sortOrder: 12,
    }),
    modularVests: await upsertCategory({
      name: 'Modular Vests',
      slug: 'modular-vests',
      parentSlug: 'outerwear',
      description: 'Tactical load-bearing midlayers with magnetic hardware.',
      sortOrder: 13,
    }),
    apparel: await upsertCategory({
      name: 'Apparel',
      slug: 'apparel',
      parentSlug: 'shop',
      description: 'Precision engineered knitwear, 4-way stretch trousers, and base layers.',
      sortOrder: 20,
    }),
    engineeredKnitwear: await upsertCategory({
      name: 'Engineered Knitwear',
      slug: 'engineered-knitwear',
      parentSlug: 'apparel',
      description: 'High-density merino wool and core-spun technical fibers.',
      sortOrder: 21,
    }),
    articulatedTrousers: await upsertCategory({
      name: 'Articulated Trousers',
      slug: 'articulated-trousers',
      parentSlug: 'apparel',
      description: 'Schoeller Dryskin pants with volumetric cargo architecture.',
      sortOrder: 22,
    }),
    baseTops: await upsertCategory({
      name: 'Base Tops',
      slug: 'base-tops',
      parentSlug: 'apparel',
      description: 'Seamless ergonomic tops with active moisture evacuation.',
      sortOrder: 23,
    }),
    footwear: await upsertCategory({
      name: 'Footwear',
      slug: 'footwear',
      parentSlug: 'shop',
      description: 'All-terrain kinetic runners, tactical boots, and recovery slides.',
      sortOrder: 30,
    }),
    allTerrainRunners: await upsertCategory({
      name: 'All-Terrain Runners',
      slug: 'all-terrain-runners',
      parentSlug: 'footwear',
      description: 'Vibram Megagrip traction with Dyneema composite uppers.',
      sortOrder: 31,
    }),
    tacticalBoots: await upsertCategory({
      name: 'Tactical Boots',
      slug: 'tactical-boots',
      parentSlug: 'footwear',
      description: 'Ballistic Cordura and nubuck construction with side-zip entry.',
      sortOrder: 32,
    }),
    technicalSlides: await upsertCategory({
      name: 'Technical Slides',
      slug: 'technical-slides',
      parentSlug: 'footwear',
      description: 'Bio-density sculpted EVA recovery footwear.',
      sortOrder: 33,
    }),
    carry: await upsertCategory({
      name: 'Carry',
      slug: 'carry',
      parentSlug: 'shop',
      description: 'Weatherproof X-Pac packs, ambidextrous slings, and modular pouches.',
      sortOrder: 40,
    }),
    modularPacks: await upsertCategory({
      name: 'Modular Packs',
      slug: 'modular-packs',
      parentSlug: 'carry',
      description: 'Expandable rolltop backpacks with dedicated tech containment.',
      sortOrder: 41,
    }),
    crossbodySlings: await upsertCategory({
      name: 'Crossbody Slings',
      slug: 'crossbody-slings',
      parentSlug: 'carry',
      description: 'Rapid-deployment slings with quick-release cinch straps.',
      sortOrder: 42,
    }),
    utilityPouches: await upsertCategory({
      name: 'Utility Pouches',
      slug: 'utility-pouches',
      parentSlug: 'carry',
      description: 'Origami internal organization for cables, tools, and daily hardware.',
      sortOrder: 43,
    }),
    objects: await upsertCategory({
      name: 'Objects',
      slug: 'objects',
      parentSlug: 'shop',
      description: 'Grade 5 titanium tools, magnetic mil-spec belts, and kinetic accessories.',
      sortOrder: 50,
    }),
    technicalHardware: await upsertCategory({
      name: 'Technical Hardware',
      slug: 'technical-hardware',
      parentSlug: 'objects',
      description: 'CNC milled aerospace titanium EDC instruments.',
      sortOrder: 51,
    }),
    utilityBelts: await upsertCategory({
      name: 'Utility Belts',
      slug: 'utility-belts',
      parentSlug: 'objects',
      description: 'Fidlock V-buckle magnetic tensioning belts.',
      sortOrder: 52,
    }),
  };

  // 3. Attribute Types & Values
  console.log('Creating attributes...');
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

  const colors = {
    black: {
      id: await upsertAttributeValue({ attributeTypeId: colorTypeId, value: 'Onyx Black', sortOrder: 0 }),
      name: 'Onyx Black',
    },
    slate: {
      id: await upsertAttributeValue({ attributeTypeId: colorTypeId, value: 'Graphite Slate', sortOrder: 1 }),
      name: 'Graphite Slate',
    },
    olive: {
      id: await upsertAttributeValue({ attributeTypeId: colorTypeId, value: 'Deep Olive', sortOrder: 2 }),
      name: 'Deep Olive',
    },
    bone: {
      id: await upsertAttributeValue({ attributeTypeId: colorTypeId, value: 'Bone White', sortOrder: 3 }),
      name: 'Bone White',
    },
    clay: {
      id: await upsertAttributeValue({ attributeTypeId: colorTypeId, value: 'Desert Clay', sortOrder: 4 }),
      name: 'Desert Clay',
    },
  };

  const sizes = {
    s: { id: await upsertAttributeValue({ attributeTypeId: sizeTypeId, value: 'S', sortOrder: 0 }), name: 'S' },
    m: { id: await upsertAttributeValue({ attributeTypeId: sizeTypeId, value: 'M', sortOrder: 1 }), name: 'M' },
    l: { id: await upsertAttributeValue({ attributeTypeId: sizeTypeId, value: 'L', sortOrder: 2 }), name: 'L' },
    xl: { id: await upsertAttributeValue({ attributeTypeId: sizeTypeId, value: 'XL', sortOrder: 3 }), name: 'XL' },
    us85: { id: await upsertAttributeValue({ attributeTypeId: sizeTypeId, value: 'US 8.5', sortOrder: 4 }), name: 'US 8.5' },
    us95: { id: await upsertAttributeValue({ attributeTypeId: sizeTypeId, value: 'US 9.5', sortOrder: 5 }), name: 'US 9.5' },
    us105: { id: await upsertAttributeValue({ attributeTypeId: sizeTypeId, value: 'US 10.5', sortOrder: 6 }), name: 'US 10.5' },
    us115: { id: await upsertAttributeValue({ attributeTypeId: sizeTypeId, value: 'US 11.5', sortOrder: 7 }), name: 'US 11.5' },
    os: { id: await upsertAttributeValue({ attributeTypeId: sizeTypeId, value: 'OS', sortOrder: 8 }), name: 'OS' },
  };

  // 4. Products, Variants & URL Images
  console.log('Seeding products and variants...');
  const products = [
    {
      title: 'Acro-Shell 01 Storm Jacket',
      slug: 'acro-shell-01-storm-jacket',
      description:
        'Constructed from 3-layer Gore-Tex Pro with micro-taped seams, articulated sleeve patternmaking, dual chest utility pods, and weather-sealed YKK Aquaguard zippers. Engineered for heavy downpours and high-mobility urban transits.',
      basePrice: '540.00',
      categoryId: categoryIds.technicalShells,
      colors: [colors.black, colors.olive],
      sizes: [sizes.s, sizes.m, sizes.l, sizes.xl],
      skuPrefix: 'NMU-SH-01',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/3407239a-0fc9-4263-8483-6d8d1b9e6dd2/3010837a-af5e-4845-a092-e3a57498a55d.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/3407239a-0fc9-4263-8483-6d8d1b9e6dd2/460ca63d-037d-4bd5-a7f9-b90236432eab.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/3407239a-0fc9-4263-8483-6d8d1b9e6dd2/b888391f-149f-4dc8-9297-101ab3b6d70b.webp',
      ],
    },
    {
      title: 'Iso-Grid Insulated Parka',
      slug: 'iso-grid-insulated-parka',
      description:
        'Engineered cold-weather defense featuring Primaloft Gold active insulation encased in a durable water-repellent micro-ripstop shell. Includes internal carry harness straps, magnetic storm flap closures, and fleece-lined handwarmer pockets.',
      basePrice: '680.00',
      categoryId: categoryIds.insulatedParkas,
      colors: [colors.black, colors.slate],
      sizes: [sizes.s, sizes.m, sizes.l, sizes.xl],
      skuPrefix: 'NMU-PK-02',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/53229f47-5a26-42bc-92c8-9e37b76cab83/2f9aed8e-e37d-45fa-9cda-681fd9ed87a7.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/53229f47-5a26-42bc-92c8-9e37b76cab83/9592c6e8-2460-4390-a76c-ed89e15932e0.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/53229f47-5a26-42bc-92c8-9e37b76cab83/367f6d69-8984-4676-b89b-afaee8c74a7b.webp',
      ],
    },
    {
      title: 'Kinetic Modular Vest',
      slug: 'kinetic-modular-vest',
      description:
        'A low-profile modular load-bearing vest crafted from Cordura 500D nylon. Equipped with quick-detach Fidlock V-buckles, modular MOLLE webbing channels, and 6 discrete storage compartments.',
      basePrice: '320.00',
      categoryId: categoryIds.modularVests,
      colors: [colors.black, colors.olive],
      sizes: [sizes.s, sizes.m, sizes.l],
      skuPrefix: 'NMU-VT-03',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/d11e9840-5d2d-44bb-895e-6fcbfeeae506/b2c32321-53d5-4ba0-94d3-8f9fee824969.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/d11e9840-5d2d-44bb-895e-6fcbfeeae506/d1c904de-9793-4ea3-8842-aebaecfbd943.webp',
      ],
    },
    {
      title: 'Articulated Cargo Trouser',
      slug: 'articulated-cargo-trouser',
      description:
        'Precision-tailored trousers utilizing Schoeller Dryskin 4-way stretch fabric with water and oil-resistant Nanosphere treatment. Features ergonomic 3D knee darts, deep volumetric cargo pockets, and adjustable ankle cinch cords.',
      basePrice: '340.00',
      categoryId: categoryIds.articulatedTrousers,
      colors: [colors.black, colors.slate, colors.olive],
      sizes: [sizes.s, sizes.m, sizes.l, sizes.xl],
      skuPrefix: 'NMU-TR-04',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/b95aed6b-903b-4aff-8db6-0145af87ff57/fdb1f785-0094-45f0-9119-87f05fce4928.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/b95aed6b-903b-4aff-8db6-0145af87ff57/98f63701-2041-4964-8193-6a5159761ea2.webp',
      ],
    },
    {
      title: 'Merino Engineered Hoodie',
      slug: 'merino-engineered-hoodie',
      description:
        'Dense 320gsm non-mulesed merino wool knit reinforced with core-spun nylon threads for optimal thermal regulation and abrasion resistance. Designed with an ergonomic snorkel hood, concealed side zip pocket, and elongated cuffs with thumb loops.',
      basePrice: '260.00',
      categoryId: categoryIds.engineeredKnitwear,
      colors: [colors.black, colors.bone],
      sizes: [sizes.s, sizes.m, sizes.l, sizes.xl],
      skuPrefix: 'NMU-HD-05',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/fadfa818-0877-4f2a-b572-860181c9d5b4/e65ba62e-e792-4d89-b053-5fc65d836be7.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/fadfa818-0877-4f2a-b572-860181c9d5b4/491e64d0-f014-4fe2-9b47-6772896c937b.webp',
      ],
    },
    {
      title: 'Tech Ripstop Overshirt',
      slug: 'tech-ripstop-overshirt',
      description:
        'Hybrid overshirt cut from Japanese water-repellent cotton-nylon micro-ripstop. Features concealed matte snaps, gusseted underarm panels for full range of motion, and dual vertical passport-sized chest pockets.',
      basePrice: '220.00',
      categoryId: categoryIds.baseTops,
      colors: [colors.black, colors.olive],
      sizes: [sizes.s, sizes.m, sizes.l, sizes.xl],
      skuPrefix: 'NMU-OS-06',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/b9ac6cc2-be5c-490d-973b-02285f832174/36dedb1a-c745-4c19-9ae1-56fded96eb7b.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/b9ac6cc2-be5c-490d-973b-02285f832174/94783d92-85be-44c3-9e8b-6d2792880057.webp',
      ],
    },
    {
      title: 'Seamless Base Tee',
      slug: 'seamless-base-tee',
      description:
        'Ultra-fine modal and silver-ion infused yarn knitted in an open-mesh body mapping structure. Completely seam-free torso prevents friction, delivering natural odor control and rapid moisture evacuation.',
      basePrice: '110.00',
      categoryId: categoryIds.baseTops,
      colors: [colors.black, colors.bone, colors.slate],
      sizes: [sizes.s, sizes.m, sizes.l, sizes.xl],
      skuPrefix: 'NMU-TE-07',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/bd534fca-358e-463f-ab42-a9b8d0c4aa4c/0eafe9b3-902b-434b-9246-fed9ca3d3de2.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/bd534fca-358e-463f-ab42-a9b8d0c4aa4c/0cc46746-f215-4076-9ed2-593eea8869a2.webp',
      ],
    },
    {
      title: 'Motion 01 Trail Runner',
      slug: 'motion-01-trail-runner',
      description:
        'A fast, lightweight trail runner built with Dyneema composite textile upper and Vibram Megagrip lugged rubber sole. Features Kevlar-reinforced speed lacing and an integrated debris gaiter collar.',
      basePrice: '280.00',
      categoryId: categoryIds.allTerrainRunners,
      colors: [colors.black, colors.slate],
      sizes: [sizes.us85, sizes.us95, sizes.us105, sizes.us115],
      skuPrefix: 'NMU-RN-08',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/5a4cf409-aac9-45a7-b7fb-c894e426fffd/74752458-eaf1-404a-a5f6-9116da5a42b2.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/5a4cf409-aac9-45a7-b7fb-c894e426fffd/1eeb8526-cd08-45c9-9ef2-7d5972c4b642.webp',
      ],
    },
    {
      title: 'Sector Tactical Boot',
      slug: 'sector-tactical-boot',
      description:
        'Mid-cut tactical footwear crafted from water-resistant nubuck leather and ballistic 1000D Cordura. Features an asymmetrical side-entry YKK zipper for rapid ingress, a high-rebound EVA midsole, and deep multidirectional tread.',
      basePrice: '390.00',
      categoryId: categoryIds.tacticalBoots,
      colors: [colors.black, colors.clay],
      sizes: [sizes.us85, sizes.us95, sizes.us105, sizes.us115],
      skuPrefix: 'NMU-BT-09',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/8496f878-7450-4ad2-a5a2-045a1593fc2c/df84c5e1-04da-4882-89da-890ede3c12b6.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/8496f878-7450-4ad2-a5a2-045a1593fc2c/b5a70da2-ff1f-4398-bea3-0c8dd347175e.webp',
      ],
    },
    {
      title: 'Modulo Recovery Slide',
      slug: 'modulo-recovery-slide',
      description:
        'Sculptural post-activity footwear molded from high-density bio-based EVA foam. Features anatomical metatarsal support, deep drainage grooves, and a texturized footbed for enhanced circulation.',
      basePrice: '130.00',
      categoryId: categoryIds.technicalSlides,
      colors: [colors.black, colors.bone],
      sizes: [sizes.us85, sizes.us95, sizes.us105, sizes.us115],
      skuPrefix: 'NMU-SL-10',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/8b66b2f4-b6d2-42cc-a8f0-2b81eeb13547/640962fd-629b-4f45-ae00-733a44ba4e85.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/8b66b2f4-b6d2-42cc-a8f0-2b81eeb13547/8d289f7c-db15-404e-a9fb-72eac67e4d89.webp',
      ],
    },
    {
      title: 'Modular Sling Pack 02',
      slug: 'modular-sling-pack-02',
      description:
        'Constructed from dimensionally stable X-Pac VX21 waterproof sailcloth with taped internal seams. Features a magnetic Fidlock V-buckle, ambidextrous strap with quick-cinch pull, and a padded tablet compartment.',
      basePrice: '260.00',
      categoryId: categoryIds.crossbodySlings,
      colors: [colors.black, colors.olive],
      sizes: [sizes.os],
      skuPrefix: 'NMU-SLG-11',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/e87866e1-66f0-41dc-b128-d95035e0fd9d/e7edd9d0-3493-4215-960c-4b44f08a84a9.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/e87866e1-66f0-41dc-b128-d95035e0fd9d/77d18ea2-c104-4e05-b94c-f49d9096fb1d.webp',
      ],
    },
    {
      title: 'Rolltop Utility Backpack 28L',
      slug: 'rolltop-utility-backpack-28l',
      description:
        'Heavyweight technical pack built from Dyneema composite fabric and 840D ballistic nylon. Offers expandable 24-28L rolltop volume with magnetic closures, side-access suspended 16" laptop sleeve, and ergonomic molded backpanel ventilation.',
      basePrice: '380.00',
      categoryId: categoryIds.modularPacks,
      colors: [colors.black, colors.slate],
      sizes: [sizes.os],
      skuPrefix: 'NMU-BP-12',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/c46263bb-2a01-4937-baa3-be32bf89ce84/c09bd358-0276-47d5-a9a6-32662935d8e3.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/c46263bb-2a01-4937-baa3-be32bf89ce84/00a9cf26-f512-4abe-9fe6-39f062fa2a0c.webp',
      ],
    },
    {
      title: 'Compact Tech Pouch',
      slug: 'compact-tech-pouch',
      description:
        'Weatherproof accessory case engineered with internal origami-style elastic divider webbing for cables, power banks, and small daily essentials. External attachment loops connect to any Namou carry system.',
      basePrice: '95.00',
      categoryId: categoryIds.utilityPouches,
      colors: [colors.black, colors.clay],
      sizes: [sizes.os],
      skuPrefix: 'NMU-PC-13',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/598c3df6-1926-492b-8d1b-4c54d8986e5e/609114b8-9dca-49a4-af58-5a473de09e7c.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/598c3df6-1926-492b-8d1b-4c54d8986e5e/415b8226-1972-4d72-bb78-48f004dd270f.webp',
      ],
    },
    {
      title: 'Fidlock Quick-Release Belt',
      slug: 'fidlock-quick-release-belt',
      description:
        'High-tensile mil-spec nylon webbing belt anchored by a German-engineered magnetic Fidlock V-buckle with CNC machined anodized aluminum pull tab. Offers micro-adjustable tensioning.',
      basePrice: '125.00',
      categoryId: categoryIds.utilityBelts,
      colors: [colors.black, colors.olive],
      sizes: [sizes.os],
      skuPrefix: 'NMU-BL-14',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/583980d9-e8fc-4594-942b-4ae8d4bb8faa/f57f6f39-1f45-4596-84f2-fd098f215b3a.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/583980d9-e8fc-4594-942b-4ae8d4bb8faa/0e9e8e36-a97d-48f2-baad-e551638ecc99.webp',
      ],
    },
    {
      title: 'Titanium Carabiner Clip',
      slug: 'titanium-carabiner-clip',
      description:
        'Precision wire-cut and CNC milled from a solid billet of aerospace Grade 5 titanium. Features a dual-chamber gate mechanism, integrated flathead pry driver, and durable bead-blasted matte finish.',
      basePrice: '85.00',
      categoryId: categoryIds.technicalHardware,
      colors: [colors.slate, colors.bone],
      sizes: [sizes.os],
      skuPrefix: 'NMU-CR-15',
      images: [
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/722f88c0-b1a6-4a27-b570-ff6b96feb245/0f7aa79c-63d0-4a67-932e-ad82e8eb7032.webp',
        'https://pub-a9537da5016c42be9ce7526d620d08fa.r2.dev/products/722f88c0-b1a6-4a27-b570-ff6b96feb245/525d93bb-5d14-4b30-819d-7492d4edce37.webp',
      ],
    },
  ];

  const sampleVariantsForOrders = [];

  for (const [productIndex, product] of products.entries()) {
    const productId = await upsertProduct(product);
    await configureProductAttributes(productId, [colorTypeId, sizeTypeId]);

    const offeredOptions = [
      ...product.colors.map((c) => ({ attributeTypeId: colorTypeId, attributeValueId: c.id })),
      ...product.sizes.map((s) => ({ attributeTypeId: sizeTypeId, attributeValueId: s.id })),
    ];
    await offerProductAttributeValues(productId, offeredOptions);

    // Insert general images
    for (const [imgIdx, imgUrl] of product.images.entries()) {
      await upsertProductImage({
        productId,
        variantId: null,
        imageUrl: imgUrl,
        altText: `${product.title} angle ${imgIdx + 1}`,
        sortOrder: imgIdx,
      });
    }

    // Insert variants
    let variantCounter = 0;
    for (const [colorIndex, color] of product.colors.entries()) {
      for (const [sizeIndex, size] of product.sizes.entries()) {
        const isDefault = colorIndex === 0 && sizeIndex === 0;
        const sku = `${product.skuPrefix}-${color.name.substring(0, 2).toUpperCase()}-${size.name.replace(/[^A-Z0-9]/gi, '')}`;
        const stockQuantity = 4 + ((productIndex * 3 + variantCounter * 5) % 15);

        const variantId = await upsertVariant(productId, {
          sku,
          stockQuantity,
          isDefault,
          options: [
            { attributeTypeId: colorTypeId, attributeValueId: color.id },
            { attributeTypeId: sizeTypeId, attributeValueId: size.id },
          ],
        });

        // Variant image matching colorway
        const matchingImageUrl = product.images[colorIndex % product.images.length];
        const variantSortOrder = product.images.length + variantCounter;
        await upsertProductImage({
          productId,
          variantId,
          imageUrl: matchingImageUrl,
          altText: `${product.title} - ${color.name} / ${size.name}`,
          sortOrder: variantSortOrder,
        });

        if (isDefault && sampleVariantsForOrders.length < 3) {
          sampleVariantsForOrders.push({
            id: variantId,
            productId,
            productTitle: product.title,
            label: `${color.name} / ${size.name}`,
            sku,
            imageUrl: matchingImageUrl,
            effectivePrice: product.basePrice,
          });
        }

        variantCounter += 1;
      }
    }
  }

  // 5. Sample orders for dev customer
  if (sampleVariantsForOrders.length >= 3) {
    await createSampleOrders(customerId, sampleVariantsForOrders);
  }

  await client.query('COMMIT');
  console.log('\n======================================================');
  console.log('✅ NAMOU SEED COMPLETED SUCCESSFULLY');
  console.log('======================================================');
  console.log(`- Categories seeded: 20`);
  console.log(`- Products seeded: ${products.length}`);
  console.log(`- Test Accounts:`);
  console.log(`    Admin:    admin@namou.test    / namou-dev-password (id: ${adminId})`);
  console.log(`    Customer: customer@namou.test / namou-dev-password (id: ${customerId})`);
  console.log(`    Support:  support@namou.test  / namou-dev-password`);
  console.log('======================================================\n');
} catch (error) {
  await client.query('ROLLBACK');
  console.error('\n❌ SEED FAILED. Transaction rolled back.\n', error);
  process.exitCode = 1;
} finally {
  await client.end();
}
