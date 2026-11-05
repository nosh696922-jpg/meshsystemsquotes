# Mesh quoting tool (proof of concept)

Build quotes from the Ubiquiti UK store catalogue plus your own products, add
labour by the hour, write your own scope, and send clients a Mesh-branded
proposal as a web link or PDF.

## Put it online with Vercel

You need a free [Vercel](https://vercel.com) account. It takes about 10 minutes.

1. **Import the project.** In Vercel, click **Add New → Project**, connect your
   GitHub account if asked, and import **meshsystemsquotes**. Leave the settings
   as they are (Framework Preset: *Other*) and click **Deploy**. The first
   deploy will show a “one more setup step” message; that’s expected.
2. **Add a database** (this is where quotes are saved). In the project, open
   **Storage → Create Database** (or *Browse Marketplace*), choose
   **Upstash → Upstash for Redis**, pick the free plan and a London/Europe region,
   and connect it to this project. Vercel adds the connection settings for you.
3. **Set the team password.** Open **Settings → Environment Variables** and add
   `TEAM_PASSWORD` with a long password that you two will share.
4. **Redeploy.** Go to **Deployments**, open the menu (⋯) on the latest one and
   click **Redeploy**, so the new settings take effect.
5. **Open your site** (e.g. `https://meshsystemsquotes.vercel.app`), sign in,
   then go to **Settings** and add your names and company details. The Ubiquiti
   catalogue loads the first time you open the product picker (about 10 seconds).

### Sharing a proposal with a client

Open a quote and click **Copy client link**. Anyone with that link can *view*
the proposal (not edit it, and not see any other quotes), and can save it as a
PDF from their browser. The links are long and random, so they can’t be guessed,
but treat them like a private document: only send them to the client.

Online, **Save as PDF** opens the browser’s print window; choose *Save as PDF*
as the printer.

Copying the link marks the quote as **Sent**. On the link, the client can
**accept** (name, optional PO number, tick to agree), **request changes** or
**decline**. Their reply sets the quote’s status and shows at the top of the
quote and in the quotes list. The **History** tab shows when they opened it
(your team’s own views, and link previews in WhatsApp, email and so on, don’t
count).

### What runs on Vercel

- Quotes, settings and your products are stored in Upstash Redis.
- Ubiquiti prices refresh daily at 5am (a Vercel Cron job), or any time from the
  Products page.
- Your password is only ever stored in Vercel’s environment settings, never in
  this repository.

## Running it on your own computer

You need [Node.js](https://nodejs.org) 18 or newer. There is nothing else to install.

- **Windows:** double-click `Start Mesh Quotes.bat`. It opens http://localhost:3000.
- **Any system:** run `npm start` in this folder, then open http://localhost:3000.

On your own computer, data is kept in the `data/` folder (not uploaded to GitHub),
there's no password unless you set `TEAM_PASSWORD`, and **Download PDF** makes the
PDF directly using Edge or Chrome.

## What it does

- **Ubiquiti catalogue** – about 500 products read from https://uk.store.ui.com,
  with images, options (lengths, colours, pack sizes) and prices excluding VAT.
  Non-UK versions are hidden when a UK version exists.
- **Surcharges** – some Ubiquiti products carry a surcharge (currently “Memory”)
  that the store adds at checkout on top of the listed price. These are included
  in quote prices by default; you can switch that off per quote.
- **Other manufacturers** – add a one-off item while quoting, or save products
  to **Our products** to reuse them.
- **Labour** – Installation, Commissioning, Programming and Project management
  (add more in Settings). Add labour to any product as hours *per unit*, so it
  scales with quantity, or add a standalone labour line to an area.
- **Areas** – group the quote by room or system, each with its own description.
- **Proposal text** – an introduction plus your own sections. Blank line = new
  paragraph, `- ` = bullet, `**bold**`.
- **Pricing** – edit any unit price, apply a markup to store prices, set labour
  rates and VAT per quote. Lines whose store price has changed are flagged.
- **Discounts** – a percentage off any item, and a percentage or fixed amount off
  the whole quote, with your own name for it (e.g. “Package saving”). The
  proposal shows what the client saves.
- **Profit** – a panel only your team sees: profit and margin on equipment and
  labour. Set what labour costs you per hour, and your trade discount off
  Ubiquiti store prices, in Settings; type a cost on any item to override.
- **Kits** – save an area’s items and labour as a kit (e.g. “Standard WiFi
  room”) and add it to any quote in one click from **Add product → Kits**.
- **Versions** – a version is saved when you send the link and when the client
  replies; save your own any time. See what changed since any version, or go
  back to it.
- **Proposal layout** – list every item with prices, or show only what’s in each
  area with one price per area.
- **Two people** – if you both edit the same quote at once, the second person to
  save is warned and can load the other’s changes or keep their own.

## Where things are

| Path | What it is |
| --- | --- |
| `lib/app.js` | All routes; shared by the local server and Vercel |
| `server.js` | Runs the app on your own computer |
| `api/index.js`, `vercel.json` | Runs the app on Vercel |
| `lib/auth.js` | Team password sign-in |
| `lib/store.js`, `lib/storage/` | Saving data (files locally, Upstash online) |
| `lib/catalogues/ubiquiti.js` | Reads the Ubiquiti UK store |
| `lib/proposal.js`, `public/proposal.css` | The client-facing proposal |
| `lib/client.js` | Client views and replies (accept, changes, decline) |
| `lib/revisions.js`, `lib/kits.js` | Saved versions of quotes, and kits |
| `lib/pdf.js` | One-click PDF via Edge/Chrome (local only) |
| `public/app.js`, `public/styles.css` | The quoting app |
| `public/shared/calc.js` | Pricing maths, shared by app and proposal |

## Adding another manufacturer later

Create a file in `lib/catalogues/` that exports `{ id, name, sync() }`, where
`sync()` returns products in the same shape as the Ubiquiti one, then add it to
`SOURCES` in `lib/catalogue.js`.

## Rolling back to an earlier version

Each release is tagged on GitHub (the repo’s **Tags** list):

| Tag | What it is |
| --- | --- |
| `v1` | Before discounts, profit, client replies, view tracking, versions and kits |
| `v2` | Adds those features |
| `v3-before-2-pages` | Lighter, simpler design, still with a full cover page |
| `v3` | Lighter, simpler proposal and PDF design (no dark panels), printing on fewer pages: the cover details sit on page 1, with an optional separate cover page |

- **Quickest, in Vercel:** open the project → **Deployments**, find the deployment
  of the older version, click **⋯** → **Instant Rollback** (or **Promote**). It’s
  live in seconds and the code isn’t changed. Undo it the same way.
- **Permanent, in GitHub:** undo everything after the version you want, e.g.
  `git revert --no-edit v2..HEAD` to go back to `v2` (or `v1..HEAD` for `v1`),
  then `git push`. Vercel then deploys that version. To move forward again,
  revert those reverts.

Rolling back deletes nothing. The older version ignores the newer information
(client replies, views, saved versions, kits, labour costs) and it reappears when
you move forward again. While on `v1`, quotes with a discount show without it,
and a quote marked “Changes requested” shows no status until you pick one.

## Known limits of this proof of concept

- Ubiquiti data is read from the store’s public pages. If Ubiquiti changes their
  site, or blocks requests from Vercel’s servers, the price refresh stops working
  (the last good copy is kept and the Products page shows the error).
- One shared team password, no individual accounts.
- Quotes made on your own computer stay there; the online version starts empty.
- Default labour rates and terms are placeholders – set your own in Settings.
