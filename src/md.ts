import { randomBytes } from 'crypto';

/** Nonce criptográfico para la CSP de los webviews. */
export function getNonce(): string {
  return randomBytes(16).toString('hex');
}

/** Renderizador mínimo de Markdown para webviews (sin dependencias). */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

export function renderMarkdown(src: string): string {
  const codeBlocks: string[] = [];
  let s = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code: string) => {
    codeBlocks.push(
      `<pre class="code"><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`
    );
    return `\u0000CB${codeBlocks.length - 1}\u0000`;
  });

  s = escapeHtml(s);

  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');

  // encabezados
  s = s.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>');

  // citas
  s = s.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');

  // listas no ordenadas
  s = s.replace(/(?:^|\n)(?:[-*] .*(?:\n(?:  .*)*)*)/g, (block) => {
    const items = block
      .trim()
      .split('\n')
      .filter((l) => /^\s*[-*] /.test(l))
      .map((l) => `<li>${l.replace(/^\s*[-*] /, '')}</li>`)
      .join('');
    return `\n<ul>${items}</ul>`;
  });

  // listas ordenadas
  s = s.replace(/(?:^|\n)(?:\d+\. .*(?:\n(?:\s{2,}.*)*)*)/g, (block) => {
    const items = block
      .trim()
      .split('\n')
      .filter((l) => /^\s*\d+\. /.test(l))
      .map((l) => `<li>${l.replace(/^\s*\d+\. /, '')}</li>`)
      .join('');
    return `\n<ol>${items}</ol>`;
  });

  // párrafos: doble salto
  s = s
    .split(/\n{2,}/)
    .map((p) => {
      const t = p.trim();
      if (!t) return '';
      if (/^<(h\d|ul|ol|li|blockquote|pre|div)/.test(t)) return t;
      return `<p>${t.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  // restituir bloques de código (contienen nuevas líneas: no escaparlos de nuevo)
  s = s.replace(/\u0000CB(\d+)\u0000/g, (_m, i: string) => codeBlocks[Number(i)]);
  return s;
}
