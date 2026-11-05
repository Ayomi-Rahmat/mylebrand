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

## Admin password: change it, and what to do if you forget it

1. Admin > Shop > Settings > **Admin security**: change the password and click **Make new recovery codes**. Save the 8 codes somewhere private (they are shown once).
2. Forgot the password? On the admin login page click **Forgot password?**, enter one recovery code and choose a new password. Each code works once.
3. Lost the codes too? On Render > Environment, set `ADMIN_PASSWORD` to a new password (10+ characters) and add `ADMIN_FORCE_RESET` = `yes`. Save, wait for it to redeploy, log in with that password, then **delete `ADMIN_FORCE_RESET`**.

## Fonts

Your brand fonts are installed: Grande (logo and big headlines), Angle (section headings), Alice (small titles), August Script (taglines), with Open Sans for text and prices. Romantic Couple is installed too and is the backup script font. The files are in `public/fonts/` and the choices are in `public/css/tokens.css`. None of the brand fonts has the ₦ sign, which is why prices use Open Sans. The **March** font was not used because its file says "personal use only". Please check that you have commercial rights for your other fonts (Grande, Angle, August Script, Romantic Couple) before you rely on them for the business.

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
The wording of every step is in `stages.js`.

## How the free setup fits together

Think of a shop and its storeroom:

- **Render (free)** is the shop. It serves the pages. On the free plan it goes to sleep when nobody visits, and it **forgets everything on its own shelves** every time it restarts.
- **Neon (free Postgres)** is the storeroom. Customers, PINs and updates live here, so nothing is lost when the shop restarts.

You need both, and neither needs a card.

## Put it online: step by step

### 1. Create the database (Neon)

1. Sign up at neon.com (no card needed) and create a project. Choose a region close to where you will put Render (Frankfurt is probably closest to Nigeria for both, if offered).
2. Click **Connect** at the top of the project page and copy the **connection string**. It starts with `postgresql://` and contains your password. Keep it private, like a password.

### 2. Put the code on GitHub

1. Unzip this project. On github.com create a new **private** repository.
2. Upload all the files and folders from the unzipped folder (not the folder itself). `.gitignore` already keeps secrets and the database out.

### 3. Create the website (Render)

1. On render.com choose **New > Web Service**, connect GitHub and pick the repository.
2. Set: Language **Node**, Instance type **Free**, Build command `npm install`, Start command `npm start`.
3. Add environment variables:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `ADMIN_PASSWORD` | A long password only you know (10+ characters, the app refuses to start otherwise) |
| `DATABASE_URL` | The Neon connection string from step 1 |
| `WHATSAPP_NUMBER` | Optional. Defaults to 2349043045498 |

4. Do **not** add a disk. Do **not** use Render's own free database: Render deletes it after about 30 days.
5. Under Settings, set **Health Check Path** to `/healthz`. Then deploy.
6. Open your `https://something.onrender.com` link, go to `/admin`, log in, create a test batch and customer, check it on your phone, then delete the test data.

(There is also a `render.yaml` in this folder that sets most of this up automatically via New > Blueprint. It is optional.)

### 4. Stop the one-minute wake-up (recommended)

A free Render site sleeps after 15 minutes without visitors, and the next visitor waits about a minute for it to wake up.
A free uptime monitor (UptimeRobot, cron-job.org and similar) can open `https://your-site.onrender.com/healthz`
every 5 to 10 minutes to keep it awake.

- Ping **only `/healthz`**. It does not touch the database. Pinging a page that does would keep the database awake all month and use up its free hours.
- Render gives 750 free hours a month, and one site running all month uses about 744. That fits only if this is the **only** free web service in your Render account.
- Check Render's current terms about keep-alive pings before relying on this.

Without the monitor everything still works, the first visitor after a quiet spell just waits longer.

## What changes on the free plans

- First visit after the site slept: about a minute, unless you use the monitor above.
- First lookup after the database slept (it naps after about 5 minutes idle): usually just a moment longer. The customer sees "Still checking…" if it takes more than a few seconds.
- Neon's free plan includes 100 compute hours a month and 1 GB of storage. This app uses a tiny fraction of both. If the hours ever ran out, the database would pause until the next month.
- Update the site by pushing to GitHub. Customers and PINs are safe, because they live in Neon.

## How it is protected

- Each order needs its **ID and PIN**. Wrong ID and wrong PIN give the exact same message, so nobody can test which IDs exist.
- PINs are stored **scrambled (hashed with scrypt)**, never as plain text. You see a PIN only once, at creation. Lost one? Tap "New PIN".
- **5 wrong PINs lock that order for 15 minutes**. The count is kept in the database in one step, so many simultaneous guesses cannot sneak past it, and it survives the site restarting. Each device is also limited to 60 tries per 15 minutes (that counter resets when the site sleeps, the order lock does not).
- The customer page only ever returns that one customer's first name, items and steps. It never returns other people's data.
- The admin area needs your password (8 tries per 15 minutes) and uses a secure login cookie. Logins are kept in the database, so they last 12 hours even if the site sleeps, and Log out ends them straight away. Requests from other websites are rejected.
- Search engines are told not to index the site.
- The PIN is kept only in the page's memory while it is open. It is not saved in the browser.

## Things to know

- **Keep your Neon connection string and admin password private.** Never paste them into GitHub or WhatsApp.
- There is **no automatic backup** built in. Customers and PINs live only in Neon. Check what restore options Neon's free plan offers in your project, and tell Claude if you want a "download backup" button added.
- There is one admin password. Anyone with it controls everything.
- Someone who learns a customer's ID could lock that order for 15 minutes by guessing PINs. Tap "New PIN" to unlock it right away.
- Customers' names and items are stored as plain text in the database (PINs are not).

## Run it on your own computer (optional)

You need Node.js 20 or newer and a Postgres database. Use a **separate** free Neon project for testing, not your real one.

```bash
npm install
DATABASE_URL="postgresql://..." npm start      # on Windows PowerShell: $env:DATABASE_URL="postgresql://..."; npm start
```

Open http://localhost:3000 (customers) and http://localhost:3000/admin (you).
With no `ADMIN_PASSWORD` set, the terminal prints a temporary one.

## Files

- `server.js` the backend (security, database, admin and customer API)
- `stages.js` the 12 steps and the wording customers see
- `public/index.html`, `public/tracker.js` the customer page
- `public/admin.html`, `public/admin.js` the admin page
- `public/styles.css` the look (brand colours are at the top)
- `render.yaml` optional Render setup file

## Pop-ups and the cart

- Tapping a product opens a small pop-up with photos, price, description, a quantity box you can type in (or use + and −) and **Add to cart**.
- The cart slides in from the side. Wholesale items (beauty and interiors) need no account: **Send my order on WhatsApp** writes the order message for you and blocks sending until each minimum quantity is met.
- Preorder items still check out with a login. Log in and sign up now open as a pop-up too.
- In the admin Shop tab, new batch, new edit, product and wholesale product forms open as pop-ups. Closing one with X, Cancel or Esc discards what was not saved. Wholesale products only go live after **Save page**.

## Orders, ledger and the Received step

- **Orders tab:** switch between Preorder batches, Beauty wholesale and Interiors. Website orders arrive by themselves. "+ New order" adds one by hand; "Edit order" changes anything (items, prices, totals, status, date). Beauty and interiors orders are logged when a student taps "Send my order on WhatsApp".
- **Ledger tab:** pick a batch, Beauty wholesale or Interiors. "+ Add entry" records money in, cost of stock, or any expense.
- **Tracker:** a final step 13, "Received", follows "Delivered". Customers can tap "I have received my order" in their account, or you can record it.
- **Logins:** customers log in again after 24 hours. Logging out (or an expired login) clears the saved cart from the device.
