package io.github.bartoman.sc26atlas

import android.content.res.AssetManager
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.URLConnection

/**
 * Serves APK assets for https://appassets.androidplatform.net/assets/... with explicit MIME types
 * (ES modules and fetch() are strict about them). Assets are streamed, so multi-MB JSON is fine.
 * A missing file answers 404 instead of falling through to the network.
 */
class WebAssetHandler(private val assets: AssetManager) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse {
        val file = if (path.isEmpty() || path.endsWith("/")) path + "index.html" else path
        val extension = file.substringAfterLast('/').substringAfterLast('.', "").lowercase()
        val mime = MIME_TYPES[extension]
            ?: URLConnection.guessContentTypeFromName(file)
            ?: "application/octet-stream"
        val charset = if (mime.startsWith("text/") || mime in TEXT_TYPES) "utf-8" else null
        return try {
            WebResourceResponse(mime, charset, assets.open(file, AssetManager.ACCESS_STREAMING))
        } catch (e: IOException) {
            WebResourceResponse(
                "text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)),
            )
        }
    }

    private companion object {
        val MIME_TYPES = mapOf(
            "html" to "text/html", "htm" to "text/html",
            "js" to "text/javascript", "mjs" to "text/javascript",
            "css" to "text/css",
            "json" to "application/json", "map" to "application/json",
            "geojson" to "application/geo+json",
            "webmanifest" to "application/manifest+json",
            "txt" to "text/plain", "csv" to "text/csv", "ics" to "text/calendar",
            "xml" to "application/xml",
            "svg" to "image/svg+xml",
            "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg",
            "gif" to "image/gif", "webp" to "image/webp", "avif" to "image/avif",
            "ico" to "image/x-icon",
            "woff2" to "font/woff2", "woff" to "font/woff", "ttf" to "font/ttf", "otf" to "font/otf",
            "wasm" to "application/wasm", "pdf" to "application/pdf",
            "mp3" to "audio/mpeg", "mp4" to "video/mp4", "webm" to "video/webm",
        )
        val TEXT_TYPES = setOf(
            "application/json", "application/geo+json", "application/manifest+json",
            "application/xml", "image/svg+xml",
        )
    }
}
