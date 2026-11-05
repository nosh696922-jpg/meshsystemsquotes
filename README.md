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
| `lib/pdf.js` | One-click PDF via Edge/Chrome (local only) |
| `public/app.js`, `public/styles.css` | The quoting app |
| `public/shared/calc.js` | Pricing maths, shared by app and proposal |

## Adding another manufacturer later

Create a file in `lib/catalogues/` that exports `{ id, name, sync() }`, where
`sync()` returns products in the same shape as the Ubiquiti one, then add it to
`SOURCES` in `lib/catalogue.js`.

## Known limits of this proof of concept

- Ubiquiti data is read from the store’s public pages. If Ubiquiti changes their
  site, or blocks requests from Vercel’s servers, the price refresh stops working
  (the last good copy is kept and the Products page shows the error).
- One shared team password, no individual accounts.
- Quotes made on your own computer stay there; the online version starts empty.
- Default labour rates and terms are placeholders – set your own in Settings.
