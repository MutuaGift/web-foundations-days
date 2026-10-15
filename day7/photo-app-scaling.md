# SnapShare - Scaling Plan

SnapShare is a photo-sharing app. Users upload photos, and they scroll a feed
of photos from the people they follow. This document works out how much load
the system has to carry, decides whether that load is mostly reads or mostly
writes, and sets out an architecture that can take it.

The short version: **the system is heavily read-dominated, and almost all of the
weight is in moving photo bytes around rather than in storing rows.**

---

## 1. Assumptions

The starting facts, restated so the arithmetic is checkable:

- **10 million registered users.**
- **10% are active on any given day.**
- **Each active user uploads 1 photo per day.**
- **Each active user views 50 feed pages per day.**
- **An average photo is 2 MB; its thumbnail is 50 KB.**

Further assumptions made along the way, and why:

- **A day is 86,400 seconds** (24 × 60 × 60). Dividing daily totals by this
  converts a day's work into a steady rate.
- **A year is 365 days.**
- **1 MB = 1,000 KB = 1,000,000 bytes and 1 TB = 1,000 GB.** Decimal units, the
  convention object storage providers bill in. The binary alternative (1 MB =
  1,048,576 bytes) changes the totals by about 5%, which does not affect any
  decision in this document.
- **A "feed page" is a request for the next batch of photos**, not a single
  photo. Fifty is the number of *pages*, so it is the request rate that matters
  for the servers, and the page size only affects bytes on the wire.
- **Peak is 5× the daily average**, as given. This is a blunt average-buster
  and not a true worst case; a real system would also want to know how long the
  peak lasts and how much it flattens the cache.
- **Thumbnails are served far more often than original photos.** A feed shows
  50 KB per photo; a user tapping to enlarge it pulls 2 MB, which is 40× more.
  So the CDN's job is almost entirely about thumbnails.
- **Uploads are roughly evenly spread across the day.** If evening peaks are
  much sharper than 5×, the upload side needs more headroom than shown.
- **Only new photos are counted.** The estimate ignores re-uploads, edited
  photos, and deleted originals.
- **Storage is counted for one copy.** Replication and backups multiply this
  (see §8), and the number to budget for is not 748 TB.

---

## 2. The numbers

### Daily active users

```
10,000,000 registered  x  10% active  =  1,000,000 daily active users
```

**DAU = 1,000,000.** Everything below follows from this.

### Uploads per day, and per second

```
1,000,000 DAU  x  1 photo/day  =  1,000,000 uploads per day
1,000,000  /  86,400  =  11.57 uploads per second, average
11.57  x  5  =  57.87  ->  about 58 uploads per second at peak
```

### Feed views per day, and per second

```
1,000,000 DAU  x  50 pages/day  =  50,000,000 feed views per day
50,000,000  /  86,400  =  578.7 feed views per second, average
578.7  x  5  =  2,893.5  ->  about 2,894 feed views per second at peak
```

### Storage per year

```
Photos:      1,000,000 x 2 MB   = 2,000,000 MB/day  = 2,000 GB/day  =   2.00 TB/day
Thumbnails:  1,000,000 x 50 KB  =    50,000,000 KB/day = 50,000 MB/day =  50 GB/day
                                                                 ---------
                                            2,050 GB/day  =   2.05 TB/day added

Photos per year:       2.00 TB/day x 365 = 730.00 TB
Thumbnails per year:  50 GB/day  x 365 =  18.25 TB
                                                ------------
                            about 748 TB per year, or 0.75 PB per year
```

### Summary

| Quantity | Average | Peak (5×) |
| --- | --- | --- |
| Daily active users | 1,000,000 | — |
| Uploads per second | 11.57 | **58** |
| Feed views per second | 578.7 | **2,894** |
| Storage added per year | 748 TB | — |

---

## 3. Read-heavy or write-heavy?

**Read-heavy, and not by a small margin.**

```
50,000,000 feed views/day  :  1,000,000 uploads/day  =  50 : 1
```

For every photo uploaded, 50 feed pages are read. In requests per second the
system is **98% reads** (578.7 reads against 11.57 writes). Even at peak the
ratio holds, because both sides peak together — uploads rise to 58/s and views
to 2,894/s, and that is still 50:1.

**What that means for the design:**

- **Spend the money on the read path, not the write path.** Feeds should be
  served from cache and CDN, because that is where ~98% of traffic lands. The
  upload path needs to be reliable and correct but does not need to be fast.
- **Writes are cheap, so don't contort the database for them.** 11.57 writes per
  second is trivial for a single well-configured primary. Write capacity is not
  the constraint at this scale, which means the schema and the correctness of
  the constraints come first.
- **Cache aggressively and cache without guilt.** A stale feed for a few seconds
  is a far better trade than a slow or unavailable one, and the read/write ratio
  is what makes that trade cheap.
- **Do not build read/write splitting the usual way.** Scaling reads by adding
  database replicas is the obvious move, but it mainly moves the load in front
  of the cache. Here the cache should absorb the reads first.
- **The write path is where the bytes are.** Writes are rare but enormous: 2.05 TB
  is added every single day while the average request rate stays flat. Capacity
  planning has to treat storage growth and request rate as two separate problems,
  because they scale on completely different curves — one is steady, the other
  compounds forever and never plateaus.

---

## 4. Why photos must not live in the database

The database should hold **metadata** only: photo id, owner, caption, timestamp,
who may see it, and the storage key pointing at the file.

Photo bytes belong in **object storage** (S3, GCS, or equivalent). The reasons:

- **Wrong data type.** A 2 MB blob is a large object; a row is a few hundred
  bytes. Rows live in memory and are expected to be small. Backing up, vacuuming,
  and replication-engineering a database means moving terabytes of files
  constantly.
- **The database backs up twice daily.** Backing up 748 TB of photos would mean
  copying nearly a petabyte a day. Backing up metadata (gigabytes) is cheap;
  object storage handles durability at the file level for free.
- **One slow query becomes one slow everything.** Every photo read is a read of
  a multi-megabyte row. That bloats the buffer pool, evicts the rows that the
  feed queries actually need, and turns an innocent query into a disk-bound
  scan of the whole table.
- **Replicas replicate everything.** A 2 MB blob has to cross the network to
  every replica. Read replicas exist to serve queries, not to duplicate photo
  files, so this is bandwidth spent for nothing.
- **Replication lag becomes user-visible.** Large rows mean larger binlog
  entries, so a follower falls further behind exactly when the system is busiest.
- **The access pattern is wrong.** Photos are fetched by key, in bulk, and are
  immutable once written. That is a key-value pattern, which is precisely what
  object storage is built for.
- **Cost.** Object storage is roughly a tenth of the price per GB for this kind
  of bulk data, and it scales without a resharding migration.

The database stores a **key**, and the bytes live in object storage. The feed
query returns keys; the CDN turns keys into URLs.

---

## 5. Architecture

```
   SNAPSHARE - request paths
   ==========================================================

   READ PATH - about 98% of traffic (578/s avg, 2,894/s peak)

   +----------------------------------------------------------+
   |  CLIENT - phone app                                      |
   +----------------------------------------------------------+
             |
             |  HTTPS
             v
   +----------------------------------------------------------+
   |  CDN - thumbnails and static assets, cached worldwide    |
   +----------------------------------------------------------+
             |  cache miss (only about 10% of requests)
             v
   +----------------------------------------------------------+
   |  LOAD BALANCER - spreads load, health checks             |
   +----------------------------------------------------------+
             |
             v
   +----------------------------------------------------------+
   |  APP SERVERS - stateless, add more to scale              |
   +----------------------------------------------------------+
             |
       +-----+------+------------------+
       |            |                  |
       v            v                  v
   +---------+  +---------+      +---------+
   |  CACHE  |  |   DB    |      |  QUEUE  |
   | (Redis) |  | primary |      | upload +|
   +---------+  +----+----+      | thumb   |
                       |         +----+----+
                       |              |  async
                       |              v
                       |       +------+-------+
                       |       |  THUMBNAIL   |
                       |       |  WORKER(S)   |
                       |       +------+-------+
                       |              |
                       |              | uploads thumb,
                       |              | writes thumb key
                       |              v
                       |       +---------------+
                       +------>|    OBJECT      |
                                |   STORAGE     |
                                | (S3 / GCS)    |
                                | photo + thumb |
                                +-------+-------+
                                        |
       +--------------------------------+  replication
       |                                |  (metadata only)
       v                                v
   +----------------+            +----------------------+
   |    DB REPLICA  |            |   OBJECT STORAGE     |
   |  feed reads,   |<---------->|  photo bytes (2 MB)  |
   |  read-only     |  serves    |  thumb bytes (50 KB) |
   +----------------+  via CDN   +----------------------+


   WRITE PATH - about 2% of traffic (11.6/s avg, 58/s peak)

   +----------+     +---------+          +-------------------+
   |  User    |---->|   CDN   |          |   OBJECT STORAGE  |
   | uploads  | pre-| (pass   |          |  takes the 2 MB   |
   | the file |signed| through)|          |  directly from the |
   +----------+ URL  +---------+          |  phone, bypassing  |
                                           |  our app servers   |
                                           +-------------------+
                                                     ^
                                                     | 3. worker attaches thumb
                                                     |    key to the row
                                                     |
   +----------+     +---------+          +-------------------+
   |  User    |---->|   APP   |--2------->|     DB PRIMARY    |
   |  posts   |  1. |  SERVER |  metadata |  the only writer  |
   |  details |     |         |  row      |  + replica       |
   +----------+     +----+----+          +-------------------+
                          |                       ^
                          | 4. enqueue           |
                          +-----------------------+
                          |
                          v
                      +-------+
                      | QUEUE |
                      +-------+


   EVERY COMPONENT IN ONE PLACE

   +------------------+---------------------------+--------------------+
   |     COMPONENT     |           ROLE           |      IN PATH       |
   +------------------+---------------------------+--------------------+
   | CDN              | serves thumbs near users  | read               |
   | Load balancer    | spreads load              | read + write       |
   | App servers      | stateless business logic   | read + write       |
   | Cache            | rendered feeds in memory  | read               |
   | DB primary       | metadata, only writer      | write              |
   | DB replica       | feed reads                | read               |
   | Object storage   | photo and thumb BYTES      | read + write       |
   | Queue            | buffers thumb work         | write              |
   | Thumbnail worker | makes 50 KB thumbs        | async              |
   +------------------+---------------------------+--------------------+
```

**Data stores, side by side:**

| Store | Holds | Scale by |
| --- | --- | --- |
| Object storage | photo and thumbnail bytes | elastic, no sharding |
| DB primary | metadata; the only writer | vertical, then read replicas |
| DB replica | feed reads | add replicas |
| Cache | rendered feed pages, follow lists | memory + eviction |
| Queue | thumbnail jobs | worker count |

---

## 6. What each component is for

- **CDN** — Puts thumbnails and static assets on edge servers near users, so the
  ~2,894 feed views per second mostly never touch our infrastructure, which also
  removes most of the network cost of serving images.
- **Load balancer** — Spreads requests across the app servers so no single one
  becomes a bottleneck or a single point of failure, and takes failing servers out
  of rotation.
- **App servers** — Stateless API processes running the business logic, kept
  deliberately stateless so any of them can answer any request and the fleet can
  be scaled horizontally by adding more.
- **Cache (Redis)** — Holds rendered feed pages and follow lists in memory so
  repeated reads of the same feed are answered without touching the database,
  absorbing the overwhelming majority of the 50:1 read traffic.
- **DB primary** — The single source of truth for metadata and the only place
  that accepts writes, so there is never a conflict about who wrote what.
- **DB read replica** — Serves feed reads so that the 98% read load scales
  horizontally without touching the writer or risking it being overloaded.
- **Object storage (S3/GCS)** — Stores the actual photo and thumbnail files
  durably and cheaply as opaque bytes, keeping multi-megabyte files out of the
  database entirely.
- **Queue** — Buffers the thumbnail work so the upload request returns
  immediately instead of waiting on image processing, and absorbs bursts by
  holding jobs until a worker is free.
- **Thumbnail worker** — Runs separately and at its own pace to resize each
  upload into a 50 KB thumbnail, so slow image processing never blocks a user or
  the request that triggered it.

---

## 7. Upload flow, step by step

1. **Client prepares the request.** The app picks the 2 MB file and requests a
   pre-signed upload URL from the API, so the file itself will go straight to
   object storage without passing through our servers. This is the step that
   keeps large uploads off the app tier entirely.
2. **Client uploads the photo directly to object storage**, using the
   pre-signed URL. The 2 MB goes from the phone to storage, not from the phone
   through the app servers, which is what stops the write path from ever being a
   bottleneck.
3. **App server writes the metadata row.** After storage confirms the upload, the
   client posts the details to the app server, which writes a row to the DB
   primary: photo id, owner, caption, timestamp, privacy, and the storage key.
   Photo bytes are not in this row — only the key.
4. **App server enqueues a thumbnail job.** A message is placed on the queue
   naming the photo id and its storage key. This happens *after* the metadata
   write, so a worker can never be handed a job for a photo that does not exist
   yet.
5. **App server returns success immediately.** The user sees "posted" right
   away. Nothing has waited on image processing.
6. **A worker picks the job up** and pulls the original out of object storage
   using the key from step 4.
7. **Worker generates the thumbnail** — resizes to a feed-sized image and
   encodes it at roughly 50 KB.
8. **Worker writes the thumb back to object storage** under a new key derived
   from the photo id (for example `photos/1234/thumb.jpg`), overwriting the
   placeholder if one was written in step 3.
9. **Worker updates the metadata row** with the thumbnail's key and flips the
   photo's state to ready. This is a second write to the same row, so it is
   visible in the database that an upload is still being processed.
10. **CDN picks the thumbnail up.** The CDN is told to fetch the new thumbnail
    key, and from then on it is served from the edge.
11. **The photo becomes visible in followers' feeds.** The row that the feed
    query reads now points at both keys, so the feed renders as a grid of URLs
    the CDN can serve.

The upload is therefore two writes to the database (create, then attach thumb)
and one message to the queue, with no synchronous work between the user and the
response.

---

## 8. Trade-offs

**1. Cache for speed, at the cost of staleness.**
Serving a feed from Redis means a photo posted a second ago may not appear in a
follower's feed for a few seconds, and an unfollow may take a moment to take
effect. The alternative — querying the primary on every page view — turns 2,894
reads per second at peak into database traffic and risks the whole feed
degrading under load. Short TTLs (30–60 seconds) keep the window small; the
trade is accepting a slightly wrong feed in exchange for a fast and available
one.

**2. Asynchronous thumbnails: fast uploads, brief invisible photos.**
Returning success before the thumbnail exists (steps 5–9) means the upload feels
instant, but for a few seconds the photo is in the database and not yet in any
feed. Generating the thumbnail synchronously would avoid that gap but would make
uploads wait on image processing and hold a request thread open — and would tie
the upload path's availability to the least reliable part of the system. The
trade is a short delay in visibility for a much better upload experience, and the
metadata must mark the photo as not-ready so it is never rendered broken.

**3. Read replicas: cheap reads, stale reads.**
A replica offloading feed queries is the cheapest way to add read capacity, but
replication lag means a newly posted photo may not be on the replica for a
second or two, and a follower count can lag behind. It also risks split-brain
style bugs if a write is accidentally sent to a replica, so the rule has to be
that replicas are read-only. The trade is slightly stale reads for a large
capacity gain.

**4. CDN caching: fast and cheap, but harder to take content down.**
Edge caching removes most origin load, but a cached photo stays visible on the
edge after it is deleted or made private until the TTL expires. For privacy
settings that is a real correctness problem, not just a performance one: a photo
set to private must stop being served immediately. The usual resolution is short
TTLs for private content, cache-busting or signed URLs for anything that must be
revoked instantly, and accepting that public photos stay cached longer.

**5. At-least-once queue delivery: simpler, but duplicates possible.**
Queues guarantee *at least* one delivery, so a worker can receive the same
thumbnail job twice. Making the work idempotent — derive the thumb key from the
photo id so a repeated write overwrites rather than duplicates, and treat an
already-attached thumb as success — is simpler and cheaper than pursuing exactly
-once delivery, which is the right trade at this scale.

**6. SQL versus NoSQL.**
A relational database is the better fit here: the interesting data is
relationship-heavy (who follows whom, who is enrolled on what, what may be seen),
the read/write ratio is a fixed 50:1 rather than changing, and the feed needs
joins and `GROUP BY` across tables. A document store would make "load 20 photos
for these 50 user ids" an application-side fan-out across documents, which is
worse for exactly the query that dominates traffic. NoSQL would pay off if
follow-graph writes became the hot path, but uploads are 2% of traffic, so it
would not.

---

## 9. Where the numbers point

The headline figures to design against:

- **2,894 feed views per second at peak** — but ~90%+ should be absorbed by the
  CDN, leaving a few hundred requests per second reaching the origin. That is
  the number app servers must actually handle.
- **58 uploads per second at peak** — handled by object storage directly, with
  the queue absorbing bursts when workers fall behind.
- **748 TB added per year** — the number that never stops growing and needs a
  lifecycle policy (cold storage for old photos) and a retention plan, because
  it is the one figure that compounds indefinitely.
- **50:1 read-to-write** — the justification for every cache and every replica in
  the design above.
