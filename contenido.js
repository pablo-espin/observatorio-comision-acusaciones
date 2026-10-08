// ── CONTENIDO DINÁMICO (WordPress REST API) ──
// Boletines and comunicados are Documentos on fedecolombia.org. The Observatorio
// tag decides what shows here; the category decides whether it's a boletín or a comunicado.

// Switch to https://fedecolombia.org/wp-json/wp/v2 when going live
const WP_API = 'https://staging.fedecolombia.org/wp-json/wp/v2';

const DOCS_ENDPOINT = 'doc';
const OBS_TAG       = 'observatorio-comision-acusaciones';  // tag slug
const TIPOS = {
  boletin:    { cat: 'boletin-observatorio', label: 'Boletín',    plural: 'boletines' },
  comunicado: { cat: 'comunicado',           label: 'Comunicado', plural: 'comunicados' },
};
const ULTIMAS_LIMIT = 3;

// ── Helpers ──
async function wpFetch(path, params = {}) {
  const url = new URL(`${WP_API}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WP ${res.status} ${url}`);
  return { data: await res.json(), totalPages: +res.headers.get('X-WP-TotalPages') || 1 };
}

// Fetches every page of a collection (100 per request)
async function wpFetchAll(path, params = {}) {
  const first = await wpFetch(path, { ...params, per_page: 100, page: 1 });
  const rest = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, i) =>
      wpFetch(path, { ...params, per_page: 100, page: i + 2 }).then(r => r.data))
  );
  return first.data.concat(...rest);
}

// Term IDs differ between staging and live, so look them up by slug
let termsPromise;
function getTerms() {
  termsPromise ??= Promise.all([
    wpFetch('tags', { slug: OBS_TAG, _fields: 'id' }),
    wpFetch('categories', { slug: Object.values(TIPOS).map(t => t.cat).join(','), _fields: 'id,slug' }),
  ]).then(([tags, cats]) => {
    const catIds = {};
    Object.entries(TIPOS).forEach(([tipo, t]) => {
      const cat = cats.data.find(c => c.slug === t.cat);
      if (cat) catIds[tipo] = cat.id;
    });
    return { tagId: tags.data[0]?.id, catIds };
  });
  return termsPromise;
}

const tipoOf = (item, catIds) =>
  Object.keys(catIds).find(tipo => item.categories?.includes(catIds[tipo]));

const escapeHTML = str => String(str ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// WP titles arrive HTML-encoded (&#8211; etc.); decode to plain text
const decodeHTML = html => new DOMParser().parseFromString(html || '', 'text/html').body.textContent;

// Only http(s) links reach an href
function safeURL(value) {
  try {
    const url = new URL(value, location.href);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

// ACF date picker returns "Ymd" (e.g. 20261003); fall back to the post date
function pubDate(item) {
  const ymd = item.acf?.fecha_publicacion;
  if (ymd && /^\d{8}$/.test(ymd)) {
    return new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
  }
  return new Date(item.date);
}

const formatDate = d => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

const byDateDesc = (a, b) => pubDate(b) - pubDate(a);

// srcset from an ACF image array, so cards don't download the full-size cover
function imgAttrs(img, sizes) {
  if (!img || typeof img !== 'object' || !safeURL(img.url)) return null;
  const candidates = ['medium', 'medium_large', 'large']
    .filter(s => safeURL(img.sizes?.[s]))
    .map(s => `${img.sizes[s]} ${img.sizes[`${s}-width`]}w`);
  candidates.push(`${img.url} ${img.width}w`);
  return `src="${escapeHTML(img.sizes?.medium_large || img.url)}" srcset="${escapeHTML(candidates.join(', '))}" sizes="${sizes}"`;
}

// Cover image, or a plain blue placeholder (comunicados always use it for now)
function coverHTML(item, tipo, sizes, alt = '') {
  const img = tipo === 'comunicado' ? null : imgAttrs(item.acf?.imagen_tarjeta, sizes);
  return img
    ? `<img ${img} alt="${escapeHTML(alt)}" loading="lazy">`
    : `<span class="cover-placeholder" aria-hidden="true">${escapeHTML(TIPOS[tipo].label)}</span>`;
}

function metaHTML(item, tipo) {
  return `
    <p class="pub-card__meta">
      <span class="tag tag--${tipo}">${escapeHTML(TIPOS[tipo].label)}</span>
      <time datetime="${pubDate(item).toISOString().slice(0, 10)}">${formatDate(pubDate(item))}</time>
    </p>`;
}

// Editor HTML with anything executable removed; only YouTube/Vimeo iframes survive
const EMBED_HOSTS = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//i;

function sanitize(html) {
  if (!window.DOMPurify) return '';
  DOMPurify.removeAllHooks();
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'IFRAME' && !EMBED_HOSTS.test(node.getAttribute('src') || '')) {
      node.remove();
    } else if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') || '')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener');
    }
  });
  return DOMPurify.sanitize(html || '', {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'target'],
    FORBID_TAGS: ['style', 'form'],
  });
}

const detailURL = item => `publicacion.html?slug=${encodeURIComponent(item.slug)}`;

// ── Card template ──
function pubCard(item, tipo, sizes) {
  return `
    <a class="pub-card" href="${detailURL(item)}">
      <div class="pub-card__cover">${coverHTML(item, tipo, sizes)}</div>
      <div class="pub-card__body">
        ${metaHTML(item, tipo)}
        <h3 class="pub-card__title">${escapeHTML(decodeHTML(item.title?.rendered))}</h3>
        ${item.acf?.documento_resumen ? `<p class="pub-card__summary">${escapeHTML(item.acf.documento_resumen)}</p>` : ''}
      </div>
    </a>`;
}

const statusMsg = text => `<p class="feed-status" role="status">${escapeHTML(text)}</p>`;

// Every tagged boletín and comunicado, newest first, each with its tipo attached
const LIST_FIELDS = 'id,slug,date,categories,title,acf.fecha_publicacion,acf.documento_resumen,acf.imagen_tarjeta';

async function loadDocs() {
  const { tagId, catIds } = await getTerms();
  if (!tagId || !Object.keys(catIds).length) return [];
  const items = await wpFetchAll(DOCS_ENDPOINT, {
    tags: tagId,
    categories: Object.values(catIds).join(','),
    acf_format: 'standard',
    _fields: LIST_FIELDS,
  });
  return items
    .map(item => ({ item, tipo: tipoOf(item, catIds) }))
    .filter(d => d.tipo)
    .sort((a, b) => byDateDesc(a.item, b.item));
}

// ── Home: últimas publicaciones ──
async function loadUltimas(section) {
  const docs = (await loadDocs()).slice(0, ULTIMAS_LIMIT);
  if (!docs.length) return;
  const carousel = section.querySelector('.carousel');
  carousel.querySelector('.carousel__track').innerHTML =
    docs.map(d => pubCard(d.item, d.tipo, '(max-width: 768px) 80vw, 320px')).join('');
  section.hidden = false;
  initCarousel(carousel);
}

// ── Publicaciones page: one fetch, split into the two sections ──
async function loadRepositorio(grids) {
  let docs;
  try {
    docs = await loadDocs();
  } catch (err) {
    console.error(err);
    grids.forEach(g => { g.innerHTML = statusMsg('No pudimos cargar el contenido. Intente de nuevo más tarde.'); });
    return;
  }
  grids.forEach(grid => {
    const tipo = grid.dataset.tipo;
    const mine = docs.filter(d => d.tipo === tipo);
    grid.innerHTML = mine.length
      ? mine.map(d => pubCard(d.item, tipo, '(max-width: 480px) 90vw, (max-width: 768px) 45vw, 320px')).join('')
      : statusMsg(`Aún no hay ${TIPOS[tipo].plural} publicados.`);
  });
  // Content above the anchor just changed height; land on the right section
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}

// ── Detail page ──
// Boletines: cover, meta, summary and PDF. Comunicados also show the full text.
async function loadDetalle(main) {
  const container = main.querySelector('.container');
  const slug = new URLSearchParams(location.search).get('slug');
  const notFound = () => {
    container.innerHTML = `
      ${statusMsg('No encontramos esta publicación.')}
      <a href="publicaciones.html" class="link-more">Ver todas las publicaciones</a>`;
  };
  if (!slug) return notFound();

  let item, tipo;
  try {
    const { tagId, catIds } = await getTerms();
    if (!tagId) return notFound();
    ({ data: [item] } = await wpFetch(DOCS_ENDPOINT, {
      slug,
      tags: tagId,
      acf_format: 'standard',
      _fields: `${LIST_FIELDS},content,acf.archivo_pdf`,
    }));
    tipo = item && tipoOf(item, catIds);
  } catch (err) {
    console.error(err);
    container.innerHTML = statusMsg('No pudimos cargar la publicación. Intente de nuevo más tarde.');
    return;
  }
  if (!tipo) return notFound();

  const acf = item.acf || {};
  const title = decodeHTML(item.title?.rendered);
  const pdf = safeURL(typeof acf.archivo_pdf === 'string' ? acf.archivo_pdf : acf.archivo_pdf?.url);
  const body = tipo === 'comunicado' ? sanitize(item.content?.rendered).trim() : '';

  document.title = `${title} - Observatorio de la Comisión de Acusaciones`;

  container.innerHTML = `
    <a href="publicaciones.html" class="detalle__back">← Volver a publicaciones</a>
    <div class="detalle__header">
      <div class="detalle__cover">
        ${coverHTML(item, tipo, '(max-width: 768px) 80vw, 340px', acf.imagen_tarjeta?.alt)}
      </div>
      <div class="detalle__intro">
        ${metaHTML(item, tipo)}
        <h1 class="detalle__title">${escapeHTML(title)}</h1>
        ${acf.documento_resumen ? `<p class="detalle__summary">${escapeHTML(acf.documento_resumen)}</p>` : ''}
        ${pdf ? `<a href="${escapeHTML(pdf)}" class="btn-download" target="_blank" rel="noopener" download>Descargar PDF</a>` : ''}
      </div>
    </div>
    ${body ? `<div class="prose">${body}</div>` : ''}`;
}

// ── Boot: each loader runs only if its container is on the page ──
const ultimasSection = document.getElementById('ultimas-publicaciones');
if (ultimasSection) loadUltimas(ultimasSection).catch(console.error);

const repoGrids = document.querySelectorAll('[data-feed="repositorio"]');
if (repoGrids.length) loadRepositorio(repoGrids);

const detalleMain = document.querySelector('[data-feed="detalle"]');
if (detalleMain) loadDetalle(detalleMain);
