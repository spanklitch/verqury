// A deliberately small, dependency-free Markdown → HTML renderer (ADR-0005).
// Covers what Verqury's guidance and narrative files actually use: headings,
// bold/italic, inline code, fenced code, links, lists, blockquotes, hr,
// paragraphs. All text is HTML-escaped first, so rendered content can never
// inject markup.
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, href) => `<a href="${href}">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  let para = [];
  let list = null; // 'ul' | 'ol'

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushPara();
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      html.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushPara();
      closeList();
      html.push('<hr>');
      i++;
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) {
        closeList();
        html.push(`<${want}>`);
        list = want;
      }
      html.push(`<li>${inline((ul || ol)[1])}</li>`);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushPara();
      closeList();
      html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
      i++;
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      closeList();
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  closeList();
  return html.join('\n');
}
