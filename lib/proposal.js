// Renders a quote as a client-facing proposal (HTML). The same page is used
// for the shareable web view and, via headless Edge/Chrome, for the PDF.

const calc = require('../public/shared/calc');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Light formatting for text the team writes: blank line = new paragraph,
// lines starting with "- " or "* " = bullet points, **bold**.
function richText(text) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  return blocks
    .filter((b) => b.trim())
    .map((block) => {
      const lines = block.split('\n');
      const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      // Mixed block: paragraph lines then bullets.
      let html = '';
      let list = [];
      let para = [];
      const flushPara = () => {
        if (para.length) html += `<p>${para.map(inline).join('<br>')}</p>`;
        para = [];
      };
      const flushList = () => {
        if (list.length) html += `<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`;
        list = [];
      };
      for (const line of lines) {
        if (/^\s*[-*•]\s+/.test(line)) {
          flushPara();
          list.push(line.replace(/^\s*[-*•]\s+/, ''));
        } else {
          flushList();
          para.push(line);
        }
      }
      flushPara();
      flushList();
      return html;
    })
    .join('');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

function lines(...parts) {
  return parts
    .flatMap((p) => String(p || '').split('\n'))
    .map((p) => p.trim())
    .filter(Boolean)
    .map(esc)
    .join('<br>');
}

function renderItemRows(item, quote, display) {
  const t = calc.itemTotals(item, quote);
  const priceCols = display.showItemPrices;

  if (item.kind === 'labour') {
    const name = calc.labourName(quote, item.type);
    return `
      <tr class="item labour-line">
        ${display.showImages ? '<td class="img"><div class="labour-icon" aria-hidden="true"></div></td>' : ''}
        <td class="desc">
          <div class="name">${esc(name)}</div>
          ${item.description ? `<div class="text">${esc(item.description)}</div>` : ''}
        </td>
        <td class="qty">${esc(calc.hours(item.hours))}</td>
        ${priceCols ? `<td class="num">${calc.money(calc.labourRate(quote, item.type))}/hr</td><td class="num total">${calc.money(t.total)}</td>` : ''}
      </tr>`;
  }

  const sku = [item.manufacturer, item.sku || item.model].filter(Boolean).join(' · ');
  const labourRows =
    display.showLabourDetail && t.labour.length
      ? t.labour
          .map(
            (l) => `
      <tr class="sub-labour">
        ${display.showImages ? '<td></td>' : ''}
        <td class="desc">${esc(calc.labourName(quote, l.type))}</td>
        <td class="qty">${esc(calc.hours(l.hours))}</td>
        ${priceCols ? `<td class="num">${calc.money(calc.labourRate(quote, l.type))}/hr</td><td class="num total">${calc.money(l.cost)}</td>` : ''}
      </tr>`,
          )
          .join('')
      : '';

  return `
      <tr class="item${labourRows ? ' has-labour' : ''}">
        ${display.showImages ? `<td class="img">${item.image ? `<img src="${esc(item.image)}" alt="">` : '<div class="no-img" aria-hidden="true"></div>'}</td>` : ''}
        <td class="desc">
          <div class="name">${esc(item.name)}</div>
          ${display.showSku && sku ? `<div class="sku">${esc(sku)}</div>` : ''}
          ${item.description ? `<div class="text">${esc(item.description)}</div>` : ''}
        </td>
        <td class="qty">${esc(item.qty)}</td>
        ${priceCols ? `<td class="num">${calc.money(t.unit)}</td><td class="num total">${calc.money(t.equipment)}</td>` : ''}
      </tr>${labourRows}`;
}

function renderSection(section, sectionTotals, quote, display) {
  const items = section.items || [];
  if (!items.length && !section.description) return '';
  const priceCols = display.showItemPrices;
  const colCount = (display.showImages ? 1 : 0) + 2 + (priceCols ? 2 : 0);

  return `
    <section class="area">
      <div class="area-intro">
        <h3><span class="dot" aria-hidden="true"></span>${esc(section.name || 'Area')}</h3>
        ${section.description ? `<div class="area-desc rich">${richText(section.description)}</div>` : ''}
      </div>
      ${
        items.length
          ? `<table class="items">
        <thead>
          <tr>
            ${display.showImages ? '<th class="img"></th>' : ''}
            <th>Item</th>
            <th class="qty">Qty</th>
            ${priceCols ? '<th class="num">Unit</th><th class="num">Total</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => renderItemRows(item, quote, display)).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="${colCount}">
              <div class="area-total">
                ${sectionTotals.equipment ? `<span>Equipment <b>${calc.money(sectionTotals.equipment)}</b></span>` : ''}
                ${sectionTotals.labour ? `<span>Labour <b>${calc.money(sectionTotals.labour)}</b></span>` : ''}
                <span class="grand">${esc(section.name || 'Area')} total <b>${calc.money(sectionTotals.total)}</b></span>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>`
          : ''
      }
    </section>`;
}

function renderProposal(quote, settings, { print = false, autoPrint = false, editorLink = true, pdfDirect = true } = {}) {
  const company = settings.company || {};
  const display = { ...(settings.display || {}), ...(quote.display || {}) };
  const totals = calc.quoteTotals(quote);
  const client = quote.client || {};
  const preparer = (settings.team || []).find((m) => m.name === quote.preparedBy) || { name: quote.preparedBy };
  const validUntil = addDays(quote.date, quote.validDays);
  const scope = (quote.scope || []).filter((s) => String(s.body || '').trim());
  const sectionsHtml = (quote.sections || [])
    .map((s, i) => renderSection(s, totals.sections[i], quote, display))
    .join('');
  const labourRows = totals.labourByType.filter((l) => l.hours > 0);
  const footerLine = [company.name, quote.number].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(quote.number)} · ${esc(quote.title)} · ${esc(company.name)}</title>
<link rel="icon" href="/img/favicon.png">
<link rel="stylesheet" href="/proposal.css">
<style>@page { @bottom-left { content: "${esc(footerLine).replace(/"/g, '')}"; } }</style>
</head>
<body class="${print ? 'print-mode' : 'web-mode'}">
${
  print
    ? ''
    : `<div class="toolbar">
  ${editorLink ? `<a class="tb-back" href="/#/quote/${esc(quote.id)}">&larr; Back to editor</a>` : `<span class="tb-brand">${esc(company.name)}</span>`}
  <div class="tb-actions">
    ${
      pdfDirect
        ? `<button type="button" onclick="window.print()">Print</button>
    <a class="tb-primary" href="/p/${esc(quote.id)}/pdf" target="_blank" rel="noopener">Download PDF</a>`
        : `<button type="button" class="tb-primary" onclick="window.print()" title="In the print window, choose “Save as PDF” as the printer">Save as PDF / Print</button>`
    }
  </div>
</div>`
}
${
  autoPrint
    ? `<script>window.addEventListener('load', function () { (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () { setTimeout(function () { window.print(); }, 300); }); });</script>`
    : ''
}
<main class="doc">

  <section class="cover">
    <div class="cover-top">
      <img class="cover-logo" src="/img/mesh-logo-white.png" alt="${esc(company.name)}">
      <div class="cover-tag">${esc(company.tagline || '')}</div>
    </div>
    <div class="cover-main">
      <div class="eyebrow">Proposal ${esc(quote.number)}</div>
      <h1>${esc(quote.title)}</h1>
      ${client.company || client.name ? `<div class="cover-client">Prepared for ${esc(client.company || client.name)}</div>` : ''}
    </div>
    <div class="cover-meta">
      <div><span>Date</span>${esc(formatDate(quote.date))}</div>
      ${validUntil ? `<div><span>Valid until</span>${esc(formatDate(validUntil))}</div>` : ''}
      ${preparer.name ? `<div><span>Prepared by</span>${esc(preparer.name)}</div>` : ''}
      <div><span>Investment</span>${calc.money(totals.subtotal)} <small>+ VAT</small></div>
    </div>
  </section>

  <section class="page-flow">
    <div class="parties">
      <div>
        <h4>Prepared for</h4>
        <p>${lines(client.name, client.company !== client.name ? client.company : '', client.address, client.email, client.phone) || '—'}</p>
        ${quote.siteAddress ? `<h4>Site</h4><p>${lines(quote.siteAddress)}</p>` : ''}
      </div>
      <div>
        <h4>Prepared by</h4>
        <p>${lines(preparer.name, preparer.role, company.name, preparer.email || company.email, preparer.phone || company.phone)}</p>
      </div>
    </div>

    ${quote.intro && quote.intro.trim() ? `<section class="block"><h2>Introduction</h2><div class="rich">${richText(quote.intro)}</div></section>` : ''}

    ${scope.map((s) => `<section class="block"><h2>${esc(s.heading || '')}</h2><div class="rich">${richText(s.body)}</div></section>`).join('')}

    ${sectionsHtml ? `<section class="block"><h2>Equipment &amp; services</h2>${sectionsHtml}</section>` : ''}

    ${
      labourRows.length
        ? `<section class="block keep">
      <h2>Labour</h2>
      <table class="summary-table">
        <thead><tr><th>Service</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${labourRows
            .map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${esc(calc.hours(l.hours))}</td><td class="num">${calc.money(l.rate)}/hr</td><td class="num">${calc.money(l.cost)}</td></tr>`)
            .join('')}
        </tbody>
        <tfoot><tr><td>Total labour</td><td class="num">${esc(calc.hours(totals.labourHours))}</td><td></td><td class="num">${calc.money(totals.labour)}</td></tr></tfoot>
      </table>
    </section>`
        : ''
    }

    <section class="block keep">
      <h2>Investment summary</h2>
      <div class="investment">
        <div class="inv-rows">
          <div><span>Equipment</span><b>${calc.money(totals.equipment)}</b></div>
          <div><span>Labour</span><b>${calc.money(totals.labour)}</b></div>
          <div class="sep"><span>Subtotal (excl. VAT)</span><b>${calc.money(totals.subtotal)}</b></div>
          <div><span>VAT at ${esc(totals.vatRate)}%</span><b>${calc.money(totals.vat)}</b></div>
        </div>
        <div class="inv-total">
          <span>Total including VAT</span>
          <strong>${calc.money(totals.total)}</strong>
        </div>
      </div>
    </section>

    ${quote.terms && quote.terms.trim() ? `<section class="block terms"><h2>Terms</h2><div class="rich">${richText(quote.terms.split('\n').filter((l) => l.trim()).map((l) => (/^\s*[-*•]/.test(l) ? l : `- ${l}`)).join('\n'))}</div></section>` : ''}

    <section class="block keep accept">
      <h2>Acceptance</h2>
      <p>To go ahead, please sign below and return a copy to us${company.email ? ` at ${esc(company.email)}` : ''}.</p>
      <div class="sign-grid">
        <div><span>Name</span></div>
        <div><span>Signature</span></div>
        <div><span>Date</span></div>
        <div><span>Purchase order (if applicable)</span></div>
      </div>
    </section>

    <footer class="doc-footer">
      <img src="/img/mesh-logo.png" alt="">
      <div>
        <strong>${esc(company.name)}</strong><br>
        ${company.address ? `${lines(company.address)}<br>` : ''}
        ${[company.phone, company.email, company.website].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}
        ${company.companyNumber || company.vatNumber ? `<br>${[company.companyNumber ? `Company no. ${esc(company.companyNumber)}` : '', company.vatNumber ? `VAT no. ${esc(company.vatNumber)}` : ''].filter(Boolean).join(' &nbsp;·&nbsp; ')}` : ''}
      </div>
    </footer>
  </section>
</main>
</body>
</html>`;
}

module.exports = { renderProposal, richText };
