// Quote pricing maths. Shared by the browser (editor) and the server
// (proposal page, quote list) so totals always agree.
//
// All money is stored as whole pence, excluding VAT.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuoteCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const NON_CATALOGUE_SOURCES = ['custom', 'manual'];

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function has(v) {
    return v !== null && v !== undefined && v !== '';
  }

  // A percentage between 0 and 100.
  function pct(v) {
    return Math.min(100, Math.max(0, num(v)));
  }

  // Price from the supplier before any markup (pence).
  function listPrice(item, quote) {
    const base = num(item.basePrice);
    const surcharge = quote.includeSurcharges === false ? 0 : num(item.surcharge);
    return base + surcharge;
  }

  function isCatalogueItem(item) {
    return !NON_CATALOGUE_SOURCES.includes(item.source);
  }

  // Price per unit shown to the client, before any line discount (pence).
  function unitPrice(item, quote) {
    if (has(item.priceOverride)) return Math.round(num(item.priceOverride));
    const list = listPrice(item, quote);
    const markup = isCatalogueItem(item) ? num(quote.markup) : 0;
    return Math.round(list * (1 + markup / 100));
  }

  // What one unit costs us (pence). Internal only, for the profit figure.
  // Catalogue items cost the store price less our trade discount, unless a
  // cost has been typed in. Other items without a cost count at their price.
  function unitCost(item, quote) {
    if (has(item.costPrice)) return Math.round(num(item.costPrice));
    const list = listPrice(item, quote);
    if (isCatalogueItem(item)) return Math.round(list * (1 - pct(quote.costDiscount) / 100));
    return list;
  }

  function costKnown(item) {
    return has(item.costPrice) || isCatalogueItem(item);
  }

  function labourType(quote, typeId) {
    return (quote.labourTypes || []).find((t) => t.id === typeId);
  }

  function labourRate(quote, typeId) {
    const type = labourType(quote, typeId);
    return type ? num(type.rate) : 0;
  }

  // What an hour of this labour costs us, or null if not set. Internal only.
  function labourCostRate(quote, typeId) {
    const type = labourType(quote, typeId);
    return type && has(type.cost) ? num(type.cost) : null;
  }

  function labourName(quote, typeId) {
    const type = labourType(quote, typeId);
    return type ? type.name : typeId;
  }

  // Labour on one line, as [{ type, hours, cost }]. Hours on a product line
  // are per unit, so they scale with quantity.
  function itemLabour(item, quote) {
    if (item.kind === 'labour') {
      const hours = num(item.hours);
      return [{ type: item.type, hours, cost: Math.round(hours * labourRate(quote, item.type)) }];
    }
    const qty = num(item.qty);
    return (item.labour || [])
      .filter((l) => num(l.hours) > 0)
      .map((l) => {
        const hours = num(l.hours) * qty;
        return { type: l.type, hours, cost: Math.round(hours * labourRate(quote, l.type)) };
      });
  }

  // A line's discount applies to its equipment price (not its labour).
  function itemTotals(item, quote) {
    const labour = itemLabour(item, quote);
    const labourCost = labour.reduce((s, l) => s + l.cost, 0);
    const labourHours = labour.reduce((s, l) => s + l.hours, 0);
    if (item.kind === 'labour') {
      return { unit: 0, gross: 0, discount: 0, equipment: 0, labour, labourCost, labourHours, total: labourCost };
    }
    const unit = unitPrice(item, quote);
    const gross = unit * num(item.qty);
    const discount = Math.round((gross * pct(item.discount)) / 100);
    const equipment = gross - discount;
    return { unit, gross, discount, equipment, labour, labourCost, labourHours, total: equipment + labourCost };
  }

  // Discount on the whole quote: a percentage or a fixed amount.
  function quoteDiscount(quote, before) {
    const d = quote.discount || {};
    if (d.type === 'percent') return Math.round((before * pct(d.percent)) / 100);
    if (d.type === 'amount') return Math.min(before, Math.max(0, Math.round(num(d.amount))));
    return 0;
  }

  function discountLabel(quote) {
    const d = quote.discount || {};
    const label = String(d.label || '').trim() || 'Discount';
    return d.type === 'percent' && pct(d.percent) ? `${label} (${pct(d.percent)}%)` : label;
  }

  function quoteTotals(quote) {
    const labourByType = {};
    for (const t of quote.labourTypes || []) labourByType[t.id] = { id: t.id, name: t.name, rate: num(t.rate), hours: 0, cost: 0 };

    let equipment = 0;
    let labour = 0;
    let lineDiscounts = 0;
    let equipmentCost = 0;
    let labourInternal = 0;
    let missingCost = 0;
    let missingLabourHours = 0;
    const sections = (quote.sections || []).map((section) => {
      let sEquipment = 0;
      let sLabour = 0;
      let sHours = 0;
      for (const item of section.items || []) {
        const t = itemTotals(item, quote);
        sEquipment += t.equipment;
        sLabour += t.labourCost;
        sHours += t.labourHours;
        lineDiscounts += t.discount;
        if (item.kind !== 'labour') {
          equipmentCost += unitCost(item, quote) * num(item.qty);
          if (!costKnown(item) && num(item.qty) > 0) missingCost += 1;
        }
        for (const l of t.labour) {
          if (!labourByType[l.type]) labourByType[l.type] = { id: l.type, name: labourName(quote, l.type), rate: labourRate(quote, l.type), hours: 0, cost: 0 };
          labourByType[l.type].hours += l.hours;
          labourByType[l.type].cost += l.cost;
          const costRate = labourCostRate(quote, l.type);
          if (costRate === null) missingLabourHours += l.hours;
          else labourInternal += Math.round(l.hours * costRate);
        }
      }
      equipment += sEquipment;
      labour += sLabour;
      return { id: section.id, name: section.name, equipment: sEquipment, labour: sLabour, hours: sHours, total: sEquipment + sLabour };
    });

    const beforeDiscount = equipment + labour;
    const discount = quoteDiscount(quote, beforeDiscount);
    const subtotal = beforeDiscount - discount;
    const vatRate = num(quote.vatRate);
    const vat = Math.round((subtotal * vatRate) / 100);
    const labourHours = Object.values(labourByType).reduce((s, l) => s + l.hours, 0);
    const cost = equipmentCost + labourInternal;
    const profit = subtotal - cost;
    return {
      equipment,
      labour,
      labourHours,
      labourByType: Object.values(labourByType),
      sections,
      beforeDiscount,
      discount,
      discountLabel: discountLabel(quote),
      lineDiscounts,
      savings: lineDiscounts + discount,
      subtotal,
      vatRate,
      vat,
      total: subtotal + vat,
      // Internal only: what the job costs us and what we make on it.
      equipmentCost,
      labourInternalCost: labourInternal,
      missingCost,
      missingLabourHours,
      cost,
      equipmentProfit: equipment - equipmentCost,
      labourProfit: labour - labourInternal,
      profit,
      margin: subtotal > 0 ? (profit / subtotal) * 100 : 0,
    };
  }

  // Last day the prices hold, as YYYY-MM-DD.
  function validUntil(quote) {
    if (!quote.date) return '';
    const d = new Date(`${quote.date}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + (Number(quote.validDays) || 0));
    return d.toISOString().slice(0, 10);
  }

  function isExpired(quote, today = new Date().toISOString().slice(0, 10)) {
    const until = validUntil(quote);
    return Boolean(until) && today > until;
  }

  const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  function money(pence) {
    return gbp.format(num(pence) / 100);
  }

  function hours(h) {
    const n = Math.round(num(h) * 100) / 100;
    return `${n % 1 === 0 ? n.toFixed(0) : String(n)} hr${n === 1 ? '' : 's'}`;
  }

  return {
    listPrice,
    unitPrice,
    unitCost,
    costKnown,
    isCatalogueItem,
    labourRate,
    labourCostRate,
    labourName,
    itemLabour,
    itemTotals,
    quoteTotals,
    validUntil,
    isExpired,
    money,
    hours,
  };
});
