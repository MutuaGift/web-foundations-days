# TicketHub Design Document

TicketHub sells tickets for concerts and events. This document applies the
six-part design framework to it: requirements, estimates, API, data model,
architecture, and trade-offs.

The short version: **TicketHub is easy to run on a normal day and very hard on
sale day.** Almost every interesting decision below comes from that one fact.
200,000 people will compete for 20,000 seats, so 90% of them must be turned away
quickly and fairly, and no two of them may ever end up believing they own the
same seat.

---

## 1. Requirements

### Functional

- **F1** — A visitor can browse and search events by name, artist, venue or date.
- **F2** — A visitor can view an event's details and its **seat map**, showing
  which seats are available, held, and sold.
- **F3** — A user can **hold** one or more available seats for a short time while
  they decide and pay.
- **F4** — A user can pay for held seats, producing a confirmed order.
- **F5** — A user can list their own orders and view their tickets.
- **F6** — A user can cancel an order and be refunded, releasing the seats.
- **F7** — An admin can create events and define their seating layout.

### Non-functional

**Speed**

- **N1** — Event browsing pages under **300 ms** at p95, from any region.
- **N2** — The seat map under **500 ms** at p95, even during a sale. This is the
  hardest latency promise on the site, because the seat map is the page 200,000
  people request at once.
- **N3** — Holding a seat confirmed in under **1 second**. Anything slower and
  users click again, which creates the duplicate-click problem the hold exists to
  prevent.

**Correctness**

- **N4** — **A seat is never sold to two different people.** This is the single
  most important requirement on the site, and it is treated as absolute: one
  database constraint, not application logic (see §4).
- **N5** — Ticket inventory is **exact**. The number of seats reported sold is
  always equal to the number of confirmed orders. No over-selling "provisionally".
- **N6** — **No money is lost or double-charged.** A payment is taken only against
  a hold the server still owns, and any failure voids the authorisation rather
  than leaving an unmatched charge.
- **N7** — A user's order history is private to them; one user can never read or
  cancel another's order.

**Fairness**

- **N8** — Seats go to users in the order they joined the queue, **not** in the
  order their HTTP request happened to reach the server. The first person to
  click is not automatically the first person served (see §5).
- **N9** — One user cannot buy more than **4 seats** for a single event, so a
  single person cannot clear all 20,000.
- **N10** — Every user who cannot get a seat is told so **clearly and quickly**,
  and is offered the next sale or a waitlist. Being turned away must not feel
  like a broken website.

**Availability and security**

- **N11** — The site must survive a sale surge **without going down**, degrading
  in speed before it degrades in function.
- **N12** — A seat is never shown as available to two users at the same moment,
  even if neither has paid yet.

---

## 2. Estimates

### Normal day

```
Page views  = 50,000 visitors x 10 pages          =    500,000 per day
            = 500,000 / 86,400                    =      5.79 per second average
            = 5.79 x 5 (peak factor)              =     28.9 per second at peak

Tickets     = 5,000 per day
            = 5,000 / 86,400                      =    0.058 purchases per second
```

**On a normal day TicketHub does 6 page views per second and sells a ticket every
seventeen seconds.** This is a trivially small workload. One app server and one
database handle it comfortably, and no amount of clever architecture is needed to
survive it.

### Big sale — 200,000 people, 20,000 seats, 10 minutes

```
Sale window      = 10 minutes            = 600 seconds
Attempts         = 200,000 / 600          = 333.3 attempts per second
Requests         = 200,000 x ~4 requests = 1,333 requests per second
                    (view event, load seat map, hold, pay)
Orders needed    = 20,000 / 600           = 33.3 confirmed orders per second
Arrival rate     = 200,000 / 10 minutes   = 3,333 people per minute
```

### The comparison

| | Normal day | Big sale | Change |
| --- | --- | --- | --- |
| Page views/sec | 5.79 | ~1,333 total requests | **230×** |
| Purchase attempts/sec | 0.06 | 333.3 | **~5,800×** |
| Confirmed orders/sec | 0.06 | 33.3 | ~570× |
| People arriving | 0.58/min | 3,333/min | **5,787×** |

Three findings follow, and they drive the whole design:

1. **The sale is a stampede, not a peak.** Normal traffic is trivial; sale
   traffic is 230× normal. A system sized for normal traffic would collapse
   within seconds of the sale opening, which means the sale behaviour has to be
   designed for explicitly rather than treated as an edge case.
2. **The load is almost entirely read.** Even during the sale, the great majority
   of requests are people loading event pages and seat maps. Only 20,000 of
   200,000 buyers will ever write an order. This means **caching and queueing
   carry the surge**, and the database only has to handle 33 writes per second.
3. **It is 10:1 oversubscribed.** 200,000 people want 20,000 seats, so **180,000
   people must be refused** — 90% of everyone who turns up. The system is not
   really selling tickets during a sale; it is **administering a queue for scarce
   seats**, and that is what the architecture is built around.

That last point is the one that is easy to miss. A naive design optimises for
letting people in. The right design optimises for **turning 90% of people away
quickly, politely and fairly**.

---

## 3. API

Base URL `https://api.tickethub.example.com/v1`. All requests are JSON.
Authenticated endpoints require `Authorization: Bearer <token>`.

| # | Method | Path | Description | Success |
| --- | --- | --- | --- | --- |
| 1 | `GET` | `/events` | List and search events, filterable by date and city | `200 OK` |
| 2 | `GET` | `/events/{event_id}` | One event's details | `200 OK` |
| 3 | `GET` | `/events/{event_id}/seats` | Seat map with the state of every seat | `200 OK` |
| 4 | `POST` | `/events/{event_id}/holds` | **Hold** seats for a short window | `201 Created` |
| 5 | `GET` | `/holds/{hold_id}` | A user's own hold and its countdown | `200 OK` |
| 6 | `POST` | `/holds/{hold_id}/confirm` | **Pay** and turn a hold into a confirmed order | `201 Created` |
| 7 | `GET` | `/orders` | The signed-in user's orders | `200 OK` |
| 8 | `GET` | `/orders/{order_id}` | One order, with its tickets | `200 OK` |
| 9 | `DELETE` | `/orders/{order_id}` | Cancel an order and release the seats | `204 No Content` |
| 10 | `GET` | `/queue/status` | The caller's position in the sale queue | `200 OK` |

### Holding seats — `POST /v1/events/{event_id}/holds`

**Request**

```http
POST /v1/events/412/holds HTTP/1.1
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json
```

```json
{
  "seat_ids": ["A-12-3", "A-12-4"],
  "quantity": 2
}
```

**Response — `201 Created`**

```json
{
  "hold_id": "h_8f3a2c",
  "event_id": 412,
  "seat_ids": ["A-12-3", "A-12-4"],
  "total_cents": 34000,
  "expires_at": "2026-10-15T20:14:00Z",
  "status": "held"
}
```

**Response — `409 Conflict`**, when a seat has just gone. This is the expected
answer for most people during a sale, so it is a normal response rather than an
error to apologise for:

```json
{
  "error": {
    "code": "seat_unavailable",
    "message": "Seat A-12-4 is no longer available.",
    "unavailable_seats": ["A-12-4"],
    "request_id": "7c2e91a4-5b60-4f38-8a1d-2e7b3c9f0044"
  }
}
```

### Confirming a purchase — `POST /v1/holds/{hold_id}/confirm`

```http
POST /v1/holds/h_8f3a2c/confirm HTTP/1.1
Authorization: Bearer eyJhbGciOi...
Idempotency-Key: 4f1c9a77-2b31-4d0e-9a55-71c2b8e3d9f0
```

```json
{
  "payment_method_token": "pm_tok_8831"
}
```

```json
{
  "order_id": "ord_5519",
  "event_id": 412,
  "seats": [
    { "seat_id": "A-12-3", "row": "A", "number": 12, "price_cents": 17000 },
    { "seat_id": "A-12-4", "row": "A", "number": 12, "price_cents": 17000 }
  ],
  "total_cents": 34000,
  "status": "confirmed",
  "tickets_url": "https://tickets.tickethub.example.com/ord_5519"
}
```

The `Idempotency-Key` header is **required** here, not optional. If a user's
network drops and they retry, the same key returns the original order instead of
charging twice or creating a second order (requirement **N6**).

### Errors

| Status | When |
| --- | --- |
| `400` | Malformed request, or more than 4 seats requested |
| `401` | Missing or expired token |
| `403` | Order belongs to another user |
| `404` | No such event, seat, hold or order |
| `409` | **Seat no longer available**, or hold already confirmed or expired |
| `410` | The hold expired before payment completed |
| `422` | Card declined, or seat not on sale |
| `429` | Rate limited — includes the queue position when a sale is on |
| `500` | Server fault; safe to retry with the same idempotency key |

---

## 4. Data model

### Tables

**`users`**

| Column | Type | Constraints |
| --- | --- | --- |
| `user_id` | `INTEGER` | **PRIMARY KEY** |
| `email` | `TEXT` | `NOT NULL`, **UNIQUE** |
| `password_hash` | `TEXT` | `NOT NULL` |
| `display_name` | `TEXT` | `NOT NULL` |
| `created_at` | `TEXT` | `NOT NULL` |

**`events`**

| Column | Type | Constraints |
| --- | --- | --- |
| `event_id` | `INTEGER` | **PRIMARY KEY** |
| `name` | `TEXT` | `NOT NULL` |
| `venue_id` | `INTEGER` | `NOT NULL`, FK → `venues` |
| `starts_at` | `TEXT` | `NOT NULL` |
| `on_sale_at` | `TEXT` | `NOT NULL` |
| `status` | `TEXT` | `NOT NULL`, `DEFAULT 'draft'` |

**`seats`** — one row per physical seat per event

| Column | Type | Constraints |
| --- | --- | --- |
| `seat_id` | `INTEGER` | **PRIMARY KEY** |
| `event_id` | `INTEGER` | `NOT NULL`, FK → `events`, **UNIQUE with `seat_label`** |
| `seat_label` | `TEXT` | `NOT NULL`, e.g. `A-12-3` |
| `section` | `TEXT` | `NOT NULL` |
| `row_label` | `TEXT` | `NOT NULL` |
| `seat_number` | `INTEGER` | `NOT NULL` |
| `price_cents` | `INTEGER` | `NOT NULL` |
| `status` | `TEXT` | `NOT NULL`, `DEFAULT 'available'` |

**`seat_holds`** — a temporary, exclusive claim on a seat

| Column | Type | Constraints |
| --- | --- | --- |
| `hold_id` | `TEXT` | **PRIMARY KEY** |
| `seat_id` | `INTEGER` | `NOT NULL`, FK → `seats` |
| `user_id` | `INTEGER` | `NOT NULL`, FK → `users` |
| `expires_at` | `TEXT` | `NOT NULL` |
| `status` | `TEXT` | `NOT NULL`, `DEFAULT 'active'` |

**`orders`** — a confirmed purchase

| Column | Type | Constraints |
| --- | --- | --- |
| `order_id` | `TEXT` | **PRIMARY KEY** |
| `user_id` | `INTEGER` | `NOT NULL`, FK → `users` |
| `event_id` | `INTEGER` | `NOT NULL`, FK → `events` |
| `seat_id` | `INTEGER` | `NOT NULL`, FK → `seats` |
| `amount_cents` | `INTEGER` | `NOT NULL` |
| `payment_ref` | `TEXT` | `NOT NULL` |
| `status` | `TEXT` | `NOT NULL`, `DEFAULT 'confirmed'` |
| `created_at` | `TEXT` | `NOT NULL` |

**`order_seats`** — links an order to the several seats it bought

| Column | Type | Constraints |
| --- | --- | --- |
| `order_id` | `TEXT` | **NOT NULL**, FK → `orders` |
| `seat_id` | `INTEGER` | **NOT NULL`, FK → `seats` |
| `PRIMARY KEY` | `(order_id, seat_id)` | stops a seat being listed twice on one order |

### CREATE TABLE statements

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  user_id       INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);

CREATE TABLE events (
  event_id   INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  venue_id   INTEGER NOT NULL,
  starts_at  TEXT    NOT NULL,
  on_sale_at TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'draft',
  FOREIGN KEY (venue_id) REFERENCES venues (venue_id)
);

CREATE TABLE seats (
  seat_id     INTEGER PRIMARY KEY,
  event_id    INTEGER NOT NULL,
  seat_label  TEXT    NOT NULL,
  section     TEXT    NOT NULL,
  row_label   TEXT    NOT NULL,
  seat_number INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'available',
  FOREIGN KEY (event_id) REFERENCES events (event_id),
  -- the same label cannot exist twice inside one event
  UNIQUE (event_id, seat_label)
);

CREATE TABLE seat_holds (
  hold_id    TEXT    PRIMARY KEY,
  seat_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  expires_at TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'active',
  FOREIGN KEY (seat_id) REFERENCES seats  (seat_id),
  FOREIGN KEY (user_id) REFERENCES users  (user_id)
);

CREATE TABLE orders (
  order_id     TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  event_id     INTEGER NOT NULL,
  seat_id      INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  payment_ref  TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'confirmed',
  created_at   TEXT    NOT NULL,
  FOREIGN KEY (user_id)  REFERENCES users (user_id),
  FOREIGN KEY (event_id) REFERENCES events (event_id),
  FOREIGN KEY (seat_id)  REFERENCES seats (seat_id)
);

CREATE TABLE order_seats (
  order_id TEXT    NOT NULL,
  seat_id  INTEGER NOT NULL,
  PRIMARY KEY (order_id, seat_id),
  FOREIGN KEY (order_id) REFERENCES orders (order_id),
  FOREIGN KEY (seat_id)  REFERENCES seats  (seat_id)
);
```

### Relationships

- **`users` → `orders`**: one-to-many. One buyer has many orders.
- **`events` → `seats`**: one-to-many. One event has many seats. Seats belong to
  an **event**, not to a venue, because the same physical seat in a stadium is a
  different product at each concert.
- **`orders` ↔ `seats`**: **one-to-one, and that is the point.** A seat can belong
  to at most one live order. This is not a convention the application follows; it
  is a database index (§5).
- **`orders` ↔ `seats` via `order_seats`**: many-to-many. A single order buys
  several seats at once, which is how people actually buy tickets. `order_seats`
  is the join table.
- **`users` → `seat_holds`**: one-to-many, and temporary.

Note the pair of tables that matters: `seat_holds` records *intent* and
`orders` records *fact*. The seat map reads holds to show "held", and orders to
show "sold", and neither one is asked to do the other's job.

---

## 5. Preventing double-booking

This is the requirement everything else serves: **a seat is never sold twice.**

### Why checking in code is not enough

The tempting implementation is to check before writing:

```js
const seat = await db.query("SELECT status FROM seats WHERE seat_id = ?");
if (seat.status === "available") {
  await db.query("INSERT INTO orders ...");
}
```

This is **broken under concurrency**, and it fails precisely when it matters
most. During the sale, two requests for seat `A-12-3` arrive within the same
millisecond. Both read `status = 'available`. Both pass the check. Both insert.
Two buyers hold tickets for one seat, and 19,999 other people discover the seat
they paid for does not exist.

The gap between the check and the insert is a race — a *time-of-check to
time-of-use* problem. No amount of care in the application code closes it,
because the two statements are separate and another transaction can commit
between them. Only the database sees both inserts at the same instant.

### The fix: let the database refuse the second write

The check is kept, but it is only there to produce a **friendly error message**.
The actual guarantee comes from a constraint:

```sql
-- THE rule that makes double-booking impossible:
-- one live order per seat, no matter how many requests arrive.
CREATE UNIQUE INDEX idx_one_live_order_per_seat
  ON orders (seat_id)
  WHERE status = 'confirmed';
```

**A partial unique index.** Only `confirmed` orders participate, so a cancelled
or refunded order releases its seat and the seat can be sold again — without
which the index would permanently block a seat after its first cancellation.

The guarantee is now: if two transactions try to confirm the same seat, **the
database rejects the second one**, no matter what the application code believes
or how the requests interleave. The application catches the constraint
violation, voids the payment authorisation, and tells the user the seat has gone.
The user is never charged for a seat they did not get.

The same idea protects the hold step, one step earlier:

```sql
CREATE UNIQUE INDEX idx_one_active_hold_per_seat
  ON seat_holds (seat_id)
  WHERE status = 'active';
```

### The full flow, inside a transaction

**Holding a seat** — the user's first click:

```sql
BEGIN IMMEDIATE;                    -- take the write lock up front

INSERT INTO seat_holds (hold_id, seat_id, user_id, expires_at, status)
VALUES ('h_8f3a2c', 8812, 51, '2026-10-15T20:14:00Z', 'active');

-- If another user already holds seat 8812, this INSERT fails on the
-- unique index. We roll back and return 409. No seat is double-held.
COMMIT;
```

`BEGIN IMMEDIATE` matters. SQLite's default deferred transaction only takes a
lock on first write, which lets two transactions both read before either writes.
`IMMEDIATE` takes the write lock at the start, so transactions serialise
properly. In PostgreSQL this maps to `SELECT ... FOR UPDATE` on the seat row.

**Confirming payment:**

```sql
BEGIN IMMEDIATE;

-- 1. still ours and not expired?
SELECT * FROM seat_holds
 WHERE hold_id = 'h_8f3a2c' AND user_id = 51 AND status = 'active';

-- 2. create the order. The partial unique index is the real guard:
--    if the seat was confirmed in the meantime, THIS fails.
INSERT INTO orders (order_id, user_id, event_id, seat_id, amount_cents,
                    payment_ref, status, created_at)
VALUES ('ord_5519', 51, 412, 8812, 17000, 'pay_9931', 'confirmed', '...');

-- 3. release the hold, now that the order owns the seat
UPDATE seat_holds SET status = 'confirmed'
 WHERE hold_id = 'h_8f3a2c';

COMMIT;
```

**If step 2 raises a unique-constraint violation**, the transaction rolls back,
the payment authorisation is voided, and the user is offered other seats. Nothing
is half-written, and nobody is charged for a seat they do not hold.

The ordering is deliberate: **hold first, pay second, confirm last.** Taking
payment before securing the seat is how ticketing sites charge people for seats
they never got.

### Expiry — holding a seat is not reserving it forever

A hold that is never paid would strand the seat, so a background worker
(§6) releases holds whose `expires_at` has passed:

```sql
UPDATE seat_holds SET status = 'expired'
 WHERE status = 'active' AND expires_at < CURRENT_TIMESTAMP;
```

The ten-minute window is the compromise between **F3** and **N5**: long enough to
enter card details and survive a slow payment page, short enough that a
distracted user does not hold inventory for the whole sale.

### Why this satisfies N12 as well as N4

Because a seat cannot have two active holds and cannot have two confirmed
orders, and every read of the seat map derives its state from those two tables,
**the map cannot show one seat as available to two people**. Availability is not
computed and cached separately where it could drift — it is a direct consequence
of the constraint.

---

## 6. Architecture

```
   TICKETHUB - 2 million registered users
   ===================================================================

   +------------------+     +-------------------+
   |  DNS             |     |  CDN              | static JS/CSS, 200k
   |  healthy targets |---->|  edge cache       | page loads served here
   +------------------+     +---------+---------+
                                    |
                                    v
                            +-------+---------+
                            | Load balancer   | TLS, health checks
                            +-------+---------+
                                    |
        +-------------+-------------+-------------+-------------+
        |             |             |             |             |
 +------v------+ +----v-----+ +-----v------+ +----v------+ +----v-----+
 | App server 1| | App 2    | | App 3     | | App N     | | SALE GATE|
 | stateless   | | stateless| | stateless  | | stateless  | | waiting  |
 +------+------+ +----+-----+ +-----+------+ +-----+------+ | room     |
        |             |             |             |        +----+-----+
        |             |             |             |             |
        |      +------+------+------+------+------+             |
        |      |             |             |                    |
 +------v------+  +---v-----------+  +---v---------+      +----v-----+
 |   CACHE      |  |  READ REPLICA|  |  QUEUE      |      | QUEUE    |
 | Redis:       |  |  events,     |  |  expiry,    |      | position |
 | seat maps,   |  |  seat maps,  |  |  email      |      | (sorted  |
 | event pages  |  |  availability |  +------+------+      |  set)    |
 +--------------+  +---------------+         |            +----------+
        |                                       |
        |                               +-------v--------+
        |                               |   WORKER       |
        |                               | releases holds,|
        |                               | emails tickets |
        |                               +----------------+
        |
  +-----v----------+      +-------------------+
  |  DB PRIMARY    |      |  PAYMENT GATEWAY  |
  |  THE ONLY     |----->|  (external)       |
  |  WRITER        |      |  authorise/capture|
  |  orders, holds |      +-------------------+
  +-----+----------+
        |  replicated
  +-----v----------+
  |  READ REPLICA  |  read-only; can be rebuilt from the primary
  +----------------+
```

### What each component solves

- **DNS** — Points the name at several healthy servers so one failing machine stops receiving traffic instead of taking the site down.
- **CDN** — Absorbs the 200,000 static page loads of a sale so they never reach the app servers; at a sale peak this is most of the traffic.
- **Load balancer** — Spreads requests across app servers, health-checks them, and terminates TLS in one place.
- **App servers** — Stateless, so any can serve any request and the fleet can grow for a sale and shrink afterwards.
- **Sale gate (waiting room)** — Queues buyers on sale open and serves them in order, turning a 333/second stampede into a controlled trickle.
- **Cache** — Holds event listings and seat maps, which change rarely and are read constantly; this absorbs the bulk of the sale's read traffic.
- **Read replica** — Serves every read, so the sale's 1,333 requests/second never touch the writer.
- **DB primary** — The only component that writes orders and holds, and the only place the double-booking constraint is enforced.
- **Queue** — Carries hold expiry, email and ticket delivery off the request path, so a slow email cannot stall a purchase.
- **Worker** — Releases expired holds and sends tickets, retried until they succeed.
- **Payment gateway** — External; taken out of the request path so a payment provider's downtime cannot corrupt ticket state.

### How it survives the big sale

1. **The sale gate absorbs the stampede.** 200,000 people do not hit the app
   servers. They are issued a queue position and served at a controlled rate. The
   database is asked for 33 writes per second, not 1,333 requests per second.
2. **The CDN takes the traffic that is only reading.** Event pages and assets are
   served from the edge, so the surge mostly never arrives.
3. **The cache serves the seat map.** Almost all 1,333 requests/second are people
   looking, not buying. Those come from cache and the read replica.
4. **The writer stays small.** Only 20,000 orders will ever be created, at 33/second.
   A single primary handles that easily, which is what makes the
   strict correctness model affordable.
5. **Holds expire by themselves.** If a worker dies, the next one catches up, and
   expired holds are released — so no seat is stranded by a crash and no seat is
   ever sold twice because "someone might still be paying".
6. **Losers are handled, not dropped.** A buyer who cannot get a seat gets a
   clear `409` and an offer of alternatives. 180,000 clean refusals are a
   designed outcome, not an outage.

---

## 7. Trade-offs

### 1. Holding in the database instead of in Redis

The obvious place for "who is holding this seat right now" is Redis, because it
is fast and it expires keys on its own. The alternative is a table with an
`expires_at`, which is what this design uses.

**Redis is faster** and its TTL support is a better fit for a short-lived cache
entry. **The database is correct**, and correctness is what a seat needs: Redis
offers no transaction spanning "check this seat" and "claim this seat", so two
users can be handed the same seat. A database unique index gives the guarantee
for free. So Redis is used for the **queue position** — where losing an entry is
harmless — and the database for **seat ownership**, where losing an entry means
overselling.

**The cost** is real: every hold is a database write, so the sale generates far
more write traffic than a Redis design would. At 333 attempts/second that is fine.
At 100× it would not be, and this is the first thing that would need revisiting.

### 2. Strict FIFO fairness against fastest-service-first

Queuing everyone in arrival order is the fairest rule (**N8**) but it is not the
fastest way to sell seats. A strict queue keeps serving one buyer even while
later buyers abandon their carts, so seats can sit unsold while people wait. The
alternative — first-come-first-served by whichever request reaches the database
first — fills seats faster but rewards fast networks and bots, and is not fair.

**This design chooses fairness**, on the grounds that a customer who waited 40
minutes for a queue position and then watched someone else take the seat they
were next in line for is a customer who never buys from you again. The cost is
some seats held by abandoned carts, recovered by hold expiry.

### 3. A ten-minute hold window

Long enough to enter card details on a slow connection; short enough that a
forgotten checkout does not hoard seats during the busiest ten minutes of the
year.

The tension is real in both directions. **Longer** holds are fairer to buyers and
reduce payment abandonment, but strand seats for longer. **Shorter** holds free
inventory faster but lose sales to slow payment pages. Ten minutes is a judgement
call, and it is the number most worth revisiting with real abandonment data.

### 4. A per-user cap of four seats

Stops one person, or one bot, buying all 20,000 seats (**N9**). It also blocks a
legitimate buyer who wanted twelve — a family group is a real customer.

The cap is a blunt instrument: it treats every buyer as a potential bot. A
smarter rule would allow a higher limit for accounts with a payment history,
which is more work and another thing to get wrong. The blunt version is chosen
because it is enforceable without collecting more personal data than needed.

### 5. Refusing 90% of buyers

The design accepts that 180,000 people go home with nothing. That is the correct
outcome when 200,000 people want 20,000 seats — but it is a commercial decision
as much as a technical one, and it is why **N10** insists losers get a clear
message and an offer of the next sale. A system that merely survives the
stampede while making losers think the website is broken would be a technical
success and a commercial failure.

---

## 8. Summary

On a normal day TicketHub serves **6 page views per second** and sells a ticket
every **17 seconds**. During a sale it sees **1,333 requests per second** —
**230× normal** — with 200,000 buyers competing for 20,000 seats.

That comparison is the design. Traffic is read-heavy even at peak, so caching
and a waiting room carry the surge and the database only ever handles 33 writes
per second. Buyers are served in arrival order because 90% must be turned away
and fairness is cheaper than the seats it wastes.

And the one thing that is never left to application code: a **partial unique
index on `orders (seat_id) WHERE status = 'confirmed'`**, inside a transaction,
with the payment taken only after the seat is secured. Two buyers can race for
the same seat as hard as they like — the database refuses the second one.
