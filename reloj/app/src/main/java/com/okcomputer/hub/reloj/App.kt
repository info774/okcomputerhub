package com.okcomputer.hub.reloj

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Repositorio.cargar(this)
        if (Repositorio.estado.value is Estado.Listo) Refresco.programar(this)
    }
}
