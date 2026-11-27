/*
 * A small, safe Markdown renderer for agent replies.
 * Every character of the source is escaped first; only the tags below are ever created,
 * and links must be http(s), so nothing in a reply can run script in this page.
 * Supports: headings, paragraphs, bold, italic, inline code, fenced code, lists (incl. nested by indent),
 * block quotes, tables, horizontal rules and links.
 */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function inline(src) {
  // Protect inline code first so its contents are never formatted.
  const codes = [];
  let s = escapeHtml(src).replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?=[^_\w]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function renderMarkdown(src = '') {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="code"${fence[2] ? ` data-lang="${escapeHtml(fence[2])}"` : ''}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lvl = Math.min(h[1].length + 1, 5); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { out.push('<hr>'); i++; continue; }
    // table
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<div class="table-wrap" role="region" tabindex="0" aria-label="Table"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    // quote
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
      continue;
    }
    // lists (nesting by indentation)
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const block = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && block.length))) block.push(lines[i++]);
      out.push(list(block));
      continue;
    }
    // paragraph
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*```|\s*~~~|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]) && !(lines[i].includes('|') && isTableSep(lines[i + 1] ?? ''))) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

function list(block) {
  const indent = (l) => l.match(/^\s*/)[0].length;
  const base = indent(block[0]);
  const ordered = /^\s*\d+[.)]/.test(block[0]);
  const items = [];
  for (const l of block) {
    if (indent(l) <= base && /^\s*([-*+]|\d+[.)])\s+/.test(l)) items.push({ text: l.replace(/^\s*([-*+]|\d+[.)])\s+/, ''), children: [] });
    else items.at(-1)?.children.push(l);
  }
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((it) => {
    const nested = it.children.filter((c) => /^\s*([-*+]|\d+[.)])\s+/.test(c));
    const extra = it.children.filter((c) => !/^\s*([-*+]|\d+[.)])\s+/.test(c)).map((c) => c.trim());
    return `<li>${inline([it.text, ...extra].join(' '))}${nested.length ? list(nested) : ''}</li>`;
  }).join('')}</${tag}>`;
}
