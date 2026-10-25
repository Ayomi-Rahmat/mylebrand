# MYLEBRAND Order Tracker

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
