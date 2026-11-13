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

### Connecting Habitech

Habitech gives us an API key for our trade account (it starts `hab_live_`).
In Vercel, open **Settings → Environment Variables**, add `HABITECH_API_KEY`
with the key as its value, tick **Sensitive**, and redeploy. The key stays on
the server; nobody using the app can see it. Never put it in the code or send
it in chat or email. If it leaks, ask Habitech for a new one.

### Connecting NetXL

Make an API key in NetXL: **netxl.com → My Account → Trade & API** (it's 64
characters and shown only once). In Vercel, open **Settings → Environment
Variables**, add `NETXL_API_KEY` with the key as its value, tick **Sensitive**,
and redeploy. On your own computer, put it in the `.env` file. Never put it in
the code or send it in chat or email. If it leaks, delete it in NetXL and make a
new one.

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

### Using it like a program (desktop app)

The website can be installed as an app, with its own window and icon in the
Start menu and taskbar (the home screen on a phone). It's the same website
underneath, so the quotes are the same everywhere and it updates itself when a
new version goes live. Nothing needs downloading.

- **Edge or Chrome on a computer:** open the website, go to **Settings → Use it
  like a program → Install app**. (Or use the install icon at the right of the
  address bar.) Right-click the icon in the taskbar to pin it.
- **iPhone/iPad:** Safari → Share → **Add to Home Screen**.
- **Android:** Chrome → ⋮ → **Add to Home screen**.

To remove it, open the app, click ⋯ at the top, then **Uninstall**, or use
Windows Settings → Apps.

### The Windows program (MeshQuotes.exe)

There's also a real Windows program: **Settings → Use it like a program →
download the Windows program**, or `/download/MeshQuotes.exe` on the website.
It's about 1 MB, needs no installing (save it anywhere, double-click it), and
opens the live website in its own window with a dark title bar and the Mesh
icon. Like the installed app, it always shows the latest version and the same
quotes. Right-click its taskbar icon to pin it.

- It uses Microsoft Edge WebView2, which is part of Windows 10 and 11. On a PC
  without it, the program offers Microsoft's free download.
- Links to other websites (store pages) open in your normal browser. Proposal
  previews and PDFs open in a second Mesh Quotes window.
- It isn't signed with a code-signing certificate, so Edge may say it "isn't
  commonly downloaded" (choose **Keep**) and Windows may say it "protected your
  PC" (choose **More info → Run anyway**). A certificate would remove those
  warnings.
- Its sign-in and window position are kept in `%LOCALAPPDATA%\Mesh Quotes`.
- The menu from the icon at the top left has **About Mesh Quotes**.

To rebuild it after changing `desktop/MeshQuotes.cs` (only needed if the
program itself changes, not the website):

```
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

This uses the C# compiler that comes with Windows, downloads Microsoft's
WebView2 kit from nuget.org the first time (checked against a fingerprint), and
copies the new `MeshQuotes.exe` to `public\download\`. For testing,
`MeshQuotes.exe --url=http://localhost:3000` opens your own copy instead of the
website.

## Running it on your own computer

You need [Node.js](https://nodejs.org) 18 or newer. There is nothing else to install.

- **Windows:** double-click `Start Mesh Quotes.bat`. It opens http://localhost:3000.
- **Any system:** run `npm start` in this folder, then open http://localhost:3000.

On your own computer, data is kept in the `data/` folder (not uploaded to GitHub),
there's no password unless you set `TEAM_PASSWORD`, and **Download PDF** makes the
PDF directly using Edge or Chrome.

Private settings such as the Habitech key go in a file called `.env` in this
folder (copy `.env.example`). It is never uploaded to GitHub.

## What it does

- **Ubiquiti catalogue** – about 500 products read from https://uk.store.ui.com,
  with images, options (lengths, colours, pack sizes) and prices excluding VAT.
  Non-UK versions are hidden when a UK version exists.
- **Surcharges** – some Ubiquiti products carry a surcharge (currently “Memory”)
  that the store adds at checkout on top of the listed price. These are included
  in quote prices by default; you can switch that off per quote.
- **Sonos catalogue** – about 130 products read from the Sonos UK shop
  (sonos.com/en-gb/shop), with pictures and colour options. Sonos shows prices
  including VAT; they're stored ex VAT (÷ 1.2). Refurbished stock is left out.
  The shop doesn't show trade prices, so set our trade discount off Sonos
  prices (top of **Products → Sonos UK shop**, in Settings, or per quote under
  **Pricing & terms**), or type our cost on a line. Refreshes daily, like
  Ubiquiti.
- **Crestron catalogue** – import Crestron's dealer price list (.xlsx) on
  **Products → Crestron price list**. The “Alpha Listing” tab is read: the
  MSRP is the selling price and the dealer price is our cost (both ex VAT).
  Products marked “Contact for pricing” are left out. Import a newer list any
  time; quotes keep their prices and show which lines have a new one.
- **Habitech catalogue** – our Habitech trade account (about 10,700 products,
  every brand Habitech sells us). The app keeps a copy of the whole list, so
  **Products → Habitech** and **Add product → Habitech** show everything, with a
  brand filter and instant search. The first copy takes about 3 minutes
  (**Copy full list**; it also starts by itself overnight); after that it
  refreshes every night (new and withdrawn products, prices and stock), or click
  **Refresh now**. If nothing in the list matches a search, the app searches
  Habitech directly. The price is Habitech's SRP and our cost is our trade price
  (both ex VAT), with stock on each product. Today's price is checked when you
  add a product, and quotes check their Habitech lines when you open them, flag
  any new price, and show stock on each line. The client's proposal shows the
  maker's part number, not Habitech's stock code. Products Habitech hasn't
  priced for us aren't listed (email Habitech to add the brand). Needs the
  Habitech API key (see *Connecting Habitech*).
- **NetXL catalogue** – our NetXL trade account (about 4,300 networking and
  phone products), read through NetXL's API and copied once a day (or click
  **Refresh prices now** on **Products → NetXL**). The price is NetXL's RRP (our
  cost where it has none) and our cost is our account's price for one unit,
  both ex VAT. Stock and the next delivery date show on each product and on
  quote lines, as of the last copy. NetXL's refurbished products count as
  graded stock, so **Hide graded stock** hides them. Needs the NetXL API key
  (see *Connecting NetXL*).
- **Other manufacturers** – add a one-off item while quoting, or save products
  to **Our products** to reuse them.
- **Sorting and hiding** – in **Add product** and on the Products page, sort by
  best match, price (low to high or high to low) or name, and switch on
  **Hide graded stock** (Habitech's “Grade A/B/C” and refurbished items) or
  **Hide out of stock** (sold out at Ubiquiti or Sonos, out of stock at
  Habitech). Each switch shows how many products it hides, and each computer
  remembers the choices.
- **Our own product names** – give a catalogue product the name clients
  should see, e.g. the Ubiquiti UCG-Max as “Home network router”. Rename a line
  on a quote and click **Always use this name for this product**, or use
  **Rename** on the Products page. From then on it's added to quotes with that
  name, with any colour or option after it (“Kitchen speaker (White)”), and
  searching for the name finds it. Quotes that already have it keep their
  name. To show only the name on proposals, untick **Manufacturer and model
  numbers** under **Pricing & terms → What the proposal shows**.
- **Habitech basket** – on a quote with Habitech products, click **Add to
  Habitech basket** (under the profit panel). Tick what to order and change
  quantities if you need to (the quote isn't changed), then click **Open
  Habitech basket**. Habitech's website opens in a new tab with them in your
  basket, added to anything already there, and you check out as normal. Sign
  in to Habitech in that browser first to see our prices. The same product in
  several areas is ordered as one line. Products Habitech's website doesn't sell
  (services, custom-made items, licences) are listed to order by phone or
  email. Tip: use the quote number as the PO number at checkout.
- **Labour** – Installation, Commissioning, Programming and Project management
  (add more in Settings). Add labour to any product as hours *per unit*, so it
  scales with quantity, or add a standalone labour line to an area.
- **Areas** – group the quote by room or system, each with its own description.
- **Proposal text** – an introduction plus your own sections. Blank line = new
  paragraph, `- ` = bullet, `**bold**`.
- **Pricing** – edit any unit price, apply a markup to Ubiquiti store prices, set
  labour rates and VAT per quote. Lines whose catalogue price has changed are
  flagged.
- **Discounts** – a percentage off any item, and a percentage or fixed amount off
  the whole quote, with your own name for it (e.g. “Package saving”). The
  proposal shows what the client saves.
- **Profit** – a panel only your team sees: profit and margin on equipment and
  labour. Set what labour costs you per hour in Settings, and your trade
  discounts off Ubiquiti and Sonos prices at the top of their tabs on the
  Products page (or in Settings). New quotes use them; each quote can change
  them under **Pricing & terms**. Crestron and Habitech bring their own trade
  prices. Type a cost on any item to override.
- **Kits** – save an area’s items and labour as a kit (e.g. “Standard WiFi
  room”) and add it to any quote in one click from **Add product → Kits**.
- **Versions** – a version is saved when you send the link and when the client
  replies; save your own any time. See what changed since any version, or go
  back to it.
- **Proposal layout** – list every item with prices, or show only what’s in each
  area with one price per area. Each area ends with its own labour and services
  (Installation, Commissioning…, with a total for each), or choose “In one
  section after the areas” under **Pricing & terms → What the proposal shows**.
  A line (starting in Mesh blue) separates each area from the next. The
  **Investment summary** shows only the total excluding VAT, the VAT and the
  total including VAT, plus the whole-quote discount (e.g. “Package saving”)
  when there is one.
- **Front cover** – new proposals start with our cover page (the house at
  night, with the Client, Project, Date and Revision boxes filled in), then
  the title, dates and price at the top of page 2. The boxes widen to fit
  longer names. **Revision** counts the different versions sent to the
  client: 1 for the first, 2 once you change it (and re-send it), and so on;
  copying the link again without changes doesn't count. To fit a small quote on
  fewer pages, untick **Front cover** under **Pricing & terms → What the
  proposal shows**; for all new quotes, untick it in Settings. Quotes made
  before the front cover keep their old look. The picture,
  `public/img/proposal-cover.jpg`, was made from the designer's
  `mesh-NewFC-210x297.pdf` (300 dpi, without its four white boxes).
- **Two people** – if you both edit the same quote at once, the second person to
  save is warned and can load the other’s changes or keep their own.
- **Look** – styled like the Mesh website, with a light and a dark mode (the
  light switch, top right). Animations switch off on devices set to reduce motion.

## Where things are

| Path | What it is |
| --- | --- |
| `lib/app.js` | All routes; shared by the local server and Vercel |
| `server.js` | Runs the app on your own computer |
| `api/index.js`, `vercel.json` | Runs the app on Vercel |
| `lib/auth.js` | Team password sign-in |
| `lib/store.js`, `lib/storage/` | Saving data (files locally, Upstash online) |
| `lib/catalogues/ubiquiti.js` | Reads the Ubiquiti UK store |
| `lib/catalogues/sonos.js` | Reads the Sonos UK shop |
| `lib/catalogues/crestron.js`, `lib/xlsx.js` | Imports Crestron’s dealer price list (.xlsx) |
| `lib/catalogues/habitech.js` | Searches Habitech and checks prices through Habitech’s API |
| `lib/catalogues/netxl.js` | Copies the NetXL catalogue daily through NetXL’s API |
| `lib/env.js`, `.env.example` | Reads private settings from `.env` on your own computer |
| `lib/proposal.js`, `public/proposal.css` | The client-facing proposal |
| `public/img/proposal-cover.jpg` | The proposal's front cover picture |
| `lib/client.js` | Client views and replies (accept, changes, decline) |
| `lib/revisions.js`, `lib/kits.js` | Saved versions of quotes, and kits |
| `lib/names.js` | Our own names for catalogue products |
| `lib/habitech-basket.js` | Finds a quote's Habitech products on Habitech's website, for **Add to Habitech basket** |
| `lib/pdf.js` | One-click PDF via Edge/Chrome (local only) |
| `public/app.js`, `public/styles.css` | The quoting app |
| `public/shared/calc.js` | Pricing maths, shared by app and proposal |
| `public/shared/mesh-nodes.js` | The moving nodes at the top of each page and on the sign-in page |
| `public/manifest.webmanifest`, `public/img/app-icon-*.png` | Lets the site be installed as an app (name, icon, own window) |
| `desktop/` | The Windows program: `MeshQuotes.cs`, its icon, and `build.ps1`, which builds `public/download/MeshQuotes.exe` |

## Adding another manufacturer later

Create a file in `lib/catalogues/`, then list it in `lib/catalogue.js`:

- **Read from a website** (like `ubiquiti.js`, `sonos.js`): export
  `{ id, name, label, tabName, site, sync() }`, where `sync()` returns products
  in the same shape, and add it to `SOURCES`. It refreshes daily. A supplier
  whose API returns its whole catalogue quickly (like `netxl.js`) works the same
  way; add `configured()` and `keyName` so it waits until its key is set up.
- **Imported from a price list file** (like `crestron.js`): export
  `{ id, name, label, tabName, importFile(buffer, fileName) }` and add it to
  `IMPORTED`. `lib/xlsx.js` reads Excel files.
- **Read through a supplier's API** (like `habitech.js`, for big catalogues):
  export `{ id, name, label, tabName, configured(), search(q, offset),
  product(sku), prices(skus), status(), startCopy(), continueCopy(job,
  deadline), finishCopy(job), refreshCopy(copy, deadline) }` and add it to
  `LIVE`. The copy is made in chunks that fit Vercel's one-minute limit.

The Products page and the product picker show a tab for each one automatically.

## Rolling back to an earlier version

Each release is tagged on GitHub (the repo’s **Tags** list):

| Tag | What it is |
| --- | --- |
| `v1` | Before discounts, profit, client replies, view tracking, versions and kits |
| `v2` | Adds those features |
| `v3-before-2-pages` | Lighter, simpler design, still with a full cover page |
| `v3` | Lighter, simpler proposal and PDF design (no dark panels), printing on fewer pages: the cover details sit on page 1, with an optional separate cover page |
| `v3.1` | Adds “Start again from 0001” in Settings, to reset quote numbers (and optionally delete all quotes) after testing |
| `v3.2` | The quoting app restyled to match the Mesh website (navy header, page tops with moving nodes, Inter and Poppins), smoother light/dark switching and animations throughout, and no box around clicked tick boxes |
| `v3.3` | The client proposal in the website’s colours (navy top bar and moving nodes on screen; printing stays light), the Labour section shows only each service and its total (no hours or hourly rates), and **Download PDF** works again on your own computer |
| `v4` | More catalogues: Sonos (read daily from the Sonos UK shop) and Crestron (import the dealer price list .xlsx; MSRP = price, dealer = our cost). Markup and trade discount now apply to Ubiquiti only. Rolling back to `v3.3` hides Sonos and Crestron products, but quote lines already added keep their prices |
| `v4.1` | Habitech catalogue (search Habitech live with our trade prices and stock; needs `HABITECH_API_KEY` in Vercel), each area’s labour shown at the bottom of that area in proposals, and a Sonos trade discount alongside the Ubiquiti one, both at the top of their Products tabs. Rolling back to `v4` hides Habitech products and puts labour back in one section, but quote lines already added keep their prices |
| `v4.2` | The Habitech tab lists every product (a copy of the whole list, refreshed nightly) with a brand filter and instant search, falling back to searching Habitech when nothing matches. Today’s price is checked when you add a Habitech product. Rolling back to `v4.1` goes back to search-only (the saved copy is simply ignored) |
| `v4.3` | Use it like a program: the website can be installed as an app (own window and icon, from **Settings → Use it like a program**), and a Windows program, `MeshQuotes.exe`, can be downloaded from the same place. Rolling back to `v4.2` removes the install option and the download, but copies of the program people already have keep working |
| `v4.4` | Sort products by price (low to high, high to low) or name, switches to hide graded stock and out-of-stock products, and our own names for catalogue products (e.g. UCG-Max added as “Home network router”). Rolling back to `v4.3` removes these; quote lines keep the names they were given, and the saved names come back when you move forward again |
| `v4.5` | **Add to Habitech basket** on quotes (tick a quote's Habitech products and open Habitech's website with them in your basket), and the new **front cover** (the house picture with Client, Project, Date and Revision) on new proposals, replacing the old "Separate cover page". Rolling back to `v4.4` removes both: proposals start with their title again, and quotes that had the old separate cover page get it back |
| `v4.6` | The NetXL catalogue (needs `NETXL_API_KEY` in Vercel). Proposals: a line between each area, and the investment summary shows only the totals (no equipment and labour breakdown). The Quotes page loses its old “Ubiquiti UK catalogue” subheading. Rolling back to `v4.5` hides NetXL products (quote lines already added keep their prices) and brings the rest back; nothing is lost |

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

- Ubiquiti and Sonos data is read from their shops’ public pages. If either
  changes their site, or blocks requests from Vercel’s servers, the price refresh
  stops working (the last good copy is kept and the Products page shows the error).
- NetXL prices and stock are copied once a day, so stock shown on a quote can
  be up to a day old; NetXL's website has the live figure.
- The Habitech list is a copy, refreshed nightly, so a product added to
  Habitech today may not be listed until tomorrow (search for its exact part
  code and, if the list has no match, the app finds it straight from Habitech). If Habitech’s API is down, the copy still works
  and quote lines keep their prices.
- **Add to Habitech basket** uses a link that Habitech's website accepts, not
  Habitech's API (which can only read, not fill a basket). If Habitech change
  their website it may stop working; nothing else in the app is affected.
- One shared team password, no individual accounts.
- Quotes made on your own computer stay there; the online version starts empty.
- Default labour rates and terms are placeholders – set your own in Settings.
