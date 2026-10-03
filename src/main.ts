// Arranque: tema → sesión → ¿es usuario del hub? → shell + router.
import './estilo.css';
import './escritorio.css';
import './oki.css';
import { instalarDispatcher, registrarAcciones } from './core/dispatcher';
import { sesionInicial, alCambiarSesion, entrarConCorreo, entrarConGoogle, salir, emailSesion } from './core/auth';
import { API } from './core/api';
import { setUsuario, type Usuario } from './core/estado';
import { registrarModulos, iniciarRouter } from './core/router';
import { MODULOS } from './modulos';
import { aplicarTema, alternarTema } from './shell/tema';
import { pintarShell, mostrarModulo, alternarMenu } from './shell/shell';
import { pintarLogin, avisoLogin } from './shell/login';
import { abrirBuscador, cerrarBuscador, filtrarBuscador, buscadorEnter, buscadorTecla, busModo, instalarAtajoBuscador } from './shell/buscador';
import { leerParametroOs, instalarAtajosEscritorio } from './shell/escritorio';
import { empezarTour, tourSiguiente, tourCerrar, tourSiEsNuevo } from './shell/tour';

const raiz = document.getElementById('app')!;
let arrancado = false;
let arrancando: Promise<void> | null = null;

registrarModulos(MODULOS);
instalarDispatcher();
instalarAtajoBuscador();
instalarAtajosEscritorio();
leerParametroOs();
aplicarTema();

registrarAcciones({
  alternarTema, alternarMenu, abrirBuscador: () => abrirBuscador(), cerrarBuscador, filtrarBuscador, buscadorEnter, buscadorTecla, busModo,
  empezarTour, tourSiguiente, tourCerrar,
  async entrar() {
    const email = (document.getElementById('lg-email') as HTMLInputElement).value.trim();
    const pass = (document.getElementById('lg-pass') as HTMLInputElement).value;
    const err = await entrarConCorreo(email, pass);
    if (err) avisoLogin(err === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : err);
    else await arrancar();
  },
  async entrarGoogle() {
    const err = await entrarConGoogle();
    if (err) avisoLogin(err);
  },
  async salir() {
    await salir();
    arrancado = false;
    pintarLogin(raiz);
  },
});

// La RLS solo deja leer a quien esté activo en hub.usuarios; si no aparece,
// la sesión es buena pero la persona no está dada de alta en el hub.
function arrancar(): Promise<void> {
  if (arrancado) return Promise.resolve();
  // onAuthStateChange y el arranque pueden llegar a la vez: una sola carga.
  return (arrancando ??= arrancarUnaVez().finally(() => { arrancando = null; }));
}

async function arrancarUnaVez() {
  const email = emailSesion();
  if (!email) { pintarLogin(raiz); return; }
  const { data, error } = await API.get<Usuario[]>('usuarios', {
    select: 'id,nombre,email,rol,activo', email: `ilike.${email.replace(/[\\%_]/g, '\\$&')}`, activo: 'eq.true', limit: '1',
  });
  if (error) { pintarLogin(raiz, `No se pudo comprobar tu usuario: ${error.message}`); return; }
  if (!data?.[0]) {
    await salir();
    pintarLogin(raiz, `${email} no está dado de alta en el hub. Pídeselo a un administrador.`);
    return;
  }
  setUsuario(data[0]);
  arrancado = true;
  pintarShell(raiz);
  iniciarRouter(mostrarModulo);
  tourSiEsNuevo();
}

alCambiarSesion(s => { if (s && !arrancado) void arrancar(); });
await sesionInicial();
await arrancar();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[sw]', e));
}
