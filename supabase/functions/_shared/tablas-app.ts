// Tablas de la app actual (`okcomputer`) que el hub copia, con las columnas
// que se copian. TIENEN que coincidir con las de hub.<tabla>
// (supabase/migrations/20261001b_hub_tablas_app.sql): una columna nueva en la
// app no rompe el sync, pero no llega hasta añadirla allí y aquí.
//
// `auditada`: la app apunta sus cambios en audit_log (trigger de
// 20260911_audit_log.sql), así que viaja por el incremental. Las que no, solo
// en la pasada nocturna completa.
// `nocturna`: además de auditada, se repasa entera cada noche (en `locales`
// los cron de Zoho/Stripe escriben columnas que audit_log trata como ruido y
// no apunta).

export interface TablaApp { columnas: string[]; auditada: boolean; nocturna?: boolean }

const c = (s: string) => s.split(/\s+/).filter(Boolean)

export const TABLAS_APP: Record<string, TablaApp> = {
  usuarios: { auditada: true, columnas: c('id created_at nombre email rol activo') },
  clientes: { auditada: true, columnas: c(`id created_at tipo nombre nif telefono email direccion notas plan estado
    activo zoho_id google_contact_id importe_mantenimiento forma_pago frecuencia_pago fecha_activacion
    programa_tpv estado_pago notas_mantenimiento proxima_cuota stripe_customer_id`) },
  locales: { auditada: true, nocturna: true, columnas: c(`id created_at cliente_id nombre direccion horario notas
    activo notas_tecnicas maps_url zoho_subscription_id plan estado_pago importe_mantenimiento forma_pago
    frecuencia_pago fecha_activacion programa_tpv proxima_cuota notas_mantenimiento alarma_empresa
    alarma_contrato alarma_codigo alarma_telefono alarma_notas tipo drive_folder_id estado stripe_customer_id
    stripe_subscription_id stripe_estado stripe_mandato_estado stripe_ultimo_error stripe_sync_at zoho_estado
    zoho_deuda zoho_facturas_impagadas zoho_sync_at zoho_sync_error zoho_deuda_error lat lng geocodificado_at
    importe_incluye_impuesto stripe_cobro_en_curso_at tiene_software`) },
  contactos: { auditada: true, columnas: c(`id created_at nombre tipo empresa cargo telefono telefono2 email
    direccion notas favorito cliente_id activo google_resource_name google_synced_at etiquetas local_id`) },
  trabajos: { auditada: true, columnas: c(`id created_at cliente_id local_id tipo descripcion estado tecnicos
    fecha_programada hora_llegada hora_salida gps_lat gps_lng materiales observaciones firma_cliente
    duracion_teorica gcal_event_id ubicacion presupuesto_id firma_url parent_trabajo_id numero chain_root_id
    titulo contacto_id prioridad oportunidad_id zoho_invoice_id zoho_invoice_number`) },
  agenda: { auditada: true, columnas: c(`id trabajo_id tarea_id ticket_id titulo inicio fin todo_el_dia tecnicos
    estado notas created_at created_by tipo`) },
  sesiones: { auditada: true, columnas: c(`id entidad_tipo entidad_id traslado inicio fin duracion_min tecnico_id
    tecnico_nombre gps_lat gps_lng created_at agenda_id`) },
  documento_lineas: { auditada: false, columnas: c(`id created_at trabajo_id presupuesto_id nombre cantidad
    precio descuento subtotal orden inventario_id furgoneta_id categoria`) },
  tareas: { auditada: true, columnas: c(`id created_at titulo estado prioridad fecha_vencimiento tecnico_id notas
    trabajo_id ticket_id presupuesto_id duracion_teorica hora_recordatorio numero cliente_id local_id
    contacto_id recurrencia recurrencia_cada proxima_recurrencia recurrencia_hasta tarea_origen_id gtask_id
    hora_inicio hora_fin tipo oportunidad_id descripcion`) },
  tickets: { auditada: true, columnas: c(`id created_at cliente_id local_id titulo descripcion estado prioridad
    tecnico_id resolucion via_contacto numero contacto_id trabajo_id resolucion_categoria`) },
  presupuestos: { auditada: true, columnas: c(`id created_at cliente_id local_id titulo exigencias estado total
    tecnico_id zoho_estimate_id fecha oportunidad_id numero_presupuesto contacto_id`) },
  // Área del hub desde la fase 4: solo se importan sus ALTAS (hub.areas.importar_altas).
  oportunidades: { auditada: true, columnas: c(`id created_at titulo cliente_id descripcion estado valor_estimado
    tecnico_id fecha_seguimiento motivo_perdida origen local_id contacto_id`) },
  // Área del hub desde la fase 6 (con tickets): solo ALTAS. Los mensajes de
  // WhatsApp del cliente llegan a la app como comentario de su ticket.
  ticket_comentarios: { auditada: false, columnas: c('id ticket_id autor_id autor_nombre texto created_at') },
  // Fase 5: se leen y se indexan en el buscador (sin audit_log en la app: pasada nocturna).
  conocimiento: { auditada: false, columnas: c('id created_at titulo categoria tipo descripcion url palabras_clave') },
  tablero_notas: { auditada: false, columnas: c('id user_id titulo descripcion created_at updated_at') },
  // Fase 9: espejo del inventario para el MRP (el stock se sigue moviendo en la app).
  catalogo: { auditada: true, columnas: c('id created_at nombre categoria precio unidad referencia descripcion activo zoho_item_id') },
  furgonetas: { auditada: false, columnas: c('id created_at nombre tecnico_responsable') },
  furgoneta_inventario: { auditada: true, columnas: c(`id created_at furgoneta_id nombre categoria cantidad stock_minimo notas
    codigo_principal codigo_barra precio catalogo_id`) },
  furgoneta_movimientos: { auditada: false, columnas: c('id created_at furgoneta_id producto_id tipo cantidad destino_id tecnico_id notas trabajo_id') },
  gastos: { auditada: true, columnas: c(`id created_at importe fecha categoria trabajo_id tecnico_id notas
    foto_url tipo descripcion contacto_id local_id`) },
}
