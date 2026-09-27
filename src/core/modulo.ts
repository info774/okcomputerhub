// Contrato de una pantalla del hub. Cada carpeta de src/modulos/ exporta uno
// y se registra en src/modulos/index.ts; con eso ya sale en el menú, en el
// buscador de módulos y (si tiene contador) como baldosa en Inicio.

export type Tono = 'neutro' | 'bien' | 'aviso' | 'mal';

export interface Contador {
  valor: string | number;
  subtitulo?: string;
  tono?: Tono;
}

export interface Modulo {
  id: string;                 // ruta: #/<id>
  titulo: string;
  grupo: string;              // agrupación del menú
  icono: string;              // un emoji o carácter; sin librerías de iconos
  explicacion: string;        // párrafo que sale encima de la pantalla
  soloAdmin?: boolean;
  // Enlace a la app actual en vez de pantalla propia (lo que el hub aún no tiene).
  enlaceExterno?: string;
  // Pinta la pantalla dentro de `el`. `params` = lo que va tras #/<id>/…
  pintar?(el: HTMLElement, params: string[]): void | Promise<void>;
  // Número en vivo para la baldosa y el menú. Barato: nada de traer tablas.
  contador?(): Promise<Contador | null>;
}
