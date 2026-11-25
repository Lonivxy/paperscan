'use strict';
const $ = id => document.getElementById(id);

function navigate(url) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    location.href = url;
    return;
  }
  const page = document.querySelector('main');
  page.classList.add('page-leaving');
  setTimeout(() => location.href = url, 200);
}

const parseBarcode = (raw) => window.PaperScanStore.parseBarcode(raw);

function buildPdfUrl(rawUrl, page = null) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  const fragment = Number.isInteger(page) && page > 0 ? `page=${page}` : '';
  try {
    const url = new URL(rawUrl, location.href);
    url.hash = fragment;
    return url.href;
  } catch {
    const base = rawUrl.split('#')[0];
    return fragment ? `${base}#${fragment}` : base;
  }
}

function node(tag, text, cls) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function favoriteAction(code) {
  const button = node('button', null, 'favorite-toggle');
  button.type = 'button';
  const update = () => {
    const active = window.PaperScanStore.isFavorite(code);
    button.textContent = active ? 'Saved' : 'Save paper';
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? `Remove ${code} from favorites` : `Save ${code} to favorites`);
  };
  button.addEventListener('click', () => {
    window.PaperScanStore.toggleFavorite(code);
    update();
  });
  update();
  return button;
}

function resource(url, title, subtitle, cls) {
  const a = node('a', null, 'doc-link ' + (cls || ''));
  a.href = url;
  const t = node('span', title);
  t.append(node('small', subtitle));
  a.append(t, node('span', '↗', 'arrow-icon'));
  return a;
}

async function render() {
  const out = $('resultDetail');
  const barcode = parseBarcode(new URLSearchParams(location.search).get('barcode'));

  if (!barcode) {
    const errRow = node('div', null, 'result-meta-header');
    errRow.append(node('span', 'INVALID BARCODE', 'eyebrow'));
    out.replaceChildren(
      errRow,
      node('h1', "Couldn't read this barcode"),
      node('p', 'Go back and scan the full code that starts with P.')
    );
    return;
  }

  try {
    const data = await fetch('papers.json').then(r => {
      if (!r.ok) throw Error();
      return r.json();
    });
    const paper = data.papers.find(x => x.code === barcode.code);

    if (!paper) {
      const notFoundRow = node('div', null, 'result-meta-header');
      notFoundRow.append(node('span', 'NOT FOUND', 'eyebrow'));
      out.replaceChildren(
        notFoundRow,
        node('h1', 'Not in the index'),
        node('p', barcode.code, 'paper-code'),
        node('p', 'Go back and try again, or check PaperLords / Pearson.')
      );
      return;
    }

    /* Wrap qualification badge and session pill in a flex meta header so they are perfectly aligned */
    const metaHeader = node('div', null, 'result-meta-header');
    metaHeader.append(
      node('span', `${paper.qualification} · ${paper.subject}`, 'eyebrow'),
      node('span', paper.session, 'pill')
    );

    out.replaceChildren(
      metaHeader,
      node('h1', paper.name),
      node('p', `${paper.unit} · ${barcode.code}`, 'paper-code'),
      favoriteAction(paper.code)
    );

    if (barcode.page) {
      const tracker = node('p', `Page ${barcode.page} / ${barcode.total}`, 'page-tracker');
      tracker.dataset.testid = 'page-tracker';
      out.append(tracker);
    }

    const choices = node('div', null, 'choices');
    if (paper.qp) {
      const pageUrl = buildPdfUrl(paper.qp, barcode.page);
      const fullUrl = buildPdfUrl(paper.qp);
      const pageLink = resource(
        pageUrl,
        barcode.page ? `Open page ${barcode.page}` : 'Open paper',
        barcode.page ? 'Scanned page' : 'Question paper',
        'page-choice'
      );
      pageLink.dataset.testid = 'open-page-action';
      choices.append(
        pageLink,
        resource(fullUrl, 'Open full paper', 'From page 1', 'full-choice')
      );
    }
    if (paper.ms) {
      choices.append(resource(buildPdfUrl(paper.ms), 'Open mark scheme', 'Mark scheme', 'ms'));
    }
    if (!paper.qp) {
      out.append(node('p', 'This paper has no PDF link yet.', 'resource-unavailable'));
    }

    out.append(
      choices,
      node('p', `Links from ${paper.source || 'public catalogues'}. Use your browser's back button to return.`, 'download-note')
    );
  } catch {
    const loadErrRow = node('div', null, 'result-meta-header');
    loadErrRow.append(node('span', 'LOAD ERROR', 'eyebrow'));
    out.replaceChildren(
      loadErrRow,
      node('h1', "Couldn't load the result"),
      node('p', 'Check your connection and go back to retry.')
    );
  }
}

render();

document.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || link.target || link.origin !== location.origin) return;
  event.preventDefault();
  navigate(link.href);
});
