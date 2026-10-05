// Las guías de instalación de la app (GUIA_TIPOS de trabajos.js), COPIADAS:
// los mismos tipos, pasos y campos, porque las respuestas se guardan en
// instalaciones.datos con la clave `<tipo>_<paso>_<campo>` y las lee la app.
// Si cambian allí, cambiarlas aquí. Solo cambia lo que se ve: sin emojis en
// títulos y etiquetas, y el icono es uno de línea del hub. Los VALORES de las
// opciones se quedan tal cual (son datos que la app ya guardó y compara, p. ej.
// «✅ OK»); en pantalla se enseñan sin el emoji (`textoOpcion`).
import type { IconoLinea } from '../../shell/linea';

export interface CampoGuia { id: string; label: string; tipo: string; placeholder?: string; default?: string; opciones?: string[] }
export interface PasoGuia { id: string; titulo: string; desc: string; campos: CampoGuia[] }
export interface TipoGuia { nombre: string; icono: IconoLinea; pasos: PasoGuia[] }

export const GUIA_TIPOS: Record<string, TipoGuia> = {
  tpv: {
    nombre: 'TPV Completo', icono: 'monitor',
    pasos: [
      { id: 'red', titulo: 'Configuración de red', desc: 'Anota los datos de red del local', campos: [
        { id: 'ip_router', label: 'IP del router', tipo: 'text', placeholder: '192.168.1.1' },
        { id: 'ip_tpv', label: 'IP del TPV', tipo: 'text', placeholder: '192.168.1.100' },
        { id: 'mascara', label: 'Máscara de red', tipo: 'text', placeholder: '255.255.255.0', default: '255.255.255.0' },
        { id: 'dns', label: 'DNS primario', tipo: 'text', placeholder: '8.8.8.8', default: '8.8.8.8' },
        { id: 'wifi_ssid', label: 'WiFi SSID', tipo: 'text', placeholder: 'NombreWifi' },
        { id: 'wifi_pass', label: 'Contraseña WiFi', tipo: 'password', placeholder: '••••••••' },
      ] },
      { id: 'hardware', titulo: 'Hardware instalado', desc: 'Registra el equipamiento físico', campos: [
        { id: 'modelo_tpv', label: 'Modelo TPV', tipo: 'text', placeholder: 'Datecs FMP350...' },
        { id: 'serie_tpv', label: 'Nº Serie TPV', tipo: 'text', placeholder: 'SN-XXXXXXXX' },
        { id: 'ip_impresora', label: 'IP Impresora tickets', tipo: 'text', placeholder: '192.168.1.101' },
        { id: 'serie_impr', label: 'Nº Serie impresora', tipo: 'text', placeholder: 'SN-XXXXXXXX' },
      ] },
      { id: 'software', titulo: 'Software y licencias', desc: 'Datos del software instalado', campos: [
        { id: 'sw_nombre', label: 'Software TPV', tipo: 'text', placeholder: 'Sysme, Glop...' },
        { id: 'sw_version', label: 'Versión', tipo: 'text', placeholder: 'v2.5.1' },
        { id: 'sw_licencia', label: 'Nº Licencia', tipo: 'text', placeholder: 'LIC-XXXXXXXX' },
        { id: 'anydesk', label: 'AnyDesk ID', tipo: 'text', placeholder: '123 456 789' },
        { id: 'usuario_tpv', label: 'Usuario acceso TPV', tipo: 'text', placeholder: 'admin' },
        { id: 'pass_tpv', label: 'Contraseña TPV', tipo: 'password', placeholder: '••••••••' },
      ] },
      { id: 'verifactu', titulo: 'VeriFactu', desc: 'Configuración normativa fiscal', campos: [
        { id: 'vf_activado', label: 'VeriFactu activado', tipo: 'select', opciones: ['Sí', 'No', 'Pendiente'] },
        { id: 'vf_certificado', label: 'Certificado digital instalado', tipo: 'select', opciones: ['Sí', 'No'] },
        { id: 'vf_caducidad', label: 'Fecha caducidad certificado', tipo: 'date' },
        { id: 'vf_nif', label: 'NIF del certificado', tipo: 'text', placeholder: 'B12345678' },
      ] },
      { id: 'pruebas', titulo: 'Pruebas y verificación', desc: 'Comprueba que todo funciona correctamente', campos: [
        { id: 'test_venta', label: 'Venta de prueba realizada', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', '⏳ Pendiente'] },
        { id: 'test_impr', label: 'Impresión de ticket OK', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', '⏳ Pendiente'] },
        { id: 'test_cajon', label: 'Apertura cajón OK', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', 'N/A'] },
        { id: 'test_verifactu', label: 'Envío VeriFactu OK', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', 'N/A'] },
        { id: 'formacion', label: 'Formación al cliente', tipo: 'select', opciones: ['✅ Realizada', '⏳ Pendiente', 'No requerida'] },
        { id: 'observaciones', label: 'Observaciones / incidencias', tipo: 'textarea', placeholder: 'Notas del técnico...' },
      ] },
    ],
  },
  camaras: {
    nombre: 'Videovigilancia', icono: 'camara',
    pasos: [
      { id: 'red_cam', titulo: 'Red de cámaras', desc: 'Configuración de red del sistema', campos: [
        { id: 'ip_nvr', label: 'IP del NVR/DVR', tipo: 'text', placeholder: '192.168.1.200' },
        { id: 'serie_nvr', label: 'Nº Serie NVR', tipo: 'text', placeholder: 'SN-XXXXXXXX' },
        { id: 'usuario_nvr', label: 'Usuario NVR', tipo: 'text', placeholder: 'admin' },
        { id: 'pass_nvr', label: 'Contraseña NVR', tipo: 'password', placeholder: '••••••••' },
        { id: 'disco_nvr', label: 'Disco duro instalado', tipo: 'text', placeholder: '2TB WD Purple' },
      ] },
      { id: 'camaras_lista', titulo: 'Cámaras instaladas', desc: 'Registra cada cámara instalada', campos: [
        { id: 'num_camaras', label: 'Número de cámaras', tipo: 'number', placeholder: '4' },
        { id: 'cam1_ip', label: 'Cámara 1 — IP', tipo: 'text', placeholder: '192.168.1.201' },
        { id: 'cam1_ubi', label: 'Cámara 1 — Ubicación', tipo: 'text', placeholder: 'Entrada principal' },
        { id: 'cam2_ip', label: 'Cámara 2 — IP', tipo: 'text', placeholder: '192.168.1.202' },
        { id: 'cam2_ubi', label: 'Cámara 2 — Ubicación', tipo: 'text', placeholder: 'Caja' },
        { id: 'cam3_ip', label: 'Cámara 3 — IP', tipo: 'text', placeholder: '192.168.1.203' },
        { id: 'cam3_ubi', label: 'Cámara 3 — Ubicación', tipo: 'text', placeholder: 'Almacén' },
        { id: 'cam4_ip', label: 'Cámara 4 — IP', tipo: 'text', placeholder: '192.168.1.204' },
        { id: 'cam4_ubi', label: 'Cámara 4 — Ubicación', tipo: 'text', placeholder: 'Exterior' },
      ] },
      { id: 'apps_cam', titulo: 'Apps y acceso remoto', desc: 'Configuración de acceso desde móvil', campos: [
        { id: 'app_nombre', label: 'App instalada', tipo: 'select', opciones: ['Hik-Connect', 'DMSS', 'iVMS-4500', 'Otra'] },
        { id: 'app_usuario', label: 'Usuario app', tipo: 'text', placeholder: 'usuario@email.com' },
        { id: 'app_pass', label: 'Contraseña app', tipo: 'password', placeholder: '••••••••' },
        { id: 'grabacion', label: 'Días de grabación', tipo: 'text', placeholder: '30 días' },
        { id: 'movimiento', label: 'Detección de movimiento', tipo: 'select', opciones: ['Activada', 'Desactivada', 'Parcial'] },
      ] },
      { id: 'pruebas_cam', titulo: 'Pruebas videovigilancia', desc: 'Verificación del sistema completo', campos: [
        { id: 'test_imagen', label: 'Imagen todas las cámaras OK', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', '⏳ Pendiente'] },
        { id: 'test_grabacion', label: 'Grabación funcionando', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', '⏳ Pendiente'] },
        { id: 'test_remoto', label: 'Acceso remoto app OK', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', '⏳ Pendiente'] },
        { id: 'test_alertas', label: 'Alertas de movimiento OK', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', 'N/A'] },
        { id: 'observaciones', label: 'Observaciones', tipo: 'textarea', placeholder: 'Incidencias...' },
      ] },
    ],
  },
  alarma: {
    nombre: 'Alarma Ajax', icono: 'alarma',
    pasos: [
      { id: 'hub_ajax', titulo: 'Hub Ajax', desc: 'Configuración del hub central', campos: [
        { id: 'hub_modelo', label: 'Modelo Hub', tipo: 'select', opciones: ['Hub 2', 'Hub 2 Plus', 'Hub Plus', 'Hub Lite'] },
        { id: 'hub_serie', label: 'Nº Serie Hub', tipo: 'text', placeholder: 'SN-XXXXXXXX' },
        { id: 'hub_id', label: 'ID del sistema Ajax', tipo: 'text', placeholder: 'ID en app Ajax' },
        { id: 'cra', label: 'Con CRA', tipo: 'select', opciones: ['Sí — con CRA', 'No — sin CRA'] },
        { id: 'cra_empresa', label: 'Empresa CRA', tipo: 'text', placeholder: 'Nombre CRA...' },
      ] },
      { id: 'sensores', titulo: 'Sensores instalados', desc: 'Registra todos los sensores', campos: [
        { id: 'num_pir', label: 'Detectores PIR', tipo: 'number', placeholder: '3' },
        { id: 'num_pircam', label: 'PIRCam PHOD', tipo: 'number', placeholder: '1' },
        { id: 'num_puertas', label: 'Detectores puerta/ventana', tipo: 'number', placeholder: '4' },
        { id: 'num_sirenas', label: 'Sirenas', tipo: 'number', placeholder: '1' },
        { id: 'teclado', label: 'Teclado instalado', tipo: 'select', opciones: ['Sí', 'No'] },
        { id: 'llavero', label: 'Mandos instalados', tipo: 'number', placeholder: '2' },
      ] },
      { id: 'config_ajax', titulo: 'Configuración', desc: 'Ajustes y notificaciones', campos: [
        { id: 'usuario_ajax', label: 'Usuario Ajax PRO', tipo: 'text', placeholder: 'email@...' },
        { id: 'pass_ajax', label: 'Contraseña', tipo: 'password', placeholder: '••••••••' },
        { id: 'tel_notif1', label: 'Teléfono notif. 1', tipo: 'tel', placeholder: '+34 600...' },
        { id: 'tel_notif2', label: 'Teléfono notif. 2', tipo: 'tel', placeholder: '+34 600...' },
        { id: 'retardo', label: 'Retardo entrada (seg)', tipo: 'number', placeholder: '30' },
        { id: 'retardo_sal', label: 'Retardo salida (seg)', tipo: 'number', placeholder: '45' },
      ] },
      { id: 'pruebas_alarma', titulo: 'Pruebas alarma', desc: 'Verificación completa del sistema', campos: [
        { id: 'test_pir', label: 'PIR detectan movimiento', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', '⏳ Pendiente'] },
        { id: 'test_sirena', label: 'Sirena activa correctamente', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', '⏳ Pendiente'] },
        { id: 'test_app', label: 'App Ajax funciona', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', '⏳ Pendiente'] },
        { id: 'test_notif', label: 'Notificaciones recibidas', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', '⏳ Pendiente'] },
        { id: 'formacion', label: 'Formación al cliente', tipo: 'select', opciones: ['✅ Realizada', '⏳ Pendiente'] },
        { id: 'observaciones', label: 'Observaciones', tipo: 'textarea', placeholder: 'Incidencias...' },
      ] },
    ],
  },
  red: {
    nombre: 'Red WiFi / Switches', icono: 'antena',
    pasos: [
      { id: 'topologia', titulo: 'Topología de red', desc: 'Diagrama y configuración básica', campos: [
        { id: 'ip_red', label: 'Rango IP red', tipo: 'text', placeholder: '192.168.1.0/24' },
        { id: 'ip_gateway', label: 'Gateway', tipo: 'text', placeholder: '192.168.1.1' },
        { id: 'ip_router', label: 'IP Router', tipo: 'text', placeholder: '192.168.1.1' },
        { id: 'num_switches', label: 'Switches instalados', tipo: 'number', placeholder: '2' },
        { id: 'num_aps', label: 'Access Points', tipo: 'number', placeholder: '1' },
        { id: 'vlans', label: 'VLANs configuradas', tipo: 'select', opciones: ['No', 'Sí — datos + cámaras', 'Sí — datos + cámaras + TPV'] },
      ] },
      { id: 'wifi', titulo: 'WiFi', desc: 'Configuración de redes inalámbricas', campos: [
        { id: 'wifi_ssid', label: 'SSID red principal', tipo: 'text', placeholder: 'NombreWifi' },
        { id: 'wifi_pass', label: 'Contraseña WiFi', tipo: 'password', placeholder: '••••••••' },
        { id: 'wifi_ssid2', label: 'SSID red invitados', tipo: 'text', placeholder: 'NombreWifi-Guest' },
        { id: 'wifi_pass2', label: 'Contraseña invitados', tipo: 'password', placeholder: '••••••••' },
        { id: 'modelo_ap', label: 'Modelo Access Point', tipo: 'text', placeholder: 'Ubiquiti U6...' },
        { id: 'ip_ap', label: 'IP Access Point', tipo: 'text', placeholder: '192.168.1.10' },
      ] },
      { id: 'pruebas_red', titulo: 'Pruebas de red', desc: 'Verificación de conectividad', campos: [
        { id: 'test_internet', label: 'Internet OK', tipo: 'select', opciones: ['✅ OK', '❌ Sin conexión'] },
        { id: 'test_wifi', label: 'WiFi cobertura OK', tipo: 'select', opciones: ['✅ OK', '❌ Cobertura insuficiente'] },
        { id: 'test_tpv_red', label: 'TPV conectado a red', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', 'N/A'] },
        { id: 'test_cam_red', label: 'Cámaras en red', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', 'N/A'] },
        { id: 'velocidad', label: 'Velocidad medida (Mbps)', tipo: 'text', placeholder: '100' },
        { id: 'observaciones', label: 'Observaciones', tipo: 'textarea', placeholder: 'Incidencias...' },
      ] },
    ],
  },
  comanderos: {
    nombre: 'Comanderos', icono: 'movil',
    pasos: [
      { id: 'config_com', titulo: 'Configuración comanderos', desc: 'Datos de cada comandero', campos: [
        { id: 'num_com', label: 'Número de comanderos', tipo: 'number', placeholder: '2' },
        { id: 'com1_modelo', label: 'Comandero 1 — Modelo', tipo: 'text', placeholder: 'Sunmi V2...' },
        { id: 'com1_ip', label: 'Comandero 1 — IP', tipo: 'text', placeholder: '192.168.1.110' },
        { id: 'com1_zona', label: 'Comandero 1 — Zona', tipo: 'text', placeholder: 'Terraza' },
        { id: 'com2_modelo', label: 'Comandero 2 — Modelo', tipo: 'text', placeholder: 'Sunmi V2...' },
        { id: 'com2_ip', label: 'Comandero 2 — IP', tipo: 'text', placeholder: '192.168.1.111' },
        { id: 'com2_zona', label: 'Comandero 2 — Zona', tipo: 'text', placeholder: 'Barra' },
      ] },
      { id: 'impresoras_com', titulo: 'Impresoras de cocina', desc: 'Impresoras vinculadas a comanderos', campos: [
        { id: 'imp1_ip', label: 'Impresora cocina — IP', tipo: 'text', placeholder: '192.168.1.120' },
        { id: 'imp1_zona', label: 'Impresora cocina — Zona', tipo: 'text', placeholder: 'Cocina' },
        { id: 'imp2_ip', label: 'Impresora barra — IP', tipo: 'text', placeholder: '192.168.1.121' },
        { id: 'imp2_zona', label: 'Impresora barra — Zona', tipo: 'text', placeholder: 'Barra' },
      ] },
      { id: 'pruebas_com', titulo: 'Pruebas comanderos', desc: 'Verificación del sistema', campos: [
        { id: 'test_envio', label: 'Envío de comandas OK', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', '⏳ Pendiente'] },
        { id: 'test_impr', label: 'Impresión en cocina OK', tipo: 'select', opciones: ['✅ OK', '❌ Fallo', 'N/A'] },
        { id: 'test_wifi_com', label: 'WiFi estable en todo el local', tipo: 'select', opciones: ['✅ OK', '❌ Cobertura insuficiente'] },
        { id: 'observaciones', label: 'Observaciones', tipo: 'textarea', placeholder: 'Incidencias...' },
      ] },
    ],
  },
};

export const textoOpcion = (o: string) => o.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, '').replace(/\u{FE0F}/gu, '').trim();
