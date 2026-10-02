package com.okcomputer.hub.reloj

import android.content.ComponentName
import android.content.Context
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONObject

// El estado de la app: vinculado o no, y el último resumen. Lo guarda en
// SharedPreferences (privadas de la app) para que la tile y la complicación
// pinten al instante, sin red, y la red refresca detrás.
sealed interface Estado {
    data object SinVincular : Estado
    data class Pendiente(val codigo: String) : Estado
    data class Listo(val resumen: Resumen?, val actualizando: Boolean = false, val error: String? = null) : Estado
}

object Repositorio {
    private const val PREFS = "okhub"
    private val _estado = MutableStateFlow<Estado>(Estado.SinVincular)
    val estado: StateFlow<Estado> = _estado.asStateFlow()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun token(ctx: Context): String? = prefs(ctx).getString("token", null)

    fun resumenGuardado(ctx: Context): Resumen? = prefs(ctx).getString("resumen", null)?.let {
        try { leerResumen(JSONObject(it)) } catch (_: Exception) { null }
    }

    fun cargar(ctx: Context) {
        val p = prefs(ctx)
        _estado.value = when {
            p.getString("token", null) == null -> Estado.SinVincular
            p.getString("codigo", null) != null -> Estado.Pendiente(p.getString("codigo", "")!!)
            else -> Estado.Listo(resumenGuardado(ctx))
        }
    }

    // Pide token + código al hub; el token no vale hasta que se teclea el código en #/reloj.
    suspend fun vincular(ctx: Context): String? {
        val r = try { Api.llamar("vincular", null) } catch (e: Exception) { return "Sin conexión: ${e.message}" }
        if (!r.ok) return r.error
        val codigo = r.cuerpo.optString("codigo")
        prefs(ctx).edit().putString("token", r.cuerpo.optString("token")).putString("codigo", codigo).remove("resumen").apply()
        _estado.value = Estado.Pendiente(codigo)
        return null
    }

    // Mientras se enseña el código: ¿ya lo han tecleado en el hub?
    suspend fun comprobarVinculo(ctx: Context) {
        val r = try { Api.llamar("estado", token(ctx)) } catch (_: Exception) { return }
        when {
            r.ok && r.cuerpo.optString("estado") == "ok" -> {
                prefs(ctx).edit().remove("codigo").apply()
                _estado.value = Estado.Listo(null)
                refrescar(ctx)
                Refresco.programar(ctx)
            }
            r.codigo == 401 -> olvidar(ctx)   // caducó (10 min): se pide otro
        }
    }

    suspend fun refrescar(ctx: Context): String? {
        val token = token(ctx) ?: return "Sin vincular"
        _estado.update { if (it is Estado.Listo) it.copy(actualizando = true, error = null) else it }
        val r = try { Api.llamar("resumen", token) } catch (e: Exception) {
            _estado.update { if (it is Estado.Listo) it.copy(actualizando = false, error = "Sin conexión") else it }
            return "Sin conexión"
        }
        if (r.codigo == 401) { olvidar(ctx); return "El reloj se ha desvinculado" }
        if (!r.ok) {
            _estado.update { if (it is Estado.Listo) it.copy(actualizando = false, error = r.error) else it }
            return r.error
        }
        prefs(ctx).edit().putString("resumen", r.cuerpo.toString()).apply()
        _estado.value = Estado.Listo(leerResumen(r.cuerpo))
        avisarEsfera(ctx)
        return null
    }

    // Fichar / comanda: devuelve el error para enseñarlo, o null si fue bien.
    suspend fun accion(ctx: Context, accion: String, extra: Map<String, Any?>): String? {
        val r = try { Api.llamar(accion, token(ctx), extra) } catch (e: Exception) { return "Sin conexión" }
        if (r.codigo == 401) { olvidar(ctx); return "El reloj se ha desvinculado" }
        if (!r.ok) return r.error
        refrescar(ctx)
        return null
    }

    fun olvidar(ctx: Context) {
        prefs(ctx).edit().clear().apply()
        _estado.value = Estado.SinVincular
        Refresco.cancelar(ctx)
        avisarEsfera(ctx)
    }

    // Que la tile y la complicación se repinten con lo nuevo.
    fun avisarEsfera(ctx: Context) {
        try { TileService.getUpdater(ctx).requestUpdate(HubTileService::class.java) } catch (_: Exception) { }
        try {
            ComplicationDataSourceUpdateRequester.create(ctx, ComponentName(ctx, AvisosComplicacion::class.java)).requestUpdateAll()
        } catch (_: Exception) { }
    }
}
