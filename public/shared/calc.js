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

  // Price from the supplier before any markup (pence).
  function listPrice(item, quote) {
    const base = num(item.basePrice);
    const surcharge = quote.includeSurcharges === false ? 0 : num(item.surcharge);
    return base + surcharge;
  }

  function isCatalogueItem(item) {
    return !NON_CATALOGUE_SOURCES.includes(item.source);
  }

  // Price per unit shown to the client (pence).
  function unitPrice(item, quote) {
    if (item.priceOverride !== null && item.priceOverride !== undefined && item.priceOverride !== '') {
      return Math.round(num(item.priceOverride));
    }
    const list = listPrice(item, quote);
    const markup = isCatalogueItem(item) ? num(quote.markup) : 0;
    return Math.round(list * (1 + markup / 100));
  }

  function labourRate(quote, typeId) {
    const type = (quote.labourTypes || []).find((t) => t.id === typeId);
    return type ? num(type.rate) : 0;
  }

  function labourName(quote, typeId) {
    const type = (quote.labourTypes || []).find((t) => t.id === typeId);
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

  function itemTotals(item, quote) {
    const labour = itemLabour(item, quote);
    const labourCost = labour.reduce((s, l) => s + l.cost, 0);
    const labourHours = labour.reduce((s, l) => s + l.hours, 0);
    if (item.kind === 'labour') {
      return { unit: 0, equipment: 0, labour, labourCost, labourHours, total: labourCost };
    }
    const unit = unitPrice(item, quote);
    const equipment = unit * num(item.qty);
    return { unit, equipment, labour, labourCost, labourHours, total: equipment + labourCost };
  }

  function quoteTotals(quote) {
    const labourByType = {};
    for (const t of quote.labourTypes || []) labourByType[t.id] = { id: t.id, name: t.name, rate: num(t.rate), hours: 0, cost: 0 };

    let equipment = 0;
    let labour = 0;
    let costPrice = 0;
    const sections = (quote.sections || []).map((section) => {
      let sEquipment = 0;
      let sLabour = 0;
      let sHours = 0;
      for (const item of section.items || []) {
        const t = itemTotals(item, quote);
        sEquipment += t.equipment;
        sLabour += t.labourCost;
        sHours += t.labourHours;
        if (item.kind !== 'labour') costPrice += (item.costPrice != null && item.costPrice !== '' ? num(item.costPrice) : listPrice(item, quote)) * num(item.qty);
        for (const l of t.labour) {
          if (!labourByType[l.type]) labourByType[l.type] = { id: l.type, name: labourName(quote, l.type), rate: labourRate(quote, l.type), hours: 0, cost: 0 };
          labourByType[l.type].hours += l.hours;
          labourByType[l.type].cost += l.cost;
        }
      }
      equipment += sEquipment;
      labour += sLabour;
      return { id: section.id, equipment: sEquipment, labour: sLabour, hours: sHours, total: sEquipment + sLabour };
    });

    const subtotal = equipment + labour;
    const vatRate = num(quote.vatRate);
    const vat = Math.round((subtotal * vatRate) / 100);
    const labourHours = Object.values(labourByType).reduce((s, l) => s + l.hours, 0);
    return {
      equipment,
      labour,
      labourHours,
      labourByType: Object.values(labourByType),
      sections,
      subtotal,
      vatRate,
      vat,
      total: subtotal + vat,
      // Internal only: supplier price of the equipment, for a rough margin.
      equipmentCost: costPrice,
    };
  }

  const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  function money(pence) {
    return gbp.format(num(pence) / 100);
  }

  function hours(h) {
    const n = Math.round(num(h) * 100) / 100;
    return `${n % 1 === 0 ? n.toFixed(0) : String(n)} hr${n === 1 ? '' : 's'}`;
  }

  return { listPrice, unitPrice, isCatalogueItem, labourRate, labourName, itemLabour, itemTotals, quoteTotals, money, hours };
});
