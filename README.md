# MYLEBRAND Shop + Order Tracker

One website, one free deployment: the **shop** (what customers see at `/`) and the **order tracker**
(what you already have), joined together.

## Pages and addresses

| What | Address |
|---|---|
| Curated batch shop (home) | `/` |
| Beauty wholesale (QR code) | `/beauty` |
| Interiors (QR code) | `/interiors` |
| Admin | `/admin` |
| Older tracker (ID + PIN) | `/track` |

Customers log in at `/login`; their orders and tracking are under **My orders**.

**If products do not show on the site:** the batch is probably still a Draft. In Admin > Shop > Products you will see a yellow banner with a **Publish now** button.

## Changing the fonts

Open `public/css/tokens.css`. The three `--font-*` lines are the fonts the whole site uses. To use your own font files (for example Grande, Angle, August Script): put the `.woff2` files in `public/fonts/`, un-comment the `@font-face` lines at the top of that file, and put the font names in the `--font-*` lines.

---

## What is new: the shop

- **Storefront** at `/`: batches, edits (collections like "The Becoming Edit"), products and boxes, available vs sold out.
- **Customer accounts**: sign up / log in. Cart is saved to the account. Checkout needs an account.
- **Checkout**: places the order, shows your bank details with copy buttons, then a green WhatsApp button
  with a pre-written message. Everything else (what happens next, tracking) is on the order page.
- **Order page = tracker**: once you mark an order **Paid**, the customer sees the batch timeline inside their account.
  The older `/track` page (ID + PIN) still works for tracker-only orders.
- **Admin** at `/admin`, two tabs:
  - **Tracker**: your existing batches, customers, stages.
  - **Shop**: Products (edits, products, boxes, photos, sold-out button), Orders (mark paid / cancel),
    Ledger (money in, cost, expenses, profit, bought/sold/left per product), Customers (reset password),
    Carts (what people have saved), Settings (bank, social links, gift, announcement).
- You mark **sold out by hand** (button on each product). Nothing is counted down automatically.

## Product photos (free): Cloudinary

Photos are stored on Cloudinary, not on your free server, so they are fast and never fill your database.

1. Sign up free at cloudinary.com. On the dashboard copy **Cloud name**, **API Key**, **API Secret**.
2. On Render > your service > Environment, add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Save (Render redeploys).
3. In Admin > Shop > Products, "+ Add photos" now uploads straight from your phone or laptop.

Until you do this you can still add photos by pasting any `https://` image link.
Check Cloudinary's current free allowance on their pricing page; it changes.

## First-time shop setup (10 minutes)

1. Admin > Shop > **Settings**: bank details, WhatsApp, Instagram / TikTok / Facebook links, announcement.
2. Admin > Tracker: create the batch. Admin > Shop > Products > "Shop settings for this batch": set it to **Open**.
3. "+ New edit", then "+ Product" / "+ Box" inside it.
4. Visit your site's home page. When a customer pays, Orders > Mark as paid.

## Customer passwords

There is no email service on the free plan. If a customer forgets their password they message you on WhatsApp;
Admin > Shop > Customers > **Reset password** gives you a temporary one to send them. They must change it at next login.

## Security notes

- Passwords are scrypt-hashed. 5 wrong tries lock that account for 15 minutes; logins are rate limited per device.
- Sessions are random tokens stored hashed in the database; cookies are HttpOnly. Admin and customer logins are separate.
- Prices, totals and availability are always taken from the database at checkout, never from the browser.
- Your cost prices and the ledger are admin-only and never sent to the public pages.
- Keep `ADMIN_PASSWORD`, `DATABASE_URL` and `CLOUDINARY_API_SECRET` private.

---

# MYLEBRAND Order Tracker (the original guide)

## The idea in plain English

Think of a school result portal. Everyone uses the same website, but each student needs their own
matric number **and** a secret PIN to see their own result. Nobody can browse the list.

This tracker works the same way:

- **Customers** open the site, type their **Tracking ID** (like `MYLE-7K4Q2X`) and their **6-digit PIN**, and see only their own order.
- **You (the admin)** log in at `/admin` with one password. You create batches, add customers, and tap "Mark reached" as the goods move.

## What customers see

A dotted route map (China, at sea, Lagos, you) with a marker that moves, a "Day 35 at sea, about 56 days to Lagos"
counter, and a timeline of 12 steps. Every finished step shows when it started and when it ended
("Arrived 14 Sept, 7:09 pm, Left 18 Sept, 3:20 pm"). All times show in Lagos time.

## The 12 steps

| # | Step | Who it applies to |
|---|------|-------------------|
| 1 to 7 | Order confirmed, Sourcing, China warehouse, Packed, On the ship, Arrived in Lagos, Customs clearance | The whole batch (you tap once) |
| 8 to 12 | Collected by founder, Being packed, Packaged, Out for delivery, Delivered | Per customer (tick the people, tap update) |

Steps must go in order, and you cannot record a time in the future. Mistakes can be undone (latest step only).
The wording of every step is in `stages.js`

## Files

- `server.js` the backend (security, database, admin and customer API)
- `stages.js` the 12 steps and the wording customers see
- `public/index.html`, `public/tracker.js` the customer page
- `public/admin.html`, `public/admin.js` the admin page
- `public/styles.css` the look (brand colours are at the top)
- `render.yaml` optional Render setup file
