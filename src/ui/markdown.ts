// Markdown mínimo y SEGURO: primero se escapa todo y luego se da formato, así
// que nada de lo escrito (por una persona o por Claude) puede meter HTML.
// Cubre lo que se usa en fichas: títulos, listas, negrita, cursiva, código,
// enlaces http(s) y párrafos.
import { esc } from './dom';
import { ico } from '../shell/linea';

function enLinea(t: string): string {
  return t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Enlaces internos del hub: [texto](#/wiki/<id>)
    .replace(/\[([^\]]+)\]\((#\/[A-Za-z0-9/_-]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

export function markdown(fuente: string | null | undefined): string {
  const lineas = esc(fuente ?? '').split(/\r?\n/);
  const out: string[] = [];
  let lista: 'ul' | 'ol' | null = null;
  let parrafo: string[] = [];
  const cerrarParrafo = () => { if (parrafo.length) { out.push(`<p>${enLinea(parrafo.join(' '))}</p>`); parrafo = []; } };
  const cerrarLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  for (const l of lineas) {
    const t = l.trim();
    let m: RegExpMatchArray | null;
    if (!t) { cerrarParrafo(); cerrarLista(); continue; }
    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) {
      cerrarParrafo(); cerrarLista();
      const n = Math.min(m[1].length + 2, 6);
      out.push(`<h${n}>${enLinea(m[2])}</h${n}>`);
    } else if ((m = t.match(/^[-*]\s+(.*)$/)) || (m = t.match(/^\d+[.)]\s+(.*)$/))) {
      cerrarParrafo();
      const tipo = /^\d/.test(t) ? 'ol' : 'ul';
      if (lista !== tipo) { cerrarLista(); out.push(`<${tipo}>`); lista = tipo; }
      const tarea = m[1].match(/^\[( |x)\]\s+(.*)$/i);
      out.push(tarea ? `<li>${ico(tarea[1].toLowerCase() === 'x' ? 'casillaHecha' : 'casilla')} ${enLinea(tarea[2])}</li>` : `<li>${enLinea(m[1])}</li>`);
    } else if (t.startsWith('&gt;')) {
      cerrarParrafo(); cerrarLista();
      out.push(`<blockquote>${enLinea(t.replace(/^&gt;\s?/, ''))}</blockquote>`);
    } else {
      cerrarLista();
      parrafo.push(t);
    }
  }
  cerrarParrafo(); cerrarLista();
  return out.join('\n');
}
