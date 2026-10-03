package com.okcomputer.hub.reloj

import android.app.RemoteInput
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import androidx.wear.input.RemoteInputIntentHelper
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Colores de la marca «OK Computer» (src/estilo.css del hub).
private val Lima = Color(0xFF7DD956)
private val Verde = Color(0xFF01BF61)
private val Noche = Color(0xFF0B1F14)
private val Tinta = Color(0xFF172C22)
private val Menta = Color(0xFFD4F4E2)
private val Ambar = Color(0xFFF5B83D)
private val Rojo = Color(0xFFFF6B6B)
private val Gris = Color(0xFF8FA89A)

private const val APP_ACTUAL = "https://okcomputertenerife.web.app/"

@Composable
fun TemaHub(contenido: @Composable () -> Unit) {
    MaterialTheme(
        colors = Colors(
            primary = Lima, primaryVariant = Verde, secondary = Lima, secondaryVariant = Verde,
            background = Color.Black, surface = Tinta, onPrimary = Noche, onSecondary = Noche,
            onBackground = Color.White, onSurface = Color.White, onSurfaceVariant = Menta, error = Rojo,
        ),
        content = contenido,
    )
}

private fun aviso(ctx: Context, texto: String) = Toast.makeText(ctx, texto, Toast.LENGTH_LONG).show()

private fun colorGravedad(g: String) = when (g) { "mal" -> Rojo; "aviso" -> Ambar; else -> Gris }

// Una pantalla en lista: hora arriba, indicador de desplazamiento y cabecera.
@Composable
private fun Lista(titulo: String?, contenido: ScalingLazyListScope.() -> Unit) {
    val estado = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(scalingLazyListState = estado) }) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(), state = estado,
            contentPadding = PaddingValues(top = 28.dp, bottom = 40.dp, start = 8.dp, end = 8.dp),
        ) {
            if (titulo != null) item { ListHeader { Text(titulo, color = Lima, fontWeight = FontWeight.Bold) } }
            contenido()
        }
    }
}

@Composable
private fun Fila(
    titulo: String, detalle: String? = null, color: Color? = null, secundaria: Boolean = true,
    alPulsar: () -> Unit = {},
) {
    Chip(
        onClick = alPulsar, modifier = Modifier.fillMaxWidth(),
        label = { Text(titulo, maxLines = 2, overflow = TextOverflow.Ellipsis, color = color ?: Color.Unspecified) },
        secondaryLabel = if (detalle != null) { { Text(detalle, maxLines = 2, overflow = TextOverflow.Ellipsis) } } else null,
        colors = if (secundaria) ChipDefaults.secondaryChipColors() else ChipDefaults.primaryChipColors(),
    )
}

@Composable
private fun Nota(texto: String, color: Color = Gris) =
    Text(texto, color = color, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp))

// ── Raíz ──────────────────────────────────────────────────────────────────
@Composable
fun AppReloj(estado: Estado, inicial: String?) {
    when (estado) {
        is Estado.SinVincular -> PantallaSinVincular()
        is Estado.Pendiente -> PantallaCodigo(estado.codigo)
        is Estado.Listo -> Navegacion(estado, inicial)
    }
}

@Composable
private fun PantallaSinVincular() {
    val ctx = LocalContext.current
    val alcance = rememberCoroutineScope()
    var pidiendo by remember { mutableStateOf(false) }
    Lista("Ok Hub") {
        item { Nota("Vincula el reloj con tu usuario del hub. Sale un código que se teclea en el hub, en «Reloj».", Menta) }
        item {
            Fila(if (pidiendo) "Pidiendo código…" else "Vincular", secundaria = false) {
                if (pidiendo) return@Fila
                pidiendo = true
                alcance.launch { Repositorio.vincular(ctx)?.let { aviso(ctx, it) }; pidiendo = false }
            }
        }
    }
}

@Composable
private fun PantallaCodigo(codigo: String) {
    val ctx = LocalContext.current
    val alcance = rememberCoroutineScope()
    // Cada 3 s: ¿ya lo han tecleado en el hub? (el código caduca a los 10 min)
    LaunchedEffect(codigo) {
        while (true) { delay(3000); Repositorio.comprobarVinculo(ctx) }
    }
    Lista(null) {
        item { Nota("Escribe en el hub › Reloj", Menta) }
        item {
            Text(codigo, color = Lima, fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
        item { Fila("Abrir en el móvil", "Con el código ya puesto") { Movil.abrir(ctx, "${Api.HUB}#/reloj/$codigo") } }
        item { Nota("Caduca en 10 minutos") }
        item { Fila("Pedir otro código") { alcance.launch { Repositorio.olvidar(ctx); Repositorio.vincular(ctx)?.let { aviso(ctx, it) } } } }
    }
}

// ── Navegación de la app vinculada ────────────────────────────────────────
@Composable
private fun Navegacion(estado: Estado.Listo, inicial: String?) {
    val ctx = LocalContext.current
    val nav = rememberSwipeDismissableNavController()
    val alcance = rememberCoroutineScope()
    var confirmar by remember { mutableStateOf<Pendiente?>(null) }
    var comanda by remember { mutableStateOf("") }
    val r = estado.resumen

    LaunchedEffect(Unit) {
        Repositorio.refrescar(ctx)
        if (inicial != null) nav.navigate(inicial)
    }

    val dictar = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val texto = res.data?.let { RemoteInput.getResultsFromIntent(it)?.getCharSequence("comanda")?.toString() }
        if (!texto.isNullOrBlank()) { comanda = texto; nav.navigate("comanda") }
    }
    val pedirComanda = {
        val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
        RemoteInputIntentHelper.putRemoteInputsExtra(intent, listOf(RemoteInput.Builder("comanda").setLabel("¿Qué hay que hacer?").build()))
        dictar.launch(intent)
    }
    val fichar = { p: Pendiente -> confirmar = p; nav.navigate("confirmar") }

    SwipeDismissableNavHost(navController = nav, startDestination = "inicio") {
        composable("inicio") { PantallaInicio(estado, { nav.navigate(it) }, pedirComanda) { alcance.launch { Repositorio.refrescar(ctx)?.let { aviso(ctx, it) } } } }
        composable("avisos") { PantallaAvisos(r) }
        composable("dia") { PantallaDia(r, fichar) { nav.navigate("parada/$it") } }
        composable("parada/{i}") { e ->
            val i = e.arguments?.getString("i")?.toIntOrNull() ?: 0
            PantallaParada(r, r?.dia?.paradas?.getOrNull(i), fichar)
        }
        composable("rmm") { PantallaRmm(r) }
        composable("cifras") { PantallaCifras(r) }
        composable("confirmar") {
            PantallaConfirmar(confirmar) { ok ->
                val p = confirmar
                if (!ok || p == null) { nav.popBackStack(); return@PantallaConfirmar }
                alcance.launch {
                    val err = Repositorio.accion(ctx, "fichar", p.datos)
                    aviso(ctx, err ?: p.hecho)
                    nav.popBackStack()
                }
            }
        }
        composable("comanda") {
            PantallaConfirmar(Pendiente("Mandar la comanda:\n«$comanda»", emptyMap(), "Comanda repartida")) { ok ->
                if (!ok) { nav.popBackStack(); return@PantallaConfirmar }
                alcance.launch {
                    val err = Repositorio.accion(ctx, "comanda", mapOf("texto" to comanda))
                    aviso(ctx, err ?: "Comanda repartida y avisada por Telegram")
                    nav.popBackStack()
                }
            }
        }
    }
}

data class Pendiente(val pregunta: String, val datos: Map<String, Any?>, val hecho: String)

@Composable
private fun PantallaInicio(estado: Estado.Listo, ir: (String) -> Unit, comanda: () -> Unit, refrescar: () -> Unit) {
    val r = estado.resumen
    Lista(r?.nombre?.substringBefore(' ')?.let { "Hola, $it" } ?: "Ok Hub") {
        if (r == null) {
            item { if (estado.actualizando) CircularProgressIndicator(indicatorColor = Lima) else Nota(estado.error ?: "Sin datos todavía") }
            item { Fila("Reintentar", alPulsar = refrescar) }
            return@Lista
        }
        item {
            Fila(
                if (r.avisosUrgentes > 0) "⚠ ${r.avisosUrgentes} urgentes" else "Avisos", "${r.avisosTotal} pendientes",
                if (r.avisosUrgentes > 0) Ambar else null,
            ) { ir("avisos") }
        }
        item {
            val s = r.dia.sesion
            val det = when {
                s?.estado == "trabajando" -> "⏱ ${s.trabajoNumero?.let { "#$it" } ?: "Trabajando"} · ${minutosDesde(s.desde)} min"
                s != null -> "🚐 En traslado · ${minutosDesde(s.desde)} min"
                r.dia.siguiente != null -> "${hora(r.dia.siguiente.inicio).ifBlank { "Hoy" }} ${r.dia.siguiente.rotulo()}"
                else -> "Sin paradas hoy"
            }
            Fila("Mi día · ${r.dia.paradas.size}", det) { ir("dia") }
        }
        item {
            Fila("Monitorización", "${r.rmm.caido} caídas · ${r.rmm.alertasAbiertas} alertas", if (r.rmm.caido > 0) Rojo else null) { ir("rmm") }
        }
        r.cifras?.let { c -> item { Fila("Cifras", "Vencido ${euros(c.vencido)} · ${c.ticketsAbiertos} tickets") { ir("cifras") } } }
        item { Fila("🎤 Comanda", "Dicta lo que hay que hacer", secundaria = false, alPulsar = comanda) }
        item {
            Fila(if (estado.actualizando) "Actualizando…" else "Actualizar", estado.error ?: "A las ${hora(r.generado)}",
                if (estado.error != null) Ambar else null, alPulsar = refrescar)
        }
    }
}

@Composable
private fun PantallaAvisos(r: Resumen?) {
    val ctx = LocalContext.current
    Lista("Avisos") {
        val lista = r?.avisos.orEmpty()
        if (lista.isEmpty()) item { Nota("Nada pendiente 👌", Menta) }
        lista.forEach { a ->
            item { Fila(a.titulo, a.detalle, colorGravedad(a.gravedad)) { Movil.abrir(ctx, a.enlace) } }
        }
        if ((r?.avisosTotal ?: 0) > lista.size) item { Nota("… y ${r!!.avisosTotal - lista.size} más en el hub") }
        item { Nota("Toca un aviso para abrirlo en el móvil") }
    }
}

@Composable
private fun PantallaDia(r: Resumen?, fichar: (Pendiente) -> Unit, abrirParada: (Int) -> Unit) {
    val ctx = LocalContext.current
    Lista("Mi día") {
        val d = r?.dia ?: return@Lista
        val s = d.sesion
        when {
            s?.estado == "trabajando" -> {
                item { Nota("⏱ ${s.trabajoNumero?.let { "#$it " } ?: ""}${s.trabajoTitulo ?: ""} desde las ${hora(s.desde)} (${minutosDesde(s.desde)} min)", Lima) }
                if (d.puedeFichar) item {
                    Fila("■ Fichar fin", secundaria = false) { fichar(Pendiente("¿Terminar la sesión de trabajo?", mapOf("que" to "fin"), "Fin fichado")) }
                }
            }
            s != null -> item { Nota("🚐 En traslado desde las ${hora(s.desde)}. Empieza en una parada.", Lima) }
            d.puedeFichar -> item {
                Fila("🚐 Fichar traslado") { fichar(Pendiente("¿Salir hacia la siguiente parada?", mapOf("que" to "traslado"), "Traslado fichado")) }
            }
        }
        if (!d.puedeFichar) item { Fila("El fichaje sigue en la app", "Abrir la app en el móvil") { Movil.abrir(ctx, APP_ACTUAL) } }
        if (d.paradas.isEmpty()) item { Nota("No tienes paradas hoy") }
        d.paradas.forEachIndexed { i, p ->
            item {
                val hecho = p.estado in listOf("Completado", "Para facturar", "Facturado", "Cancelado", "No facturar")
                Fila("${hora(p.inicio).ifBlank { "—" }} ${p.rotulo()}", listOfNotNull(p.sede ?: p.cliente, p.estado).joinToString(" · "),
                    if (hecho) Gris else null) { abrirParada(i) }
            }
        }
    }
}

@Composable
private fun PantallaParada(r: Resumen?, p: Parada?, fichar: (Pendiente) -> Unit) {
    val ctx = LocalContext.current
    Lista(null) {
        if (p == null) { item { Nota("Esa parada ya no está") }; return@Lista }
        item { Text(p.rotulo(), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
        item {
            Nota(listOfNotNull(
                hora(p.inicio).ifBlank { null }?.let { i -> hora(p.fin).ifBlank { null }?.let { "$i–$it" } ?: i },
                p.cliente, p.sede, p.direccion, p.estado,
            ).joinToString("\n"), Menta)
        }
        val s = r?.dia?.sesion
        val enCurso = s?.estado == "trabajando" && s.trabajoId == p.trabajoId
        if (r?.dia?.puedeFichar == true && p.trabajoId != null && !enCurso) item {
            Fila("▶ Empezar aquí", secundaria = false) {
                fichar(Pendiente("¿Empezar a trabajar en ${p.rotulo()}?", mapOf("que" to "inicio", "trabajo_id" to p.trabajoId), "Inicio fichado"))
            }
        }
        if (p.mapa != null) item { Fila("🗺 Cómo llegar", "En el móvil") { Movil.abrir(ctx, p.mapa) } }
        if (p.telefono != null) item { Fila("📞 ${p.telefono}", "Llamar desde el móvil") { Movil.abrir(ctx, "tel:${p.telefono.replace(" ", "")}") } }
        if (p.enlace != null) item { Fila("Abrir la ficha", "En el móvil") { Movil.abrir(ctx, p.enlace) } }
    }
}

@Composable
private fun PantallaRmm(r: Resumen?) {
    val ctx = LocalContext.current
    Lista("Monitorización") {
        val m = r?.rmm ?: return@Lista
        item {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${m.ok} bien · ${m.parcial} parcial", color = Menta, fontSize = 13.sp)
                Text("${m.alerta} con alerta · ${m.caido} caídas", color = if (m.caido > 0) Rojo else Menta, fontSize = 13.sp)
                Text("${m.sinConexion} equipos sin conexión", color = Gris, fontSize = 12.sp)
            }
        }
        m.peores.forEach { s ->
            item {
                Fila(s.sede, "${s.conectados}/${s.equipos} conectados${if (s.alertas > 0) " · ${s.alertas} alertas" else ""}",
                    when (s.estado) { "caido" -> Rojo; "alerta" -> Ambar; else -> null }) { Movil.abrir(ctx, s.enlace) }
            }
        }
        if (m.alertas.isNotEmpty()) item { ListHeader { Text("Alertas", color = Lima) } }
        m.alertas.forEach { a ->
            item { Fila(a.titulo.ifBlank { a.equipo }, listOfNotNull(a.equipo, a.sitio).joinToString(" · "), if (a.severidad in listOf("critical", "high")) Rojo else Ambar) }
        }
    }
}

@Composable
private fun PantallaCifras(r: Resumen?) {
    Lista("Cifras") {
        val c = r?.cifras ?: run { item { Nota("Solo para administración") }; return@Lista }
        val filas = listOf(
            Triple("Vencido", "${euros(c.vencido)} · ${c.facturasVencidas} facturas", if (c.vencido > 0) Ambar else null),
            Triple("Pendiente de cobro", euros(c.pendiente), null),
            Triple("Facturado este mes", euros(c.facturadoMes), null),
            Triple("Cobrado este mes", euros(c.cobradoMes), null),
            Triple("Para facturar", "${c.paraFacturar} trabajos", if (c.paraFacturar > 0) Ambar else null),
            Triple("Tickets abiertos", "${c.ticketsAbiertos} (${c.ticketsUrgentes} urgentes)", if (c.ticketsUrgentes > 0) Ambar else null),
            Triple("Oportunidades", "${c.oportunidades} · ${euros(c.oportunidadesImporte)}", null),
        )
        filas.forEach { (t, v, col) -> item { Fila(t, v, col) } }
    }
}

@Composable
private fun PantallaConfirmar(p: Pendiente?, responder: (Boolean) -> Unit) {
    var enviando by remember { mutableStateOf(false) }
    Lista(null) {
        item { Text(p?.pregunta ?: "", textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp)) }
        item {
            Fila(if (enviando) "Enviando…" else "Sí", secundaria = false) {
                if (!enviando) { enviando = true; responder(true) }
            }
        }
        item { Fila("Cancelar") { if (!enviando) responder(false) } }
    }
}
