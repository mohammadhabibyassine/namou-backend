# Namou E-commerce Project — Technology Handoff

Hi,

I noticed that React was mentioned earlier and that the frontend technology
was left open. For an e-commerce project, I would choose Next.js rather than a
plain client-side React application because SEO is especially important for
product and category pages. Next.js gives us server rendering, better metadata
support, fast routing, and a good foundation for performance and discoverability.

Next.js also fits naturally with a Node/Express environment. Using it as the
web layer would keep the storefront and server-rendered concerns together in
one organized codebase instead of maintaining a separate rendering service.

During my interview with Sara at Namou, we discussed which technologies would
be the best fit for both the frontend and backend. That conversation helped me
think through the trade-offs and choose tools that keep the project clear,
maintainable, and ready to grow without adding complexity just for the sake of
it.

## Backend choices

For the backend, I used NestJS instead of building a bare Express or FastAPI
service. NestJS uses Express by default, so it keeps the familiar Node.js
ecosystem, but gives the project a stronger structure through modules,
controllers, injectable services, dependency injection, guards, pipes, and
consistent testing boundaries. This makes the code easier for another
developer to understand and extend.

NestJS also provides integrations for features that would otherwise need to be
assembled manually in a plain Node application, including BullMQ, WebSockets,
configuration, authentication, and Swagger/OpenAPI. The Swagger documentation
is especially useful because developers can inspect the API contract and test
endpoints directly while working on the project.

PostgreSQL is used as the main database because it is a strong fit for an
e-commerce system. It gives us reliable transactions, relationships,
constraints, proper money types, and indexing. The checkout and inventory
logic was designed around those guarantees rather than relying only on the
application layer.

The project also includes role-based access control with roles and permissions
stored and enforced on the backend. The current frontend administration area
is intentionally small, so I did not spend the available time building a full
enterprise permission-management interface while working part-time. If I
continued this work, I would add multiple-role assignment, more granular
permissions, and frontend navigation that shows or hides features depending on
the signed-in user's permissions, while keeping backend authorization as the
final security boundary.

Redis is used for caching, rate-limit coordination, and background-job support.
Even when the frontend has its own cache, backend caching is still valuable
because it reduces database work and lowers the cost of serving repeated
requests.

BullMQ is currently used for order-confirmation processing. In a production
version, I would also move email delivery, image processing, search indexing,
notifications, and other slow or retryable work into the queue so those tasks
do not block customer requests.

For customer support, I added a simple chat system using Socket.IO over
WebSockets. Socket.IO is not selected because it is the fastest WebSocket
library—uWebSockets.js can be faster in raw benchmarks—but because it is
reliable, well supported, and provides reconnection, rooms, and a straightforward
client/server integration.

Prisma is used as the ORM. I preferred it over Sequelize or TypeORM because it
provides a strongly typed generated client and a clean transaction API. That
makes queries safer to refactor and keeps the database model close to the
TypeScript code, while still allowing PostgreSQL-specific SQL where it is the
right tool.

For storage, product images are handled through Cloudflare R2. The admin
browser requests a short-lived presigned URL, uploads the image directly to R2,
and then asks the backend to verify and attach it to the product. This avoids
proxying large files through the API and keeps storage credentials private. The
available free 10 GB allowance is also helpful for controlling costs, especially
when images are resized and compressed properly before delivery.

## Frontend choices

The frontend is built with Next.js and React. TanStack Query handles server
state, caching, mutations, and loading/error states. Zustand handles lightweight
client state such as guest cart and wishlist data. I used Zustand instead of
Redux because this application does not need a large reducer and action
architecture; direct, focused state updates keep the code simpler without
adding unnecessary boilerplate.

React Hook Form and Zod are used for form handling and validation. Axios is used
for typed API calls, Socket.IO Client handles realtime chat, and Tailwind CSS
handles the responsive visual system. The authentication flow keeps persistent
tokens in HttpOnly cookies through the Next.js server layer, and the browser
only receives short-lived data when it needs to establish a realtime
connection.

## Development environment

Docker containers are used locally for PostgreSQL and Redis. This makes setup
faster and keeps the development environment consistent. Redis supports both
the cache and BullMQ, while PostgreSQL remains the source of truth for commerce
data.

The project includes installation and setup documentation in both repositories.
The frontend contains the storefront and admin interface, while the backend
contains the API, database logic, authentication, permissions, queues, chat,
and storage integration.

## What I would add next

If I continued the e-commerce platform toward a production release, I would
integrate a payment provider with idempotency keys and signed webhooks. The
application should not mark an order as paid only because the browser reports
success. It should wait for a verified webhook from the payment provider so it
can safely handle failed payments, duplicate callbacks, abandoned checkouts,
refunds, and customers closing the browser during payment.

I would also refine the visual design, document the interface in Figma, expand
the multi-role administration experience, and add an AI assistant for simple
customer questions, message drafting, and internal support tasks. Any AI
feature that changes orders, payments, or customer data would still need clear
limits and human review.

## Live test environment

I created a live environment so the storefront and admin side can be tested:

<https://namou.mohammadyassine.com/>

The backend includes a development seeder that creates test customer and admin
accounts. It is kept for testing purposes only. In a real production
environment, the seeded administrator account and credentials would not be
exposed, and the development seeder would not be used as the production
bootstrap process.

Best,

Mohammad Yassin
