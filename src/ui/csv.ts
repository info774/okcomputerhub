// «⬇ Excel»: CSV con BOM y «;», que Excel en español abre con las columnas
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
