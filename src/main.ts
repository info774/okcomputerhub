// Arranque: tema → sesión → ¿es usuario del hub? → shell + router.
import './core/errores';
import './estilo.css';
import './escritorio.css';
import './oki.css';
import { instalarDispatcher, registrarAcciones } from './core/dispatcher';
import { sesionInicial, alCambiarSesion, entrarConCorreo, entrarConGoogle, salir, emailSesion } from './core/auth';
import { API } from './core/api';
import { setUsuario, type Usuario } from './core/estado';
import { esEmpleado } from './core/empleado';
import { registrarModulos, iniciarRouter } from './core/router';
import { MODULOS } from './modulos';
import { aplicarTema, alternarTema } from './shell/tema';
import { pintarShell, mostrarModulo, alternarMenu } from './shell/shell';
import { pintarLogin, avisoLogin } from './shell/login';
import { abrirBuscador, cerrarBuscador, filtrarBuscador, buscadorEnter, buscadorTecla, busModo, instalarAtajoBuscador } from './shell/buscador';
import { leerParametroOs, instalarAtajosEscritorio } from './shell/escritorio';
import { empezarTour, tourSiguiente, tourCerrar, tourSiEsNuevo } from './shell/tour';
import { iniciarVersion, recargarVersion } from './shell/version';
import { aplicarTexto } from './shell/texto';
import './shell/atajos';
import './ui/menu-mas';
import { pintarPendientes, enviarAlEntrar } from './shell/pendientes';
import { limpiarHistorial } from './core/deshacer';
import { refrescarPush, escucharAvisos } from './core/push';
import { borrarLecturas } from './core/lecturas';
import { vigilarChat } from './shell/chat-avisos';

const raiz = document.getElementById('app')!;
let arrancado = false;
let arrancando: Promise<void> | null = null;

registrarModulos(MODULOS);
instalarDispatcher();
instalarAtajoBuscador();
instalarAtajosEscritorio();
leerParametroOs();
aplicarTema();
aplicarTexto();
void iniciarVersion();

registrarAcciones({
  alternarTema, alternarMenu, abrirBuscador: () => abrirBuscador(), cerrarBuscador, filtrarBuscador, buscadorEnter, buscadorTecla, busModo,
  empezarTour, tourSiguiente, tourCerrar, recargarVersion, tamTexto: (v: string) => aplicarTexto(v),
  // El asistente de voz se carga al abrirlo (micro de la cabecera).
  vozAbrir: () => { void import('./ui/voz').then(m => m.abrirVoz()); },
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
    // El historial de deshacer y la copia de las lecturas son de quien sale (la cola no: sale con su sesión).
    limpiarHistorial();
    await borrarLecturas();
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
  // Modo empleado: en el móvil, el técnico entra a «Hoy» (como el dashboard
  // «Mi jornada» de la app) si no viene a una pantalla concreta.
  if (esEmpleado() && matchMedia('(max-width: 767px)').matches && !location.hash.replace(/^#\/?/, '')) {
    history.replaceState(null, '', '#/hoy');
  }
  pintarShell(raiz);
  vigilarChat();
  pintarPendientes(raiz);
  enviarAlEntrar();
  void refrescarPush().catch(() => {});
  iniciarRouter(mostrarModulo);
  tourSiEsNuevo();
}

alCambiarSesion(s => { if (s && !arrancado) void arrancar(); });
await sesionInicial();
await arrancar();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[sw]', e));
  escucharAvisos();
}
