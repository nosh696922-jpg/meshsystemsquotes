// Crestron catalogue, imported from Crestron's dealer price list (.xlsx).
//
// Crestron lets dealers download a spreadsheet of their products. We read its
// "Alpha Listing" tab: MODEL, DESCRIPTION, "Dealer GBP (£)" (what we pay,
// ex VAT) and "MSRP GBP (£)" (the recommended selling price, ex VAT).
//   - Selling price on quotes = MSRP
//   - Our cost (for the profit figure) = dealer price
// Products marked "Contact for pricing" have no MSRP and are left out.

const { readWorkbook } = require('../xlsx');

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function badFile(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// "£1,096.00" or 1096 -> 109600 pence. Anything else (e.g. "Contact for pricing") -> null.
function pence(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);
  const s = String(value ?? '').replace(/[£,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(s) ? Math.round(parseFloat(s) * 100) : null;
}

// The date on the price list's cover, e.g. "November 5, 2026" -> "2026-11-05".
function coverDate(workbook) {
  const rows = workbook.readSheet('Cover') || [];
  for (const row of rows) {
    for (const cell of row || []) {
      const m = String(cell ?? '').trim().match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
      const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
      if (month >= 0) return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
  }
  return null;
}

// Find the header row and which column holds what.
function findColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map((c) => String(c ?? '').trim().toLowerCase());
    const col = (test) => cells.findIndex((c) => test(c));
    const model = col((c) => c === 'model' || c === 'model number');
    const msrp = col((c) => c.includes('msrp'));
    const dealer = col((c) => c.includes('dealer'));
    if (model >= 0 && msrp >= 0) {
      return {
        headerRow: r,
        model,
        msrp,
        dealer,
        number: col((c) => c === 'number' || c.includes('part')),
        description: col((c) => c.includes('desc')),
      };
    }
  }
  return null;
}

function importFile(buffer, fileName = '') {
  let workbook;
  try {
    workbook = readWorkbook(buffer);
  } catch (err) {
    throw badFile(`Couldn't read that file: ${err.message} Use Crestron's dealer price list (.xlsx).`);
  }
  const sheetName =
    workbook.sheetNames.find((n) => n.trim().toLowerCase() === 'alpha listing') ||
    workbook.sheetNames.find((n) => findColumns(workbook.readSheet(n) || []));
  if (!sheetName) throw badFile('This doesn’t look like Crestron’s price list: there’s no “Alpha Listing” tab with MODEL and MSRP columns.');
  const rows = workbook.readSheet(sheetName);
  const cols = findColumns(rows);
  if (!cols) throw badFile(`Couldn’t find the MODEL and MSRP columns on the “${sheetName}” tab.`);

  const products = [];
  const skipped = [];
  const seen = new Set();
  for (const row of rows.slice(cols.headerRow + 1)) {
    const model = String(row?.[cols.model] ?? '').trim();
    if (!model) continue;
    const msrp = pence(row[cols.msrp]);
    if (msrp == null || msrp <= 0) {
      skipped.push(model);
      continue;
    }
    if (seen.has(model)) continue;
    seen.add(model);
    const dealer = cols.dealer >= 0 ? pence(row[cols.dealer]) : null;
    const number = cols.number >= 0 ? String(row[cols.number] ?? '').trim() : '';
    const description = cols.description >= 0 ? String(row[cols.description] ?? '').trim() : '';
    // Kept compact (1,400+ products): empty fields are left out.
    const product = {
      id: `crestron:${number || model}`,
      manufacturer: 'Crestron',
      source: 'crestron',
      name: `Crestron ${model}`,
      model,
      category: model.split(/[-\s]/)[0] || 'Other', // the model's range, e.g. TSW, DM, HZ2
      price: msrp, // selling price (MSRP), pence ex VAT
      cost: dealer, // what we pay (dealer price), pence ex VAT
      status: 'Available',
      defaultSku: model,
      variants: [{ sku: model, price: msrp, cost: dealer, status: 'Available' }],
    };
    if (number) product.partNumber = number;
    if (description) product.description = description;
    products.push(product);
  }
  if (!products.length) throw badFile('No Crestron products with prices were found in that file.');

  return {
    id: 'crestron',
    name: 'Crestron (dealer price list)',
    sourceUrl: null,
    fileName: String(fileName || '').slice(0, 200),
    priceListDate: coverDate(workbook),
    currency: 'GBP',
    pricesIncludeVat: false,
    fetchedAt: new Date().toISOString(), // when it was imported
    errors: [],
    skipped,
    products,
  };
}

module.exports = {
  id: 'crestron',
  name: 'Crestron (dealer price list)',
  label: 'Crestron',
  tabName: 'Crestron price list',
  importFile,
};
