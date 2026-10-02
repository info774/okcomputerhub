package com.okcomputer.hub.reloj

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// Lo que devuelve la función `reloj` del hub (acción `resumen`), en Kotlin.

data class Aviso(val tipo: String, val gravedad: String, val titulo: String, val detalle: String?, val enlace: String?)

data class Parada(
    val trabajoId: String?, val numero: Int?, val titulo: String, val estado: String?,
    val inicio: String?, val fin: String?, val cliente: String?, val sede: String?,
    val direccion: String?, val telefono: String?, val mapa: String?, val enlace: String?,
)

data class Fichaje(val estado: String, val desde: String?, val trabajoId: String?, val trabajoNumero: Int?, val trabajoTitulo: String?)

data class Dia(val puedeFichar: Boolean, val sesion: Fichaje?, val siguiente: Parada?, val paradas: List<Parada>)

data class SedeRmm(val sede: String, val estado: String, val conectados: Int, val equipos: Int, val alertas: Int, val enlace: String?)

data class AlertaRmm(val equipo: String, val sitio: String?, val severidad: String?, val titulo: String)

data class Rmm(
    val ok: Int, val alerta: Int, val parcial: Int, val caido: Int,
    val sinConexion: Int, val alertasAbiertas: Int, val peores: List<SedeRmm>, val alertas: List<AlertaRmm>,
)

data class Cifras(
    val ticketsAbiertos: Int, val ticketsUrgentes: Int, val oportunidades: Int, val oportunidadesImporte: Double,
    val facturadoMes: Double, val cobradoMes: Double, val pendiente: Double, val vencido: Double,
    val facturasVencidas: Int, val paraFacturar: Int,
)

data class Resumen(
    val generado: String, val nombre: String, val admin: Boolean,
    val avisosTotal: Int, val avisosUrgentes: Int, val avisos: List<Aviso>,
    val dia: Dia, val rmm: Rmm, val cifras: Cifras?,
)

private fun JSONObject.txt(k: String): String? = if (!has(k) || isNull(k)) null else optString(k).ifBlank { null }
private fun JSONObject.ent(k: String): Int = optInt(k, 0)
private fun JSONObject.num(k: String): Double = optDouble(k, 0.0).let { if (it.isNaN()) 0.0 else it }
private fun JSONObject.entONulo(k: String): Int? = if (!has(k) || isNull(k)) null else optInt(k)
private inline fun <T> JSONArray?.lista(f: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.let(f) }

private fun parada(j: JSONObject) = Parada(
    j.txt("trabajo_id"), j.entONulo("numero"), j.txt("titulo") ?: "Cita", j.txt("estado"),
    j.txt("inicio"), j.txt("fin"), j.txt("cliente"), j.txt("sede"),
    j.txt("direccion"), j.txt("telefono"), j.txt("mapa"), j.txt("enlace"),
)

fun leerResumen(j: JSONObject): Resumen {
    val persona = j.optJSONObject("persona") ?: JSONObject()
    val av = j.optJSONObject("avisos") ?: JSONObject()
    val d = j.optJSONObject("dia") ?: JSONObject()
    val r = j.optJSONObject("rmm") ?: JSONObject()
    val sedes = r.optJSONObject("sedes") ?: JSONObject()
    val c = j.optJSONObject("cifras")
    val s = d.optJSONObject("sesion")
    val t = s?.optJSONObject("trabajo")
    return Resumen(
        generado = j.txt("generado") ?: "",
        nombre = persona.txt("nombre") ?: "",
        admin = persona.optBoolean("admin"),
        avisosTotal = av.ent("total"), avisosUrgentes = av.ent("urgentes"),
        avisos = av.optJSONArray("lista").lista { Aviso(it.txt("tipo") ?: "", it.txt("gravedad") ?: "", it.txt("titulo") ?: "", it.txt("detalle"), it.txt("enlace")) },
        dia = Dia(
            puedeFichar = d.optBoolean("puede_fichar"),
            sesion = s?.let { Fichaje(it.txt("estado") ?: "traslado", it.txt("desde"), t?.txt("id"), t?.entONulo("numero"), t?.txt("titulo")) },
            siguiente = d.optJSONObject("siguiente")?.let(::parada),
            paradas = d.optJSONArray("paradas").lista(::parada),
        ),
        rmm = Rmm(
            sedes.ent("ok"), sedes.ent("alerta"), sedes.ent("parcial"), sedes.ent("caido"),
            r.ent("equipos_sin_conexion"), r.ent("alertas_abiertas"),
            r.optJSONArray("peores").lista { SedeRmm(it.txt("sede") ?: "Sede", it.txt("estado") ?: "", it.ent("conectados"), it.ent("equipos"), it.ent("alertas"), it.txt("enlace")) },
            r.optJSONArray("alertas").lista { AlertaRmm(it.txt("equipo") ?: "Equipo", it.txt("sitio"), it.txt("severidad"), it.txt("titulo") ?: "") },
        ),
        cifras = c?.let {
            Cifras(it.ent("tickets_abiertos"), it.ent("tickets_urgentes"), it.ent("oportunidades_abiertas"), it.num("oportunidades_importe"),
                it.num("facturado_mes"), it.num("cobrado_mes"), it.num("pendiente"), it.num("vencido"),
                it.ent("facturas_vencidas"), it.ent("para_facturar"))
        },
    )
}

// ── Formato ──────────────────────────────────────────────────────────────
private val HORA = DateTimeFormatter.ofPattern("HH:mm")
private val EUROS = NumberFormat.getCurrencyInstance(Locale("es", "ES")).apply { maximumFractionDigits = 0 }

fun hora(iso: String?): String = try {
    if (iso == null) "" else OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(HORA)
} catch (_: Exception) { "" }

fun minutosDesde(iso: String?): Long = try {
    if (iso == null) 0 else maxOf(0, (System.currentTimeMillis() - OffsetDateTime.parse(iso).toInstant().toEpochMilli()) / 60000)
} catch (_: Exception) { 0 }

fun euros(n: Double): String = EUROS.format(n)

fun Parada.rotulo(): String = (numero?.let { "#$it " } ?: "") + titulo
