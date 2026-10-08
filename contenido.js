// ── CONTENIDO DINÁMICO (WordPress REST API) ──
// Publicaciones/boletines come from the obs_publicacion post type;
// comunicados are Documentos in "Comunicado de prensa" carrying the Observatorio tag.

// Switch to https://fedecolombia.org/wp-json/wp/v2 when going live
const WP_API = 'https://staging.fedecolombia.org/wp-json/wp/v2';

const PUBS_ENDPOINT      = 'observatorio-publicaciones';
const COMUNICADOS_CAT    = 'comunicado';                         // category slug
const COMUNICADOS_TAG    = 'observatorio-comision-acusaciones';  // tag slug
const COMUNICADOS_LIMIT  = 6;
const ULTIMAS_LIMIT      = 3;

const TIPO_LABEL = { publicacion: 'Publicación', boletin: 'Boletín' };

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

const escapeHTML = str => String(str ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// WP titles arrive HTML-encoded (&#8211; etc.); decode to plain text
const decodeHTML = html => new DOMParser().parseFromString(html || '', 'text/html').body.textContent;

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
  if (!img || typeof img !== 'object') return null;
  const candidates = ['medium', 'medium_large', 'large']
    .filter(s => img.sizes?.[s])
    .map(s => `${img.sizes[s]} ${img.sizes[`${s}-width`]}w`);
  candidates.push(`${img.url} ${img.width}w`);
  return `src="${escapeHTML(img.sizes?.medium_large || img.url)}" srcset="${escapeHTML(candidates.join(', '))}" sizes="${sizes}"`;
}

// Keeps editor HTML but drops anything executable
const EMBED_HOSTS = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//i;
const URL_ATTRS = /^(href|src|action|formaction|xlink:href|poster|data)$/;
const BAD_URL = /^\s*(javascript|vbscript|data):/i;

function sanitize(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script, style, object, embed, form, link, meta, base').forEach(el => el.remove());
  doc.querySelectorAll('iframe').forEach(el => {
    if (!EMBED_HOSTS.test(el.getAttribute('src') || '')) el.remove();
  });
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || (URL_ATTRS.test(name) && BAD_URL.test(attr.value))) {
        el.removeAttribute(attr.name);
      }
    });
    if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '')) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
    }
  });
  return doc.body.innerHTML;
}

const detailURL = item => `publicacion.html?slug=${encodeURIComponent(item.slug)}`;

// ── Card templates ──
function pubCard(item, sizes) {
  const tipo = item.acf?.tipo_publicacion;
  const img = imgAttrs(item.acf?.imagen_tarjeta, sizes);
  return `
    <a class="pub-card" href="${detailURL(item)}">
      <div class="pub-card__cover">
        ${img ? `<img ${img} alt="" loading="lazy">` : ''}
      </div>
      <div class="pub-card__body">
        <p class="pub-card__meta">
          <span class="tag tag--${escapeHTML(tipo)}">${escapeHTML(TIPO_LABEL[tipo] || 'Publicación')}</span>
          <time datetime="${pubDate(item).toISOString().slice(0, 10)}">${formatDate(pubDate(item))}</time>
        </p>
        <h3 class="pub-card__title">${escapeHTML(decodeHTML(item.title?.rendered))}</h3>
        ${item.acf?.documento_resumen ? `<p class="pub-card__summary">${escapeHTML(item.acf.documento_resumen)}</p>` : ''}
      </div>
    </a>`;
}

function comunicadoCard(item) {
  return `
    <a class="com-card" href="${escapeHTML(item.link)}" target="_blank" rel="noopener">
      <p class="com-card__meta">
        <span class="tag tag--comunicado">Comunicado</span>
        <time datetime="${pubDate(item).toISOString().slice(0, 10)}">${formatDate(pubDate(item))}</time>
      </p>
      <h3 class="com-card__title">${escapeHTML(decodeHTML(item.title?.rendered))}</h3>
      ${item.acf?.documento_resumen ? `<p class="com-card__summary">${escapeHTML(item.acf.documento_resumen)}</p>` : ''}
      <span class="com-card__more">Leer comunicado</span>
    </a>`;
}

const statusMsg = text => `<p class="feed-status" role="status">${escapeHTML(text)}</p>`;

// List fields only: leaves out the full content to keep responses small
const LIST_PARAMS = { acf_format: 'standard', _fields: 'id,slug,date,title,acf' };

// ── Home: últimas publicaciones ──
async function loadUltimas(section) {
  const items = (await wpFetchAll(PUBS_ENDPOINT, LIST_PARAMS)).sort(byDateDesc).slice(0, ULTIMAS_LIMIT);
  if (!items.length) return;
  const carousel = section.querySelector('.carousel');
  carousel.querySelector('.carousel__track').innerHTML =
    items.map(i => pubCard(i, '(max-width: 768px) 80vw, 320px')).join('');
  section.hidden = false;
  initCarousel(carousel);
}

// ── Home: comunicados ──
async function loadComunicados(section) {
  const [cats, tags] = await Promise.all([
    wpFetch('categories', { slug: COMUNICADOS_CAT, _fields: 'id' }),
    wpFetch('tags', { slug: COMUNICADOS_TAG, _fields: 'id' }),
  ]);
  if (!cats.data.length || !tags.data.length) return;
  const { data: items } = await wpFetch('doc', {
    categories: cats.data[0].id,
    tags: tags.data[0].id,
    per_page: COMUNICADOS_LIMIT,
    acf_format: 'standard',
    _fields: 'id,date,link,title,acf.fecha_publicacion,acf.documento_resumen',
  });
  if (!items.length) return;
  const carousel = section.querySelector('.carousel');
  carousel.querySelector('.carousel__track').innerHTML = items.map(comunicadoCard).join('');
  section.hidden = false;
  initCarousel(carousel);
}

// ── Publicaciones page: one fetch, split into the two sections ──
async function loadRepositorio(grids) {
  let items;
  try {
    items = (await wpFetchAll(PUBS_ENDPOINT, LIST_PARAMS)).sort(byDateDesc);
  } catch (err) {
    console.error(err);
    grids.forEach(g => { g.innerHTML = statusMsg('No pudimos cargar el contenido. Intente de nuevo más tarde.'); });
    return;
  }
  grids.forEach(grid => {
    const tipo = grid.dataset.tipo;
    const mine = items.filter(i => (i.acf?.tipo_publicacion || 'publicacion') === tipo);
    grid.innerHTML = mine.length
      ? mine.map(i => pubCard(i, '(max-width: 480px) 90vw, (max-width: 768px) 45vw, 320px')).join('')
      : statusMsg(tipo === 'boletin' ? 'Aún no hay boletines publicados.' : 'Aún no hay publicaciones.');
  });
  // Content above the anchor just changed height; land on the right section
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}

// ── Detail page ──
async function loadDetalle(main) {
  const container = main.querySelector('.container');
  const slug = new URLSearchParams(location.search).get('slug');
  const notFound = () => {
    container.innerHTML = `
      ${statusMsg('No encontramos esta publicación.')}
      <a href="publicaciones.html" class="link-more">Ver todas las publicaciones</a>`;
  };
  if (!slug) return notFound();

  let item;
  try {
    ({ data: [item] } = await wpFetch(PUBS_ENDPOINT, { slug, acf_format: 'standard' }));
  } catch (err) {
    console.error(err);
    container.innerHTML = statusMsg('No pudimos cargar la publicación. Intente de nuevo más tarde.');
    return;
  }
  if (!item) return notFound();

  const acf = item.acf || {};
  const tipo = acf.tipo_publicacion || 'publicacion';
  const title = decodeHTML(item.title?.rendered);
  const img = imgAttrs(acf.imagen_tarjeta, '(max-width: 768px) 80vw, 340px');
  const pdf = typeof acf.archivo_pdf === 'string' ? acf.archivo_pdf : acf.archivo_pdf?.url;
  const back = tipo === 'boletin' ? 'boletines' : 'publicaciones';

  document.title = `${title} - Observatorio de la Comisión de Acusaciones`;

  container.innerHTML = `
    <a href="publicaciones.html#${back}" class="detalle__back">← Volver a ${back}</a>
    <div class="detalle__header">
      <div class="detalle__cover">
        ${img ? `<img ${img} alt="${escapeHTML(acf.imagen_tarjeta.alt)}">` : ''}
      </div>
      <div class="detalle__intro">
        <p class="pub-card__meta">
          <span class="tag tag--${escapeHTML(tipo)}">${escapeHTML(TIPO_LABEL[tipo] || 'Publicación')}</span>
          <time datetime="${pubDate(item).toISOString().slice(0, 10)}">${formatDate(pubDate(item))}</time>
        </p>
        <h1 class="detalle__title">${escapeHTML(title)}</h1>
        ${acf.documento_resumen ? `<p class="detalle__summary">${escapeHTML(acf.documento_resumen)}</p>` : ''}
        ${pdf ? `<a href="${escapeHTML(pdf)}" class="btn-download" target="_blank" rel="noopener" download>Descargar PDF</a>` : ''}
      </div>
    </div>
    <div class="prose">${sanitize(item.content?.rendered)}</div>`;
}

// ── Boot: each loader runs only if its container is on the page ──
const ultimasSection = document.getElementById('ultimas-publicaciones');
if (ultimasSection) loadUltimas(ultimasSection).catch(console.error);

const comunicadosSection = document.getElementById('comunicados');
if (comunicadosSection) loadComunicados(comunicadosSection).catch(console.error);

const repoGrids = document.querySelectorAll('[data-feed="repositorio"]');
if (repoGrids.length) loadRepositorio(repoGrids);

const detalleMain = document.querySelector('[data-feed="detalle"]');
if (detalleMain) loadDetalle(detalleMain);
