# Namou Kinetic Modular UI

The selected Namou visual direction, expanded into backend-aligned storefront,
account, order, administration, state, and responsive mockups.

## Storefront

- `00-home.png` — selected homepage direction
- `01-product-catalog.png` — public catalog, search, facets, sorting, and cursor-based load more
- `02-product-detail.png` — variant selection, variant imagery, low stock, cart, and wishlist
- `03-cart.png` — authenticated cart, quantity controls, variant changes, totals, and checkout
- `04-wishlist.png` — product- and variant-level saved items
- `05-authentication.png` — login and registration
- `06-account-addresses.png` — profile and saved-address management
- `07-checkout.png` — saved-address selection, notes, review, and order placement
- `08-order-confirmation.png` — pending-order confirmation
- `09-order-history.png` — status filtering and cursor-based load more
- `10-order-detail.png` — immutable item/address snapshots and status history

## Administration

- `11-admin-orders.png` — order filtering, detail, status transitions, and cancellation
- `12-admin-product-variants.png` — product metadata, attributes, variants, stock, and image URLs
- `13-admin-categories.png` — recursive category tree management
- `14-admin-attributes.png` — reusable attribute types and values

## Supporting states

- `15-empty-error-states.png` — empty cart, empty wishlist, 404, and network error
- `16-mobile-core-flow.png` — responsive catalog, product, cart, and checkout concepts

## Backend boundaries reflected in the mockups

- No card-payment or payment-success interface
- No reviews, discounts, coupon form, delivery estimate, or unsupported shipping claims
- Products, wishlist, and orders use load-more/cursor patterns rather than numbered pagination
- Checkout uses only a saved address and optional order notes
- Customer orders do not expose cancellation controls
- Admin order transitions follow the server's allowed status sequence
- Admin navigation includes only currently implemented product, category, attribute, and order areas
- Live chat and analytics are omitted because their application endpoints are not implemented
