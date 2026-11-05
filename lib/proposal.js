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

// A moment in UK time, e.g. "5 November 2026 at 14:03".
function formatMoment(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  return `${date} at ${time}`;
}

function lines(...parts) {
  return parts
    .flatMap((p) => String(p || '').split('\n'))
    .map((p) => p.trim())
    .filter(Boolean)
    .map(esc)
    .join('<br>');
}

function pctText(n) {
  const v = Math.round(Number(n) * 100) / 100;
  return `${v}%`;
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
  const discountNote = t.discount ? `<div class="line-disc">${esc(pctText(item.discount))} off</div>` : '';

  return `
      <tr class="item${labourRows ? ' has-labour' : ''}">
        ${display.showImages ? `<td class="img">${item.image ? `<img src="${esc(item.image)}" alt="">` : '<div class="no-img" aria-hidden="true"></div>'}</td>` : ''}
        <td class="desc">
          <div class="name">${esc(item.name)}</div>
          ${display.showSku && sku ? `<div class="sku">${esc(sku)}</div>` : ''}
          ${item.description ? `<div class="text">${esc(item.description)}</div>` : ''}
        </td>
        <td class="qty">${esc(item.qty)}</td>
        ${priceCols ? `<td class="num">${calc.money(t.unit)}${discountNote}</td><td class="num total">${t.discount ? `<s>${calc.money(t.gross)}</s>` : ''}${calc.money(t.equipment)}</td>` : ''}
      </tr>${labourRows}`;
}

function areaTotalsLine(section, sectionTotals) {
  return `
    <div class="area-total">
      <span class="grand">${esc(section.name || 'Area')} total <b>${calc.money(sectionTotals.total)}</b></span>
    </div>`;
}

// "Area totals only" layout: what's included, without a price on every line.
function renderSummarySection(section, sectionTotals, quote) {
  const items = section.items || [];
  const products = items.filter((i) => i.kind !== 'labour' && Number(i.qty) > 0);
  const labourHours = {};
  for (const item of items) {
    for (const l of calc.itemLabour(item, quote)) labourHours[l.type] = (labourHours[l.type] || 0) + l.hours;
  }
  const labour = Object.entries(labourHours).filter(([, h]) => h > 0);
  return `
    <section class="area summary-area">
      <div class="area-intro">
        <h3>${esc(section.name || 'Area')}</h3>
        ${section.description ? `<div class="area-desc rich">${richText(section.description)}</div>` : ''}
      </div>
      ${
        products.length || labour.length
          ? `<ul class="included">
        ${products.map((i) => `<li><span class="q">${esc(i.qty)} ×</span> ${esc(i.name)}</li>`).join('')}
        ${labour.map(([type, h]) => `<li class="lab"><span class="q">${esc(calc.hours(h))}</span> ${esc(calc.labourName(quote, type))}</li>`).join('')}
      </ul>`
          : ''
      }
      ${items.length ? areaTotalsLine(section, sectionTotals) : ''}
    </section>`;
}

function renderSection(section, sectionTotals, quote, display) {
  const items = section.items || [];
  if (!items.length && !section.description) return '';
  if (display.layout === 'summary') return renderSummarySection(section, sectionTotals, quote);
  const priceCols = display.showItemPrices;
  const colCount = (display.showImages ? 1 : 0) + 2 + (priceCols ? 2 : 0);

  return `
    <section class="area">
      <div class="area-intro">
        <h3>${esc(section.name || 'Area')}</h3>
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
            <td colspan="${colCount}">${areaTotalsLine(section, sectionTotals)}</td>
          </tr>
        </tfoot>
      </table>`
          : ''
      }
    </section>`;
}

const REPLY_TEXT = {
  accept: 'accepted',
  changes: 'requested changes to',
  decline: 'declined',
};

// Banner at the top of the web view once the client has replied.
function replyBanner(quote, justReplied) {
  const r = quote.clientResponse;
  if (!r) return '';
  const current = { accept: 'accepted', changes: 'changes', decline: 'declined' }[r.action] === quote.status;
  if (!current) return '';
  const firstName = esc(String(r.name).split(' ')[0]);
  let text;
  if (r.action === 'accept') {
    text = justReplied === 'accept'
      ? `Thank you, ${firstName}. Your acceptance has been sent to us and we'll be in touch to arrange the next steps.`
      : `This proposal was accepted by ${esc(r.name)} on ${esc(formatMoment(r.at))}.`;
  } else if (r.action === 'changes') {
    text = justReplied === 'changes'
      ? `Thanks, ${firstName}. We've received your request and will send you an updated proposal.`
      : `${esc(r.name)} requested changes on ${esc(formatMoment(r.at))}. An updated proposal is on its way.`;
  } else {
    text = justReplied === 'decline'
      ? `Thanks for letting us know, ${firstName}. If anything changes, just get in touch.`
      : `This proposal was declined on ${esc(formatMoment(r.at))}.`;
  }
  return `<div class="reply-banner ${esc(r.action)}" role="status"><span class="rb-mark" aria-hidden="true"></span><span>${text}</span></div>`;
}

function acceptanceSection(quote, totals, company, { print, canAccept, expired, validUntil }) {
  const r = quote.clientResponse;
  if (quote.status === 'accepted' && r && r.action === 'accept') {
    return `
    <section class="block keep accept">
      <h2>Acceptance</h2>
      <div class="accepted-record">
        <span class="ar-mark" aria-hidden="true"></span>
        <div>
          <strong>Accepted online by ${esc(r.name)}</strong>
          <div>${esc(formatMoment(r.at))}${r.po ? ` · Purchase order ${esc(r.po)}` : ''}</div>
          <div class="ar-total">Total accepted: ${calc.money(r.total)} including VAT</div>
        </div>
      </div>
    </section>`;
  }

  const signGrid = `
      <p>To go ahead, please sign below and return a copy to us${company.email ? ` at ${esc(company.email)}` : ''}.</p>
      <div class="sign-grid">
        <div><span>Name</span></div>
        <div><span>Signature</span></div>
        <div><span>Date</span></div>
        <div><span>Purchase order (if applicable)</span></div>
      </div>`;

  if (print || !canAccept) {
    return `<section class="block keep accept"><h2>Acceptance</h2>${signGrid}</section>`;
  }

  const forms = `
      <form class="respond-form" data-action="accept" hidden>
        <h3>Accept this proposal</h3>
        <div class="rf-grid">
          <label><span>Your full name</span><input name="name" required maxlength="120" autocomplete="name"></label>
          <label><span>Email <small>(optional)</small></span><input name="email" type="email" maxlength="160" autocomplete="email"></label>
          <label><span>Purchase order number <small>(optional)</small></span><input name="po" maxlength="60"></label>
        </div>
        <label class="rf-check"><input type="checkbox" name="agree" required> <span>I accept this proposal for <b>${calc.money(totals.total)}</b> including VAT, and the terms above.</span></label>
        <div class="rf-error" role="alert"></div>
        <div class="rf-buttons"><button type="submit" class="r-btn primary">Accept proposal</button><button type="button" class="r-btn ghost" data-close>Cancel</button></div>
      </form>
      <form class="respond-form" data-action="changes" hidden>
        <h3>Request changes</h3>
        <div class="rf-grid">
          <label><span>Your name</span><input name="name" required maxlength="120" autocomplete="name"></label>
          <label><span>Email <small>(optional)</small></span><input name="email" type="email" maxlength="160" autocomplete="email"></label>
        </div>
        <label class="rf-wide"><span>What would you like changed?</span><textarea name="message" rows="4" required maxlength="2000"></textarea></label>
        <div class="rf-error" role="alert"></div>
        <div class="rf-buttons"><button type="submit" class="r-btn primary">Send request</button><button type="button" class="r-btn ghost" data-close>Cancel</button></div>
      </form>
      <form class="respond-form" data-action="decline" hidden>
        <h3>Decline this proposal</h3>
        <div class="rf-grid">
          <label><span>Your name</span><input name="name" required maxlength="120" autocomplete="name"></label>
        </div>
        <label class="rf-wide"><span>Anything you'd like to tell us? <small>(optional)</small></span><textarea name="message" rows="3" maxlength="2000"></textarea></label>
        <div class="rf-error" role="alert"></div>
        <div class="rf-buttons"><button type="submit" class="r-btn danger">Decline proposal</button><button type="button" class="r-btn ghost" data-close>Cancel</button></div>
      </form>`;

  return `
    <section class="block keep accept" id="respond">
      <h2>Acceptance</h2>
      <div class="respond-ui">
        ${
          expired
            ? `<p class="expired-note">This proposal was valid until ${esc(formatDate(validUntil))}. Prices may have changed since then, so please ask us for an updated proposal.</p>
        <div class="respond-actions"><button type="button" class="r-btn primary" data-open="changes">Request an updated proposal</button></div>`
            : `<p>Happy to go ahead? You can accept online in a few seconds, or ask us to change something first.</p>
        <div class="respond-actions">
          <button type="button" class="r-btn primary" data-open="accept">Accept proposal</button>
          <button type="button" class="r-btn" data-open="changes">Request changes</button>
          <button type="button" class="r-btn ghost" data-open="decline">Decline</button>
        </div>`
        }
        ${forms}
      </div>
      <div class="print-only">${signGrid}</div>
    </section>`;
}

const RESPOND_SCRIPT = `
<script>
(function () {
  var forms = document.querySelectorAll('.respond-form');
  function open(action) {
    var target = null;
    forms.forEach(function (f) { var match = f.getAttribute('data-action') === action; f.hidden = !match; if (match) target = f; });
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var first = target.querySelector('input, textarea');
    if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 350);
  }
  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function (e) { e.preventDefault(); open(b.getAttribute('data-open')); });
  });
  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { b.closest('form').hidden = true; });
  });
  forms.forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var button = form.querySelector('[type=submit]');
      var error = form.querySelector('.rf-error');
      var label = button.textContent;
      var data = { action: form.getAttribute('data-action') };
      ['name', 'email', 'po', 'message'].forEach(function (k) { if (form.elements[k]) data[k] = form.elements[k].value; });
      if (form.elements.agree) data.agree = form.elements.agree.checked;
      error.textContent = '';
      button.disabled = true;
      button.textContent = 'Sending…';
      fetch(location.pathname.replace(/\\/$/, '') + '/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
        });
      }).then(function () {
        location.replace(location.pathname + '?done=' + data.action);
      }).catch(function (err) {
        error.textContent = err.message;
        button.disabled = false;
        button.textContent = label;
      });
    });
  });
})();
</script>`;

function renderProposal(quote, settings, { print = false, autoPrint = false, editorLink = true, pdfDirect = true, justReplied = '' } = {}) {
  const company = settings.company || {};
  const display = { ...(settings.display || {}), ...(quote.display || {}) };
  const totals = calc.quoteTotals(quote);
  const client = quote.client || {};
  const preparer = (settings.team || []).find((m) => m.name === quote.preparedBy) || { name: quote.preparedBy };
  const validUntil = calc.validUntil(quote);
  const expired = calc.isExpired(quote);
  const scope = (quote.scope || []).filter((s) => String(s.body || '').trim());
  const sectionsHtml = (quote.sections || [])
    .map((s, i) => renderSection(s, totals.sections[i], quote, display))
    .join('');
  const labourRows = totals.labourByType.filter((l) => l.hours > 0);
  const footerLine = [company.name, quote.number].filter(Boolean).join(' · ');
  const canAccept = quote.status !== 'accepted';
  const showAcceptButton = !print && canAccept && !expired;

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
<style>@page { @bottom-left { content: "${esc(footerLine).replace(/"/g, '')}"; } }${display.coverPage ? ' @page :first { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }' : ''}</style>
</head>
<body class="${print ? 'print-mode' : 'web-mode'}">
${
  print
    ? ''
    : `<div class="toolbar">
  <div class="tb-left">
    <img class="tb-logo" src="/img/mesh-logo-white.png" alt="${esc(company.name)}">
    ${editorLink ? `<a class="tb-back" href="/#/quote/${esc(quote.id)}">&larr; Back to editor</a>` : ''}
  </div>
  <div class="tb-actions">
    ${
      pdfDirect
        ? `<button type="button" class="tb-print" onclick="window.print()">Print</button>
    <a class="${showAcceptButton ? '' : 'tb-primary'}" href="/p/${esc(quote.id)}/pdf" target="_blank" rel="noopener">Download PDF</a>`
        : `<button type="button" class="${showAcceptButton ? '' : 'tb-primary'}" onclick="window.print()" title="In the print window, choose “Save as PDF” as the printer">Save as PDF<span class="tb-long"> / Print</span></button>`
    }
    ${showAcceptButton ? `<a class="tb-primary tb-accept" href="#respond" data-open="accept">Accept</a>` : ''}
  </div>
</div>
${replyBanner(quote, justReplied)}`
}
${
  autoPrint
    ? `<script>window.addEventListener('load', function () { (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () { setTimeout(function () { window.print(); }, 300); }); });</script>`
    : ''
}
<main class="doc">

  <section class="cover ${display.coverPage ? 'cover-page' : 'cover-header'}">
    ${print ? '' : '<canvas class="cover-mesh" aria-hidden="true"></canvas>'}
    <div class="cover-top">
      <img class="cover-logo" src="/img/mesh-logo-dark.png" alt="${esc(company.name)}">
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
      <div><span>Investment</span><b class="investment-figure">${calc.money(totals.subtotal)}</b> <small>+ VAT</small></div>
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

    ${sectionsHtml ? `<section class="block"><h2>${display.layout === 'summary' ? 'What’s included' : 'Equipment &amp; services'}</h2>${sectionsHtml}</section>` : ''}

    ${
      labourRows.length
        ? `<section class="block keep">
      <h2>Labour</h2>
      <table class="summary-table">
        <thead><tr><th>Service</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${labourRows.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${calc.money(l.cost)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td>Total labour</td><td class="num">${calc.money(totals.labour)}</td></tr></tfoot>
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
          ${totals.discount ? `<div class="disc"><span>${esc(totals.discountLabel)}</span><b>−${calc.money(totals.discount)}</b></div>` : ''}
          <div class="sep"><span>Subtotal (excl. VAT)</span><b>${calc.money(totals.subtotal)}</b></div>
          <div><span>VAT at ${esc(totals.vatRate)}%</span><b>${calc.money(totals.vat)}</b></div>
        </div>
        <div class="inv-total">
          <span>Total including VAT</span>
          <strong>${calc.money(totals.total)}</strong>
          ${totals.savings ? `<em>You save ${calc.money(totals.savings)} + VAT</em>` : ''}
        </div>
      </div>
    </section>

    ${quote.terms && quote.terms.trim() ? `<section class="block terms"><h2>Terms</h2><div class="rich">${richText(quote.terms.split('\n').filter((l) => l.trim()).map((l) => (/^\s*[-*•]/.test(l) ? l : `- ${l}`)).join('\n'))}</div></section>` : ''}

    ${acceptanceSection(quote, totals, company, { print, canAccept, expired, validUntil })}

    <footer class="doc-footer">
      <img src="/img/mesh-logo-dark.png" alt="">
      <div>
        <strong>${esc(company.name)}</strong><br>
        ${company.address ? `${lines(company.address)}<br>` : ''}
        ${[company.phone, company.email, company.website].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}
        ${company.companyNumber || company.vatNumber ? `<br>${[company.companyNumber ? `Company no. ${esc(company.companyNumber)}` : '', company.vatNumber ? `VAT no. ${esc(company.vatNumber)}` : ''].filter(Boolean).join(' &nbsp;·&nbsp; ')}` : ''}
      </div>
    </footer>
  </section>
</main>
${print ? '' : RESPOND_SCRIPT}
${print ? '' : `<script src="/shared/mesh-nodes.js"></script>
<script>if (window.MeshNodes) MeshNodes.attach(document.querySelector('.cover-mesh'));</script>`}
</body>
</html>`;
}

module.exports = { renderProposal, richText };
