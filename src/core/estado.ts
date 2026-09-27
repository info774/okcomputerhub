// Estado global mínimo: quién ha entrado. Solo lectura desde fuera.
export interface Usuario { id: string; nombre: string; email: string; rol: string; activo: boolean }

let _usuario: Usuario | null = null;
export const usuario = () => _usuario;
export const esAdmin = () => _usuario?.rol === 'admin';
export function setUsuario(u: Usuario | null) { _usuario = u; }
