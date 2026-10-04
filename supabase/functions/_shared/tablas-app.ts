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
// `clave`: la clave primaria si no es `id` (rmm_despliegues: una por sede).

export interface TablaApp { columnas: string[]; auditada: boolean; nocturna?: boolean; clave?: string }

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
    importe_incluye_impuesto stripe_cobro_en_curso_at tiene_software cert_caducidad backup_tipo backup_destino
    backup_comprobado control_horario control_horario_sistema control_horario_nuestro codigo_verificacion`) },
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
  // Fase Final: para la ficha del trabajo (sin la foto en crudo: solo su enlace de Drive).
  trabajo_comentarios: { auditada: false, columnas: c('id created_at trabajo_id autor_nombre texto') },
  trabajo_fotos: { auditada: false, columnas: c('id created_at trabajo_id tecnico_id descripcion drive_file_id drive_url') },
  documento_lineas: { auditada: false, columnas: c(`id created_at trabajo_id presupuesto_id nombre cantidad
    precio descuento subtotal orden inventario_id furgoneta_id categoria`) },
  tareas: { auditada: true, columnas: c(`id created_at titulo estado prioridad fecha_vencimiento tecnico_id notas
    trabajo_id ticket_id presupuesto_id duracion_teorica hora_recordatorio numero cliente_id local_id
    contacto_id recurrencia recurrencia_cada proxima_recurrencia recurrencia_hasta tarea_origen_id gtask_id
    hora_inicio hora_fin tipo oportunidad_id descripcion`) },
  // Lista del día (paridad bloque 1): en el audit_log de la app y, por si el
  // espejo nace vacío, entera cada noche.
  // Teléfonos de la sede con su rol (paridad bloque 2): fuera del audit_log de la app.
  // Equipamiento de la sede y seguimiento del plan (paridad bloque 2, tanda 3):
  // fuera del audit_log de la app, en la pasada nocturna.
  local_software: { auditada: false, columnas: c('id created_at local_id nombre version num_licencia anydesk_id fecha_caducidad_certificado notas') },
  local_hardware: { auditada: false, columnas: c('id created_at local_id tipo nombre num_serie ip garantia anydesk_id fecha_instalacion notas') },
  local_camaras: { auditada: false, columnas: c('id created_at local_id marca modelo num_serie ip usuario contrasena notas') },
  rmm_despliegues: { auditada: false, clave: 'local_id', columnas: c('local_id rustdesk_password creado_at creado_por notas') },
  plan_tareas: { auditada: false, columnas: c('id created_at updated_at plan nombre periodicidad es_backup orden activa notas') },
  sitio_tarea_seguimiento: { auditada: false, columnas: c('id created_at updated_at local_id tarea_id periodo completado completado_at completado_por notas') },
  local_telefonos: { auditada: false, columnas: c('id created_at local_id nombre numero rol contacto_id') },
  plantillas_trabajo: { auditada: false, columnas: c('id created_at nombre tipo descripcion duracion_teorica checklist activa') },
  lista_dia: { auditada: true, nocturna: true, columnas: c('id created_at fecha usuario tipo ref_id titulo orden completado completado_at estado_previo creado_por') },
  tickets: { auditada: true, columnas: c(`id created_at cliente_id local_id titulo descripcion estado prioridad
    tecnico_id resolucion via_contacto numero contacto_id trabajo_id resolucion_categoria`) },
  presupuestos: { auditada: true, columnas: c(`id created_at cliente_id local_id titulo exigencias estado total
    tecnico_id zoho_estimate_id fecha oportunidad_id numero_presupuesto contacto_id`) },
  // Mantenimiento sin dinero (paridad bloque 4, tanda 1). mantenimientos_programados
  // está en el audit_log de la app; el resto, en la pasada nocturna.
  planes_mantenimiento: { auditada: false, columnas: c(`id created_at updated_at nombre orden precio_mensual frecuencia_pago
    revisiones_anuales descuento_mano_obra descuento_material coste_presencial_estandar coste_presencial_urgente color resumen
    caracteristicas activo notas contrato_servicios contrato_plantilla stripe_product_id stripe_precios zoho_item_id horario_soporte`) },
  mant_seguimiento: { auditada: false, columnas: c('id cliente_id local_id contacto_id estado tipo_respuesta notas recordatorio_fecha dias_recordatorio created_at updated_at') },
  checklist_plantillas: { auditada: false, columnas: c('id plan nombre items activa created_at') },
  checklist_respuestas: { auditada: false, columnas: c('id trabajo_id plantilla_id plantilla_nombre respuestas completado tecnico_id created_at') },
  mantenimientos_programados: { auditada: true, columnas: c('id created_at cliente_id local_id plan proxima_fecha ultimo_generado activo contacto_id') },
  // Motor de cobro del mantenimiento (paridad bloque 4, tanda 3): ninguna está en
  // el audit_log de la app. Los CONTADORES de las series van también, para que el
  // hub siga la numeración MANT-/ABONO- donde la deje la app al cortar.
  mant_config: { auditada: false, columnas: c(`id updated_at serie_prefijo serie_digitos precio_incluye_impuesto zoho_tax_id
    zoho_tax_percent zoho_cuenta_cobro_id zoho_notas facturar_automatico moneda enviar_factura_email pago_metodos serie_prefijo_abono`) },
  mant_serie: { auditada: false, clave: 'anio', columnas: c('anio contador') },
  mant_serie_abonos: { auditada: false, clave: 'anio', columnas: c('anio contador') },
  mant_facturas: { auditada: false, columnas: c(`id created_at updated_at local_id cliente_id plan stripe_invoice_id stripe_subscription_id
    stripe_customer_id stripe_payment_intent_id stripe_hosted_url stripe_pdf_url periodo_inicio periodo_fin fecha_emision importe
    base_imponible impuesto moneda estado intento error_pago numero_serie zoho_invoice_id zoho_invoice_number zoho_estado zoho_error
    zoho_at email_enviado_at email_destinatarios tipo saldo_aplicado`) },
  mant_abonos: { auditada: false, columnas: c(`id created_at updated_at factura_id local_id cliente_id numero_serie motivo fecha_emision
    importe base_imponible impuesto moneda zoho_creditnote_id zoho_creditnote_number zoho_estado zoho_error zoho_at
    stripe_balance_txn_id stripe_error creado_por`) },
  // Contratos de mantenimiento con su firma (paridad bloque 4, tanda 2); en el audit_log de la app.
  contratos: { auditada: true, columnas: c(`id created_at token plan_nombre cliente_id local_id contacto_id cliente_nombre cliente_nif
    direccion municipio precio_mensual cuerpo_html estado firmante_nombre firma_img firmante_ip firmante_user_agent firmado_at
    created_by notas frecuencia_pago stripe_customer_id stripe_checkout_session_id mandato_estado mandato_at servicios
    tarifa_estandar tarifa_urgente fecha_inicio vigencia_meses renovacion_automatica renovacion_avisada_at`) },
  // Plantillas de presupuesto (paridad bloque 3): fuera del audit_log de la app.
  presupuesto_plantillas: { auditada: false, columnas: c('id created_at nombre descripcion icono activa lineas') },
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
