// «Excel»: CSV con BOM y «;», que Excel en español abre con las columnas
// bien (lo que hacían los export*Excel de la app sin la librería XLSX).
export function descargarCsv(nombre: string, cabecera: string[], filas: unknown[][]) {
  const celda = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [cabecera, ...filas].map(f => f.map(celda).join(';'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `${nombre}-${new Date().toLocaleDateString('sv-SE')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Leer lo que Excel guarda como CSV (con «;», «,» o tabulador, comillas y BOM):
// filas de celdas en texto. Se adivina el separador por la primera línea.
export function leerCsv(texto: string): string[][] {
  const t = texto.replace(/^\uFEFF/, '');
  const primera = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].map(s => [s, primera.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const filas: string[][] = [];
  let fila: string[] = [], celda = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); filas.push(fila); fila = []; celda = '';
    } else celda += c;
  }
  if (celda || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.filter(f => f.some(v => v.trim() !== ''));
}
