# Mesh Quotes

This is the quoting tool I built for Mesh Smart Home Technology. You pick
products from our suppliers' catalogues (Ubiquiti, Sonos, Crestron, Habitech,
NetXL) or add your own, put labour on by the hour, write the scope, and send the
client a proper Mesh-branded proposal as a link or a PDF.

It's still a proof of concept, so there are a few rough edges (see
[Stuff it can't do yet](#stuff-it-cant-do-yet) at the bottom).

## Getting it online (Vercel)

You'll need a free [Vercel](https://vercel.com) account. It takes about 10 minutes.

1. **Import the project.** In Vercel, click **Add New → Project**, connect GitHub
   if it asks, and import **quotetool** (on the meshsystemsuk GitHub account).
   Leave the settings alone (Framework Preset: *Other*) and hit **Deploy**. The
   first deploy shows a “one more setup step” message. That's fine, it's meant to.
   (On Vercel's free plan a private repo only deploys commits made by the
   account that owns it, so commits need to come from meshsystemsuk, or Vercel
   says “Deployment Blocked”.)
2. **Add a database** (it's where the quotes live). In the project, go to
   **Storage → Create Database** (or *Browse Marketplace*), pick
   **Upstash → Upstash for Redis**, the free plan and a London/Europe region, and
   connect it to the project. Vercel adds the connection settings for you.
3. **Set the owner key.** Go to **Settings → Environment Variables** and add
   `TEAM_PASSWORD` with a long password (Production only, **Sensitive** on). It's
   the owner key: it gets you in before anyone has their own login, and it's
   what adds and removes logins, so keep it to whoever runs the business.
4. **Redeploy.** Go to **Deployments**, open the ⋯ menu on the latest one and
   click **Redeploy**, so the new settings kick in.
5. **Open the site** (ours is `https://meshquotes.vercel.app`), sign in with
   the owner key, then go to **Settings** and put in your names and the company
   details. The Ubiquiti catalogue loads the first time you open the product
   picker (about 10 seconds).
6. **Give everyone their own login.** In **Settings → Logins**, click **Add
   login** for each person (use the same name as in **Your team**, so their
   details show on proposals they prepare). **Make one up** makes a strong
   password; give it to them in person. From then on they sign in with their
   email and password.

### Connecting Habitech

Habitech gave us an API key for our trade account (it starts with `hab_live_`).
In Vercel, go to **Settings → Environment Variables**, add `HABITECH_API_KEY`
with the key as the value, tick **Sensitive**, and redeploy. The key stays on
the server, so nobody using the app can see it. Don't ever put it in the code or
send it in a chat or email. If it leaks, just ask Habitech for a new one.

### Connecting NetXL

Make a key in NetXL: **netxl.com → My Account → Trade & API**. It's 64
characters and you only see it once, so copy it straight away. Then in Vercel go
to **Settings → Environment Variables**, add `NETXL_API_KEY` with the key as the
value, tick **Sensitive**, and redeploy. On your own computer it goes in the
`.env` file. Same rules as Habitech: never in the code, a chat or an email. If
it leaks, delete it in NetXL and make a new one.

### Sending a proposal to a client

Open a quote and click **Copy client link**. Anyone with the link can *view*
the proposal (they can't edit it or see any other quotes) and save it as a PDF
from their browser. The links are long and random so nobody's guessing them,
but treat them like a private document and only send them to the client.

Online, **Save as PDF** opens the print window; just pick *Save as PDF* as the
printer.

Copying the link marks the quote as **Sent**. From the link, the client can
**accept** (name, optional PO number, tick to agree), **request changes** or
**decline**. Whatever they pick sets the quote's status and shows at the top of
the quote and in the quotes list. The **History** tab shows when they opened it
(our own views don't count, and neither do link previews in WhatsApp, email and
so on).

While you've got the app open, it pops up a note in the bottom right when a
client opens a proposal (“MESH-0012 opened on a phone”) or replies to it
(“MESH-0012 accepted by Sam Jones”), with an **Open quote** button. It checks
every 45 seconds, so a note can take up to a minute to show. The “opened” ones
go away by themselves after a few seconds; replies stay until you close them.
If the app's in the background, the tab or window title counts them, like
“(2) Mesh Quotes”, and the notes are waiting when you come back. A client
refreshing the page within half an hour doesn't count as opening it again. Only
things that happen while the app's open pop up; for anything older, look at the
quotes list.

### What runs on Vercel

- Quotes, settings and our own products are saved in Upstash Redis.
- The catalogues refresh every night at 5am (a Vercel Cron job), or whenever you
  like from the Products page.
- The password only ever lives in Vercel's environment settings, never in this
  repo.

### Using it like a program

You can install the website as an app, so it gets its own window and icon in
the Start menu and taskbar (or on your phone's home screen). It's the same
website underneath, so the quotes are the same everywhere and it picks up new
versions by itself (if it's already open when one goes live, just reload it).
Nothing to download.

- **Edge or Chrome on a computer:** open the site and go to **Settings → Use it
  like a program → Install app** (or click the install icon at the right of the
  address bar). Right-click the taskbar icon to pin it.
- **iPhone/iPad:** Safari → Share → **Add to Home Screen**.
- **Android:** Chrome → ⋮ → **Add to Home screen**.

To get rid of it, open the app, click ⋯ at the top, then **Uninstall**, or use
Windows Settings → Apps.

### The Windows program (MeshQuotes.exe)

There's a proper Windows program too: **Settings → Use it like a program →
download the Windows program**, or `/download/MeshQuotes.exe` on the site. It's
about 1 MB and there's nothing to install (save it anywhere and double-click
it). It opens the live site (`https://meshquotes.vercel.app`) in its own window
with a dark title bar and the Mesh icon. Like the installed app, it's always the
latest version with the same quotes. Right-click its taskbar icon to pin it.
Copies downloaded before version 1.1 open the old address
(meshsystemsquotes.vercel.app), so download it again.

- It uses Microsoft Edge WebView2, which comes with Windows 10 and 11. If a PC
  hasn't got it, the program offers Microsoft's free download.
- Links to other websites (like store pages) open in your normal browser.
  Proposal previews and PDFs open in a second Mesh Quotes window.
- It isn't signed with a code-signing certificate, so Edge might say it “isn't
  commonly downloaded” (pick **Keep**) and Windows might say it “protected your
  PC” (pick **More info → Run anyway**). A certificate would get rid of those
  warnings.
- Its sign-in and window position are saved in `%LOCALAPPDATA%\Mesh Quotes`.
- The menu from the icon at the top left has **About Mesh Quotes**.

To rebuild it after changing `desktop/MeshQuotes.cs` (only needed if the program
itself changes, not the website):

```
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

This uses the C# compiler that comes with Windows, downloads Microsoft's
WebView2 kit from nuget.org the first time (checked against a fingerprint), and
copies the new `MeshQuotes.exe` into `public\download\`. For testing,
`MeshQuotes.exe --url=http://localhost:3000` opens your local copy instead of
the live site.

## Running it on your own computer

You need [Node.js](https://nodejs.org) 18 or newer. That's it, nothing else to
install.

- **Windows:** double-click `Start Mesh Quotes.bat`. It opens http://localhost:3000.
- **Anything else:** run `npm start` in this folder, then open http://localhost:3000.

On your own computer, the data's kept in the `data/` folder (it never goes up to
GitHub), there's no sign-in unless you set `TEAM_PASSWORD`, and **Download
PDF** makes the PDF straight away using Edge or Chrome.

Private stuff like the Habitech key goes in a file called `.env` in this folder
(copy `.env.example` to start). It never gets uploaded to GitHub.

## What it does

- **Ubiquiti** – about 500 products read from https://uk.store.ui.com, with
  pictures, options (lengths, colours, pack sizes) and prices ex VAT. If there's
  a UK version of something, the non-UK ones are hidden.
- **Surcharges** – some Ubiquiti products have a surcharge (at the moment
  “Memory”) that the store adds at checkout on top of the listed price. They're
  included in quote prices by default, but you can turn that off per quote.
- **Sonos** – about 130 products from the Sonos UK shop
  (sonos.com/en-gb/shop), with pictures and colours. Sonos shows prices with
  VAT, so they're stored ex VAT (÷ 1.2). Refurbished stock is left out. The shop
  doesn't show trade prices, so set our trade discount off Sonos prices (top of
  **Products → Sonos UK shop**, in Settings, or per quote under **Pricing &
  terms**), or type our cost on a line. Refreshes every day, like Ubiquiti.
- **Crestron** – import Crestron's dealer price list (.xlsx) on **Products →
  Crestron price list**. It reads the “Alpha Listing” tab: the MSRP is the
  selling price and the dealer price is our cost (both ex VAT). Anything marked
  “Contact for pricing” is left out. Import a newer list whenever you like;
  quotes keep their prices and show which lines have a new one.
- **Habitech** – our Habitech trade account (about 10,700 products, every brand
  Habitech sells us). The app keeps a copy of the whole list, so **Products →
  Habitech** and **Add product → Habitech** show everything, with a brand filter
  and instant search. The first copy takes about 3 minutes (**Copy full list**,
  or it starts by itself overnight). After that it refreshes every night (new
  and withdrawn products, prices and stock), or hit **Refresh now**. If nothing
  in the list matches a search, it searches Habitech directly. The price is
  Habitech's SRP and our cost is our trade price (both ex VAT), with stock on
  every product. Today's price gets checked when you add a product, and quotes
  check their Habitech lines when you open them, flag any new prices and show
  stock on each line. The client's proposal shows the maker's part number, not
  Habitech's stock code. Anything Habitech hasn't priced for us isn't listed
  (email Habitech to add the brand). Needs the Habitech key (see *Connecting
  Habitech*).
- **NetXL** – our NetXL trade account (about 4,300 networking and phone
  products), read through NetXL's API and copied once a day (or click **Refresh
  prices now** on **Products → NetXL**). The price is NetXL's RRP (or our cost
  if there isn't one) and our cost is our account's price for one unit, both ex
  VAT. Stock and the next delivery date show on each product and on quote lines,
  as of the last copy. NetXL's refurbished stuff counts as graded stock, so
  **Hide graded stock** hides it. Needs the NetXL key (see *Connecting NetXL*).
- **Other manufacturers** – add a one-off item while you're quoting, or save
  products to **Our products** so you can reuse them.
- **Sorting and hiding** – in **Add product** and on the Products page you can
  sort by best match, price (low to high or high to low) or name, and switch on
  **Hide graded stock** (Habitech's “Grade A/B/C” and refurbished items) or
  **Hide out of stock** (sold out at Ubiquiti or Sonos, out of stock at
  Habitech). Each switch shows how many products it's hiding, and each computer
  remembers what you picked.
- **Your own tab order** – drag the catalogue tabs (Ubiquiti, Sonos, NetXL…)
  along the bar in **Add product** or on the Products page, or use **More** (or
  **⋯**) → **Arrange tabs**, which works on phones too. Tabs that don't fit go
  under **More**. Each computer remembers its own order (the same on both
  screens) and opens on the first tab. **Reset to the usual order** puts it back.
- **Our own product names** – give a catalogue product the name clients should
  see, like the Ubiquiti UCG-Max as “Home network router”. Rename a line on a
  quote and click **Always use this name for this product**, or use **Rename**
  on the Products page. From then on it goes onto quotes with that name, with
  any colour or option after it (“Kitchen speaker (White)”), and searching for
  the name finds it. Quotes that already have it keep their name. To show only
  the name on proposals, untick **Manufacturer and model numbers** under
  **Pricing & terms → What the proposal shows**.
- **Habitech basket** – on a quote with Habitech products, click **Add to
  Habitech basket** (on the right of the quote, under the team notes). Tick what
  you want to order and change quantities if you need to (the quote doesn't
  change), then click **Open Habitech basket**. Habitech's website opens in a
  new tab with it all in the basket, on top of anything already there, and you
  check out like normal. Sign in to Habitech in that browser first so you see
  our prices. If the same product's in a few areas, it's ordered as one line.
  Anything Habitech's website doesn't sell (services, custom-made stuff,
  licences) gets listed so you can order it by phone or email. Tip: use the
  quote number as the PO number at checkout.
- **Labour** – Installation, Commissioning, Programming and Project management
  (add more in Settings). Put labour on any product as hours *per unit*, so it
  goes up with the quantity, or add a standalone labour line to an area.
- **Areas** – split the quote up by room or system, each with its own
  description.
- **Proposal text** – an intro plus your own sections. Blank line = new
  paragraph, `- ` = bullet, `**bold**`.
- **Pricing** – change any unit price, put a markup on Ubiquiti store prices,
  and set labour rates and VAT per quote. Lines where the catalogue price has
  changed get flagged.
- **Discounts** – a percentage off any item, and a percentage or fixed amount
  off the whole quote with your own name for it (e.g. “Package saving”). The
  proposal shows the client how much they're saving.
- **Profit** – a panel only we see: profit and margin on equipment and labour.
  Set what labour costs us per hour in Settings, and our trade discounts off
  Ubiquiti and Sonos prices at the top of their tabs on the Products page (or in
  Settings). New quotes use them, and each quote can change them under
  **Pricing & terms**. Crestron, Habitech and NetXL bring their own trade
  prices. Type a cost on any item to override it.
- **Low-margin warning** – any line we'd sell for less than it costs us gets a
  red “Below cost” tag, and any line under the margin in Settings (**Warn when
  a line's margin is under**, 25% to start with) gets an amber one, like “Only
  12% margin”. Click the tag to see our cost. There's a note at the top of the
  quote and in the profit panel too, and **Copy client link** asks “Check the
  margins first?” once before it goes out. Empty the Settings box and only
  below-cost lines get flagged. Lines with no known cost aren't flagged. All of
  it hides when you hide the profit panel, in case a client can see your screen.
- **Cheaper supplier** – if another supplier has the same product (same maker
  part number, e.g. a U7 Pro at the Ubiquiti store and at Habitech), the line
  says so when it'd save us money: “Cheaper at Habitech: £146.70 each, saves us
  £7.30 each”, with stock and a **Switch** button. **Our cost** on a line lists
  every supplier that has it. Switching keeps the client's price the same (the
  **Reset to** link under the price goes to the new supplier's price), and you
  can switch back the same way. It also helps when we don't know a cost, like
  Sonos with no trade discount set: “Habitech has it for £116.89 each”. It
  compares the Ubiquiti store, Sonos, NetXL, Crestron and Habitech (last night's
  copy of Habitech's list), and leaves out refurbished stock and bundles.
- **Kits** – save an area's items and labour as a kit (e.g. “Standard WiFi
  room”) and add it to any quote in one click from **Add product → Kits**.
- **Team notes** – a box on the right of every quote (under the profit panel,
  or near the bottom on a phone) for stuff only we need to know, like a gate
  code, parking or the best time to call. They never show on the proposal, PDF
  or client link, editing them doesn't change the revision number, and going
  back to an earlier version keeps today's notes. Duplicating a quote copies
  them over.
- **Versions** – a version gets saved when you send the link and when the client
  replies, and you can save your own whenever. You can see what's changed since
  any version, or go back to it.
- **Proposal layout** – list every item with prices, or just show what's in each
  area with one price per area. Each area ends with its own labour and services
  (Installation, Commissioning…, with a total for each), or pick “In one section
  after the areas” under **Pricing & terms → What the proposal shows**. A line
  (starting in Mesh blue) separates each area from the next. The **Investment
  summary** only shows the total ex VAT, the VAT and the total inc VAT, plus the
  whole-quote discount (e.g. “Package saving”) if there is one.
- **Front cover** – new proposals start with our cover page (the house at night,
  with the Client, Project, Date and Revision boxes filled in), then the title,
  dates and price at the top of page 2. The boxes get wider for longer names.
  **Revision** counts the different versions sent to the client: 1 for the
  first, 2 once you change it (and send it again), and so on. Copying the link
  again without changing anything doesn't count. To get a small quote onto
  fewer pages, untick **Front cover** under **Pricing & terms → What the
  proposal shows**, or untick it in Settings for all new quotes. Quotes made
  before the front cover keep their old look. The picture,
  `public/img/proposal-cover.jpg`, was made from the designer's
  `mesh-NewFC-210x297.pdf` (300 dpi, without its four white boxes).
- **Developer options** – search the secret word on the **Habitech** tab (in
  **Add product** or on the Products page) and a **Dev** page shows up on that
  computer, with an amber **Dev** link at the top. It shows which version's
  running, where the data's saved, which private settings are set (never what
  they are), when each catalogue last updated and any problems, and the nightly
  job's last results. From there you can test the Habitech and NetXL
  connections, run the nightly job or refresh every catalogue (type **RUN** to
  confirm), download a backup of all the quotes, settings, kits and names
  (download only), and reset what this computer remembers (type **RESET**).
  **Switch off on this computer** hides it again. The word only hides the page:
  anyone signed in can already do all of this, and nothing on it deletes data.
  Only a fingerprint of the word is in the code (`DEV_WORD_HASH` in
  `public/app.js`), because the code's public.
- **Two people at once** – if two of us edit the same quote at the same time,
  whoever saves second gets warned and can load the other person's changes or
  keep their own.
- **Logins** – everyone signs in with their own email and password, and their
  name shows top right. New quotes say they prepared them, and saved versions
  show who made them. **Settings → Logins** lists everyone and when they last
  signed in. Adding someone, giving them a new password or removing them needs
  the owner key (`TEAM_PASSWORD` in Vercel), typed in each time unless you
  signed in with it. Removing someone or giving them a new password signs them
  out straight away (within half a minute on other servers). Anyone can change
  their own password with **Change my password**. Passwords are only ever saved
  scrambled (scrypt, with a different salt for each person), so nobody can read
  them, not even from the database. Wrong guesses count towards the same
  15-minute lockout as signing in. The owner key still works on the sign-in page
  (**Use the owner key instead**) if someone gets locked out.
- **Look** – styled like the Mesh website, with a light and a dark mode (the
  light switch, top right). Animations turn off on devices set to reduce motion.

## Where stuff is

| Path | What it is |
| --- | --- |
| `lib/app.js` | All the routes, used by both the local server and Vercel |
| `server.js` | Runs the app on your own computer |
| `api/index.js`, `vercel.json` | Runs the app on Vercel |
| `lib/auth.js` | Team password sign-in |
| `lib/store.js`, `lib/storage/` | Saving data (files locally, Upstash online) |
| `lib/catalogues/ubiquiti.js` | Reads the Ubiquiti UK store |
| `lib/catalogues/sonos.js` | Reads the Sonos UK shop |
| `lib/catalogues/crestron.js`, `lib/xlsx.js` | Imports Crestron's dealer price list (.xlsx) |
| `lib/catalogues/habitech.js` | Searches Habitech and checks prices through Habitech's API |
| `lib/catalogues/netxl.js` | Copies the NetXL catalogue every day through NetXL's API |
| `lib/env.js`, `.env.example` | Reads private settings from `.env` on your own computer |
| `lib/proposal.js`, `public/proposal.css` | The proposal the client sees |
| `public/img/proposal-cover.jpg` | The proposal's front cover picture |
| `lib/client.js` | Client views and replies (accept, changes, decline) |
| `lib/revisions.js`, `lib/kits.js` | Saved versions of quotes, and kits |
| `lib/names.js` | Our own names for catalogue products |
| `lib/dev.js` | The server side of the Dev page: system info, connection tests, jobs and the backup |
| `lib/habitech-basket.js` | Finds a quote's Habitech products on Habitech's website, for **Add to Habitech basket** |
| `lib/pdf.js` | One-click PDF via Edge/Chrome (only on your own computer) |
| `public/app.js`, `public/styles.css` | The quoting app itself |
| `public/shared/calc.js` | The pricing maths, shared by the app and the proposal |
| `public/shared/mesh-nodes.js` | The moving nodes at the top of each page and on the sign-in page |
| `public/manifest.webmanifest`, `public/img/app-icon-*.png` | Lets the site be installed as an app (name, icon, own window) |
| `desktop/` | The Windows program: `MeshQuotes.cs`, its icon, and `build.ps1`, which builds `public/download/MeshQuotes.exe` |

## Adding another supplier

Make a file in `lib/catalogues/`, then add it to `lib/catalogue.js`:

- **Read from a website** (like `ubiquiti.js`, `sonos.js`): export
  `{ id, name, label, tabName, site, sync() }`, where `sync()` returns products
  in the same shape, and add it to `SOURCES`. It refreshes every day. A supplier
  whose API gives you its whole catalogue quickly (like `netxl.js`) works the
  same way; add `configured()` and `keyName` so it waits until its key is set up.
- **Imported from a price list file** (like `crestron.js`): export
  `{ id, name, label, tabName, importFile(buffer, fileName) }` and add it to
  `IMPORTED`. `lib/xlsx.js` reads Excel files.
- **Read through a supplier's API** (like `habitech.js`, for big catalogues):
  export `{ id, name, label, tabName, configured(), search(q, offset),
  product(sku), prices(skus), status(), startCopy(), continueCopy(job,
  deadline), finishCopy(job), refreshCopy(copy, deadline) }` and add it to
  `LIVE`. The copy's made in chunks that fit inside Vercel's one-minute limit.

The Products page and the product picker get a tab for each one automatically.

## Going back to an older version

Every release has a tag on GitHub (the repo's **Tags** list):

| Tag | What it is |
| --- | --- |
| `v1` | Before discounts, profit, client replies, view tracking, versions and kits |
| `v2` | Adds all of those |
| `v3-before-2-pages` | The lighter, simpler design, still with a full cover page |
| `v3` | Lighter, simpler proposal and PDF design (no dark panels) that prints on fewer pages: the cover details sit on page 1, with an optional separate cover page |
| `v3.1` | Adds “Start again from 0001” in Settings, to reset the quote numbers (and delete all the quotes if you want) after testing |
| `v3.2` | The quoting app restyled to match the Mesh website (navy header, moving nodes at the top of the pages, Inter and Poppins), smoother light/dark switching and animations all over, and no box around tick boxes when you click them |
| `v3.3` | The client proposal in the website's colours (navy top bar and moving nodes on screen; printing stays light), the Labour section only shows each service and its total (no hours or hourly rates), and **Download PDF** works again on your own computer |
| `v4` | More catalogues: Sonos (read every day from the Sonos UK shop) and Crestron (import the dealer price list .xlsx; MSRP = price, dealer = our cost). Markup and trade discount only apply to Ubiquiti now. Going back to `v3.3` hides Sonos and Crestron products, but quote lines already added keep their prices |
| `v4.1` | The Habitech catalogue (search Habitech live with our trade prices and stock; needs `HABITECH_API_KEY` in Vercel), each area's labour at the bottom of that area in proposals, and a Sonos trade discount next to the Ubiquiti one, both at the top of their Products tabs. Going back to `v4` hides Habitech products and puts labour back in one section, but quote lines already added keep their prices |
| `v4.2` | The Habitech tab lists every product (a copy of the whole list, refreshed every night) with a brand filter and instant search, and searches Habitech itself when nothing matches. Today's price is checked when you add a Habitech product. Going back to `v4.1` means search-only again (the saved copy just gets ignored) |
| `v4.3` | Use it like a program: the website can be installed as an app (own window and icon, from **Settings → Use it like a program**), and there's a Windows program, `MeshQuotes.exe`, to download from the same place. Going back to `v4.2` removes the install option and the download, but copies of the program people already have keep working |
| `v4.4` | Sort products by price (low to high, high to low) or name, switches to hide graded and out-of-stock products, and our own names for catalogue products (e.g. the UCG-Max added as “Home network router”). Going back to `v4.3` removes these; quote lines keep the names they were given, and the saved names come back when you move forward again |
| `v4.5` | **Add to Habitech basket** on quotes (tick a quote's Habitech products and open Habitech's website with them in your basket), and the new **front cover** (the house picture with Client, Project, Date and Revision) on new proposals, replacing the old “Separate cover page”. Going back to `v4.4` removes both: proposals start with their title again, and quotes that had the old separate cover page get it back |
| `v4.6` | The NetXL catalogue (needs `NETXL_API_KEY` in Vercel). Proposals get a line between each area, and the investment summary only shows the totals (no equipment and labour breakdown). The Quotes page loses its old “Ubiquiti UK catalogue” subheading. Going back to `v4.5` hides NetXL products (quote lines already added keep their prices) and brings the rest back; nothing's lost |
| `v4.7` | Printed proposals: white page margins even when printed from the Windows program (they were dark navy), no browser date and title line at the top, and the company footer never on a page on its own. Catalogue tabs can be dragged into your own order, with a **More** menu for the ones that don't fit. Going back to `v4.6` brings back the old printing and fixed tabs; the saved tab order just gets ignored |
| `v4.8` | Developer options: a **Dev** page you open by searching a secret word on the Habitech tab (system info, connection tests, run jobs, backup download, reset this computer). Going back to `v4.7` removes it; nothing else changes |
| `v4.9` | **Team notes** on the right of every quote (moved from the bottom of Pricing & terms; never on the proposal, and editing them doesn't change the revision number any more), the right-hand column scrolls on its own when it's taller than the window, and the proposal preview has no “Back to editor” button. Going back to `v4.8` puts the notes box back under Pricing & terms (the notes are kept) and brings the button back |
| `v5` | **Low-margin warning** (lines below cost or under the margin in Settings get flagged, and Copy client link asks you to check them first) and **Cheaper supplier** (lines show when another supplier has the same part for less, with a Switch button that keeps the client's price). The README's rewritten too. Going back to `v4.9` removes both; lines you've already switched stay with their new supplier |
| `v5.1` | **Logins** (everyone signs in with their own email and password; `TEAM_PASSWORD` becomes the owner key that adds and removes them) and **client pop-ups** (a note when a client opens or replies to a proposal while the app's open). Going back to `v5` means everyone signs in with the owner key again (the logins are kept for when you come forward) and the pop-ups stop |
| `v5.2` | The site can't be shown inside another website's frame (stops lookalike pages tricking people into signing in), and the Windows program (version 1.1) opens the new address, `meshquotes.vercel.app`. Going back to `v5.1` allows framing again and puts back the program that opens the old address |

- **Quickest, in Vercel:** open the project → **Deployments**, find the
  deployment of the older version and click **⋯** → **Instant Rollback** (or
  **Promote**). It's live in seconds and the code isn't touched. Undo it the
  same way.
- **For good, in GitHub:** undo everything after the version you want, e.g.
  `git revert --no-edit v2..HEAD` to go back to `v2` (or `v1..HEAD` for `v1`),
  then `git push`. Vercel then deploys that version. To move forward again,
  revert those reverts.

Going back doesn't delete anything. The older version just ignores the newer
stuff (client replies, views, saved versions, kits, labour costs), and it all
comes back when you move forward again. While you're on `v1`, quotes with a
discount show without it, and a quote marked “Changes requested” shows no
status until you pick one.

## Stuff it can't do yet

- Ubiquiti and Sonos are read from their shops' public pages. If either of them
  changes their site, or blocks requests from Vercel's servers, the price
  refresh stops working (the last good copy is kept and the Products page shows
  the error).
- NetXL prices and stock are copied once a day, so the stock on a quote can be
  up to a day old; NetXL's website has the live number.
- The Habitech list is a copy that's refreshed every night, so something
  Habitech added today might not show until tomorrow (search for its exact part
  code and, if the list hasn't got it, the app finds it straight from
  Habitech). If Habitech's API goes down, the copy still works and quote lines
  keep their prices.
- **Add to Habitech basket** uses a link Habitech's website accepts, not their
  API (which can only read, not fill a basket). If Habitech change their
  website it might stop working, but nothing else in the app is affected.
- **Cheaper supplier** only spots a match when both suppliers use the maker's
  part number (Habitech's “mpn”, Ubiquiti's and Sonos's own codes). NetXL only
  gives its own product code, which is usually the maker's, but that hasn't
  been checked against real NetXL data yet (it needs the NetXL key). If two
  suppliers write a code differently it won't spot them.
- Logins aren't in the Dev page backup (on purpose: it never holds passwords),
  so after moving to a new database, add everyone again.
- Quotes made on your own computer stay there; the online version starts empty.
- The default labour rates and terms are just placeholders, so set your own in
  Settings.
