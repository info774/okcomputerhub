package com.okcomputer.hub.reloj

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val inicial = intent?.getStringExtra(EXTRA_PANTALLA)
        setContent {
            val estado by Repositorio.estado.collectAsState()
            TemaHub { AppReloj(estado, inicial) }
        }
    }

    companion object {
        const val EXTRA_PANTALLA = "pantalla"
    }
}
