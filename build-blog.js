#!/usr/bin/env node
/* ============================================================
   Naples Chess Club — blog generator

   Reads Markdown from blog/_posts/*.md and writes static HTML.
   No dependencies. Run it with:  node build-blog.js

   Built for a topic cluster: one pillar, with spokes linking up
   to it and across to each other.

   Conventions inside a post:
     ## Key takeaways            becomes the highlighted summary box
     ## Frequently asked ...     each ### becomes an accordion + FAQPage schema
     ## Sources                  becomes the citation block
     :::checklist ... :::        becomes a printable checklist card

   Everything else becomes ordinary prose, and every other H2 gets
   an id and an entry in the table of contents.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, 'blog', '_posts');
const BLOG_DIR = path.join(ROOT, 'blog');

const SITE_NAME = 'Naples Chess Club';
const PHONE = '+1-239-285-8258';

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SITE = 'https://' + ((indexHtml.match(/<link rel="canonical" href="https:\/\/([^/"]+)/) || [])[1] || 'napleschessclub.com');
const ASSET_V = (indexHtml.match(/styles\.css\?v=(\d+)/) || [])[1] || '1';

const ROLE_LABEL = {
  pillar: 'Complete guide',
  resource: 'Free resource',
  research: 'Research review'
};

/* ---------- helpers ---------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');
const slugify = s => String(s).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric'
  });
}

/* ---------- markdown ---------- */
function inline(s) {
  s = esc(s);

  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => `\u0000${codes.push(c) - 1}\u0000`);

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (m, alt, src) => `<img src="${escAttr(src)}" alt="${escAttr(alt)}" loading="lazy" decoding="async">`);

  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
    const external = /^https?:\/\//.test(href) && !href.startsWith(SITE);
    return `<a href="${escAttr(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
}

const BLOCK_START = /^(#{2,4}\s|\s*[-*]\s|\s*\d+\.\s|\s*>|\s*---\s*$|!\[|\|)/;

function mdToHtml(md, opts) {
  opts = opts || {};
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null;
  let i = 0;

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { closeList(); i++; continue; }

    // ::: fenced block
    const open = line.match(/^:::(\w+)\s*$/);
    if (open) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<div class="${esc(open[1])}">\n${mdToHtml(buf.join('\n'), opts)}\n</div>`);
      continue;
    }

    if (/^\s*---\s*$/.test(line)) { closeList(); out.push('<hr>'); i++; continue; }

    const h = line.match(/^(#{2,4})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      const text = h[2].trim();
      const id = slugify(text);
      out.push(`<h${lvl} id="${id}">${inline(text)}</h${lvl}>`);
      i++; continue;
    }

    if (/^\s*>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>\n${mdToHtml(buf.join('\n'), opts)}\n</blockquote>`);
      continue;
    }

    // table
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      closeList();
      const cells = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(lines[i]); i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>');
      continue;
    }

    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (img) {
      closeList();
      out.push(`<img src="${escAttr(img[2])}" alt="${escAttr(img[1])}" loading="lazy" decoding="async">`);
      i++; continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ul || ol)[1].trim())}</li>`);
      i++; continue;
    }

    closeList();
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i]) && !/^:::/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${inline(buf.join(' ').trim())}</p>`);
  }

  closeList();
  return out.join('\n');
}

/* ---------- section splitting ---------- */
function splitSections(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let cur = { title: null, lines: [] };
  let inFence = false;

  for (const line of lines) {
    if (/^:::/.test(line)) inFence = !inFence || !/^:::\w/.test(line) ? !inFence : inFence;
    const m = !inFence && line.match(/^##\s+(.+)$/);
    if (m) { sections.push(cur); cur = { title: m[1].trim(), lines: [] }; }
    else cur.lines.push(line);
  }
  sections.push(cur);
  return sections;
}

const isTakeaways = t => /^key takeaways?$/i.test(t || '');
const isFaq = t => /^(frequently asked questions|faqs?|common questions)$/i.test(t || '');
const isSources = t => /^(sources|references)$/i.test(t || '');

/* ---------- frontmatter ---------- */
function parsePost(file) {
  // Normalise line endings and strip any BOM, so a post saved from Notepad
  // or any Windows editor parses exactly like one saved from anywhere else.
  const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing --- frontmatter --- block at the top`);

  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
  }

  const slug = meta.slug || file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  const date = meta.date || (file.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];

  if (!meta.title) throw new Error(`${file}: frontmatter needs a title`);
  if (!date) throw new Error(`${file}: needs a date`);
  if (!meta.description) throw new Error(`${file}: frontmatter needs a description`);

  const body = m[2].trim();
  const words = body.split(/\s+/).filter(Boolean).length;

  return {
    file, slug, date,
    title: meta.title,
    description: meta.description,
    author: meta.author || SITE_NAME,
    image: meta.image || '/assets/img/og-image.jpg',
    imageAlt: meta.imageAlt || '',
    updated: meta.updated || date,
    role: meta.role || '',
    keywords: (meta.keywords || '').split(',').map(s => s.trim()).filter(Boolean),
    related: (meta.related || '').split(',').map(s => s.trim()).filter(Boolean),
    sections: splitSections(body),
    words,
    readMins: Math.max(1, Math.round(words / 220)),
    url: `${SITE}/blog/${slug}/`
  };
}

/* ---------- render a post's body ---------- */
function renderBody(post) {
  const toc = [];
  const faqs = [];
  let takeaways = '';
  let sources = '';
  const parts = [];

  for (const sec of post.sections) {
    const md = sec.lines.join('\n').trim();

    if (sec.title === null) {
      if (md) parts.push(mdToHtml(md));
      continue;
    }

    if (isTakeaways(sec.title)) {
      takeaways = `<aside class="takeaways">
        <h2>${esc(sec.title)}</h2>
        ${mdToHtml(md)}
      </aside>`;
      continue;
    }

    const id = slugify(sec.title);

    if (isFaq(sec.title)) {
      toc.push({ id, title: sec.title });
      // ### lines are questions; everything after is that answer
      const qs = [];
      let cur = null;
      for (const line of sec.lines) {
        const q = line.match(/^###\s+(.+)$/);
        if (q) { if (cur) qs.push(cur); cur = { q: q[1].trim(), lines: [] }; }
        else if (cur) cur.lines.push(line);
      }
      if (cur) qs.push(cur);

      qs.forEach(x => {
        const answerMd = x.lines.join('\n').trim();
        faqs.push({ q: x.q, text: answerMd.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim() });
      });

      parts.push(`<h2 id="${id}">${esc(sec.title)}</h2>
      <div class="faq faq-light">
${qs.map(x => `        <details>
          <summary>${esc(x.q)}</summary>
          <div class="faq-body">${mdToHtml(x.lines.join('\n').trim())}</div>
        </details>`).join('\n')}
      </div>`);
      continue;
    }

    if (isSources(sec.title)) {
      toc.push({ id, title: sec.title });
      sources = `<section class="sources"><h2 id="${id}">${esc(sec.title)}</h2>\n${mdToHtml(md)}\n</section>`;
      continue;
    }

    toc.push({ id, title: sec.title });
    parts.push(`<h2 id="${id}">${inline(sec.title)}</h2>\n${mdToHtml(md)}`);
  }

  const tocHtml = toc.length > 2 ? `<nav class="toc" aria-labelledby="toc-h">
        <h2 id="toc-h">On this page</h2>
        <ol>
${toc.map(t => `          <li><a href="#${t.id}">${esc(t.title)}</a></li>`).join('\n')}
        </ol>
      </nav>` : '';

  return { takeaways, tocHtml, html: parts.join('\n'), sources, faqs };
}

/* ---------- shared chrome, lifted from index.html ---------- */
function chrome() {
  const grab = (re, what) => {
    const m = indexHtml.match(re);
    if (!m) throw new Error(`Could not find the ${what} in index.html`);
    return m[0];
  };
  const absolutise = s => s
    .replace(/href="#(?!top")/g, 'href="/#')
    .replace(/href="#top"/g, 'href="/"');

  return {
    header: absolutise(grab(/<header class="site-header"[\s\S]*?<\/header>/, 'site header')),
    footer: absolutise(grab(/<footer class="site-footer"[\s\S]*?<\/footer>/, 'site footer')),
    dock: absolutise(grab(/<div class="dock"[\s\S]*?<\/div>/, 'mobile dock'))
  };
}
const CHROME = chrome();

/* ---------- page shell ---------- */
function shell({ title, description, canonical, image, imageAlt, ogType, body, jsonld }) {
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<script>document.documentElement.classList.remove("no-js");</script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">

<title>${escAttr(title)}</title>
<meta name="description" content="${escAttr(description)}">
<link rel="canonical" href="${escAttr(canonical)}">

<meta name="theme-color" content="#E9EFF2">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">

<meta property="og:type" content="${ogType || 'website'}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:url" content="${escAttr(canonical)}">
<meta property="og:image" content="${escAttr(SITE + image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escAttr(imageAlt || title)}">
<meta property="og:locale" content="en_US">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(description)}">
<meta name="twitter:image" content="${escAttr(SITE + image)}">

<link rel="icon" href="/assets/logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/logo.svg">
<link rel="alternate" type="application/rss+xml" title="${SITE_NAME} blog" href="/feed.xml">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&display=swap">
<link rel="stylesheet" href="/assets/css/styles.css?v=${ASSET_V}">
</head>
<body>

<a class="skip-link" href="#main">Skip to main content</a>

${CHROME.header}

<main id="main">
${body}
</main>

${CHROME.footer}
${CHROME.dock}

<script src="/assets/js/main.js?v=${ASSET_V}" defer></script>

<script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
</script>

</body>
</html>
`;
}

/* ---------- post page ---------- */
function renderPost(post, bySlug) {
  const r = renderBody(post);

  const related = post.related.map(s => bySlug[s]).filter(Boolean);
  const relatedHtml = related.length ? `
      <nav class="related" aria-labelledby="related-h">
        <h2 id="related-h">Keep reading</h2>
        <ul class="related-grid">
${related.map(p => `          <li><a href="/blog/${p.slug}/">
            ${p.role ? `<span class="role">${esc(ROLE_LABEL[p.role] || p.role)}</span>` : ''}
            <strong>${esc(p.title)}</strong>
          </a></li>`).join('\n')}
        </ul>
      </nav>` : '';

  const body = `
  <article class="panel panel-white post">
    <div class="wrap narrow">

      <nav class="post-breadcrumb" aria-label="Breadcrumb">
        <a href="/blog/">&larr; All posts</a>
      </nav>

      <header class="post-header">
        <p class="post-meta">
          ${post.role ? `<span class="role">${esc(ROLE_LABEL[post.role] || post.role)}</span>` : ''}
          <time datetime="${post.date}">${fmtDate(post.date)}</time>
          <span class="dot">&middot;</span>
          <span>${post.readMins} min read</span>
        </p>
        <h1>${esc(post.title)}</h1>
        <p class="lede">${esc(post.description)}</p>
      </header>

      <img class="post-hero" src="${escAttr(post.image)}" alt="${escAttr(post.imageAlt)}" width="1200" height="630" decoding="async">

      ${r.takeaways}
      ${r.tocHtml}

      <div class="prose">
${r.html}
${r.sources}
      </div>
${relatedHtml}

      <div class="post-cta">
        <h2>Come and play this Wednesday</h2>
        <p>6:30&nbsp;PM at Narrative Coffee Roasters in Mercato. Free, all ages, no sign-up.</p>
        <p class="post-cta-note">Location can vary week to week. Check <a href="https://www.instagram.com/napleschessclub/" target="_blank" rel="noopener">Instagram</a> before you set off.</p>
        <a class="btn btn-accent" href="sms:+12392858258?&amp;body=Hi!%20I'd%20like%20to%20come%20to%20chess%20night.">Text Us</a>
      </div>

    </div>
  </article>`;

  const graph = [
    {
      '@type': post.role === 'research' ? 'ScholarlyArticle' : 'BlogPosting',
      '@id': post.url + '#post',
      headline: post.title,
      name: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.updated,
      image: { '@type': 'ImageObject', url: SITE + post.image, width: 1200, height: 630 },
      url: post.url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': post.url },
      wordCount: post.words,
      timeRequired: `PT${post.readMins}M`,
      inLanguage: 'en-US',
      articleSection: ROLE_LABEL[post.role] || 'Chess',
      keywords: post.keywords.join(', '),
      author: { '@type': 'Organization', name: post.author, url: SITE + '/' },
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE + '/',
        logo: { '@type': 'ImageObject', url: SITE + '/assets/logo.svg' }
      },
      isPartOf: { '@id': SITE + '/blog/#blog' },
      about: { '@type': 'Thing', name: 'Chess' },
      speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.takeaways', '.lede'] }
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: SITE + '/blog/' },
        { '@type': 'ListItem', position: 3, name: post.title, item: post.url }
      ]
    }
  ];

  if (r.faqs.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': post.url + '#faq',
      mainEntity: r.faqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.text }
      }))
    });
  }

  return shell({
    title: `${post.title} | ${SITE_NAME}`,
    description: post.description,
    canonical: post.url,
    image: post.image,
    imageAlt: post.imageAlt,
    ogType: 'article',
    body,
    jsonld: { '@context': 'https://schema.org', '@graph': graph }
  });
}

/* ---------- blog index ---------- */
function renderIndex(posts) {
  const cards = posts.map(p => `
        <li class="post-card">
          <p class="post-meta">
            ${p.role ? `<span class="role">${esc(ROLE_LABEL[p.role] || p.role)}</span>` : ''}
            <time datetime="${p.date}">${fmtDate(p.date)}</time>
            <span class="dot">&middot;</span>
            <span>${p.readMins} min read</span>
          </p>
          <h2><a href="/blog/${p.slug}/">${esc(p.title)}</a></h2>
          <p>${esc(p.description)}</p>
          <a class="post-more" href="/blog/${p.slug}/">Read more &rarr;</a>
        </li>`).join('\n');

  const body = `
  <section class="panel panel-white page-head">
    <div class="wrap narrow">
      <p class="eyebrow">From the Club</p>
      <h1>Notes &amp; Stories</h1>
      <p class="lede">Guides, research and practical chess advice from a club that meets every week in Naples, Florida.</p>
    </div>
  </section>

  <section class="panel panel-soft section">
    <div class="wrap narrow">
      ${posts.length
        ? `<ul class="post-list">\n${cards}\n      </ul>`
        : '<p class="lede center">No posts yet. Check back soon.</p>'}
    </div>
  </section>`;

  return shell({
    title: `Blog | ${SITE_NAME}`,
    description: 'Guides, research and practical chess advice from Naples Chess Club, a free weekly chess club in Naples, Florida.',
    canonical: SITE + '/blog/',
    image: '/assets/img/og-image.jpg',
    imageAlt: 'Naples Chess Club',
    body,
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Blog',
          '@id': SITE + '/blog/#blog',
          name: `${SITE_NAME} Blog`,
          description: 'Guides, research and practical chess advice from Naples Chess Club.',
          url: SITE + '/blog/',
          inLanguage: 'en-US',
          publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE + '/' },
          blogPost: posts.map(p => ({
            '@type': 'BlogPosting',
            headline: p.title,
            description: p.description,
            datePublished: p.date,
            dateModified: p.updated,
            url: p.url
          }))
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
            { '@type': 'ListItem', position: 2, name: 'Blog', item: SITE + '/blog/' }
          ]
        }
      ]
    }
  });
}

/* ---------- sitemap + feed ---------- */
function renderSitemap(posts) {
  const today = new Date().toISOString().slice(0, 10);
  const url = (loc, lastmod, freq, pri, img) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${pri}</priority>${img ? `
    <image:image><image:loc>${img}</image:loc></image:image>` : ''}
  </url>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${url(SITE + '/', today, 'weekly', '1.0', SITE + '/assets/img/og-image.jpg')}
${url(SITE + '/blog/', posts[0] ? posts[0].updated : today, 'weekly', '0.8')}
${posts.map(p => url(p.url, p.updated, 'monthly', p.role === 'pillar' ? '0.9' : '0.7', SITE + p.image)).join('\n')}
</urlset>
`;
}

function renderFeed(posts) {
  const items = posts.slice(0, 20).map(p => `    <item>
      <title>${esc(p.title)}</title>
      <link>${p.url}</link>
      <guid isPermaLink="true">${p.url}</guid>
      <description>${esc(p.description)}</description>
      <pubDate>${new Date(p.date + 'T12:00:00Z').toUTCString()}</pubDate>
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_NAME}</title>
    <link>${SITE}/blog/</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Guides, research and practical chess advice from Naples Chess Club.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

/* ---------- build ---------- */
function build() {
  if (!fs.existsSync(POSTS_DIR)) {
    console.error(`No posts folder at ${POSTS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md')).sort();
  const posts = files.map(parsePost).sort((a, b) => b.date.localeCompare(a.date));
  const bySlug = Object.fromEntries(posts.map(p => [p.slug, p]));

  // Warn about cluster links that point nowhere.
  let warnings = 0;
  for (const p of posts) {
    for (const s of p.related) {
      if (!bySlug[s]) { console.warn(`  WARNING  ${p.file}: related post "${s}" does not exist`); warnings++; }
    }
  }

  // Remove generated folders for posts that no longer exist.
  for (const entry of fs.readdirSync(BLOG_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '_posts') continue;
    if (!bySlug[entry.name]) {
      fs.rmSync(path.join(BLOG_DIR, entry.name), { recursive: true, force: true });
      console.log(`  removed  blog/${entry.name}/ (no matching post)`);
    }
  }

  for (const post of posts) {
    const dir = path.join(BLOG_DIR, post.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPost(post, bySlug));
    console.log(`  post     blog/${post.slug}/  (${post.words} words, ${post.readMins} min)`);
  }

  fs.writeFileSync(path.join(BLOG_DIR, 'index.html'), renderIndex(posts));
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), renderSitemap(posts));
  fs.writeFileSync(path.join(ROOT, 'feed.xml'), renderFeed(posts));
  console.log('  index    blog/index.html\n  sitemap  sitemap.xml\n  feed     feed.xml');

  console.log(`\nBuilt ${posts.length} post${posts.length === 1 ? '' : 's'} for ${SITE}${warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''}`);
}

build();
