plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// versionCode: el número de la ejecución de Actions (crece solo); en local, 1.
val numero = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "com.okcomputer.hub.reloj"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.okcomputer.hub.reloj"
        minSdk = 30          // Wear OS 3 (Galaxy Watch 4 en adelante)
        targetSdk = 34
        versionCode = numero
        versionName = "1.0.$numero"
    }

    // Siempre la MISMA firma: así cada versión se instala encima de la anterior.
    // La clave de reloj-firma.jks es solo para instalar a mano (no hay tienda);
    // con los secrets RELOJ_KEYSTORE_* se usa otra sin tocar esto.
    signingConfigs {
        create("reloj") {
            val propia = System.getenv("RELOJ_KEYSTORE_FILE")
            storeFile = file(propia ?: "reloj-firma.jks")
            storePassword = System.getenv("RELOJ_KEYSTORE_PASSWORD") ?: "okhub-reloj"
            keyAlias = System.getenv("RELOJ_KEY_ALIAS") ?: "okhub"
            keyPassword = System.getenv("RELOJ_KEY_PASSWORD") ?: "okhub-reloj"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("reloj")
        }
        debug {
            signingConfig = signingConfigs.getByName("reloj")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.02.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.core:core-ktx:1.15.0")

    implementation("androidx.wear.compose:compose-material:1.4.1")
    implementation("androidx.wear.compose:compose-foundation:1.4.1")
    implementation("androidx.wear.compose:compose-navigation:1.4.1")
    implementation("androidx.wear:wear-input:1.1.0")
    implementation("androidx.wear:wear-remote-interactions:1.1.0")

    implementation("androidx.wear.tiles:tiles:1.4.1")
    implementation("androidx.wear.protolayout:protolayout:1.2.1")
    implementation("androidx.wear.watchface:watchface-complications-data-source-ktx:1.2.1")
    implementation("androidx.concurrent:concurrent-futures:1.2.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
