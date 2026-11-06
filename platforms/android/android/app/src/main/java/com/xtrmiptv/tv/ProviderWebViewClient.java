package com.xtrmiptv.tv;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Capacitor's WebView client, plus: every GET to another host (the provider's API, its pictures, TMDB...) is made here, natively, and
 * answered to the page with "Access-Control-Allow-Origin: *". The Xtream servers send no CORS headers and are often plain http; this
 * way the page (and its workers) read them as on the TV. The app's own files (http://localhost) stay with Capacitor; other methods
 * (Trakt's POSTs, which allow CORS) go out normally.
 */
class ProviderWebViewClient extends BridgeWebViewClient {

    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 60000;
    private static final int MAX_REDIRECTS = 5;

    ProviderWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String scheme = url.getScheme();
        String host = url.getHost();
        boolean external = ("http".equals(scheme) || "https".equals(scheme)) && host != null && !"localhost".equalsIgnoreCase(host);
        if (external && "GET".equalsIgnoreCase(request.getMethod())) {
            try {
                return fetch(url.toString(), request.getRequestHeaders());
            } catch (IOException | RuntimeException e) {
                return null; // the WebView tries it itself (and the page sees the error it gets)
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse fetch(String address, Map<String, String> requestHeaders) throws IOException {
        String current = address;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpURLConnection connection = (HttpURLConnection) new URL(current).openConnection();
            connection.setInstanceFollowRedirects(false); // followed here, also from http to https
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            if (requestHeaders != null) {
                for (Map.Entry<String, String> header : requestHeaders.entrySet()) {
                    String name = header.getKey();
                    // Accept-Encoding is left to HttpURLConnection, which then unzips the body itself.
                    if (name == null || "Origin".equalsIgnoreCase(name) || "Referer".equalsIgnoreCase(name) || "Accept-Encoding".equalsIgnoreCase(name)) continue;
                    connection.setRequestProperty(name, header.getValue());
                }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) return null;
                current = new URL(new URL(current), location).toString();
                continue;
            }
            return toResponse(connection, status);
        }
        return null; // too many redirects: the WebView tries it itself
    }

    private static WebResourceResponse toResponse(HttpURLConnection connection, int status) throws IOException {
        String contentType = connection.getContentType();
        String mime = "application/octet-stream";
        String encoding = null;
        if (contentType != null) {
            String[] parts = contentType.split(";");
            mime = parts[0].trim();
            for (int i = 1; i < parts.length; i++) {
                String part = parts[i].trim();
                if (part.toLowerCase().startsWith("charset=")) encoding = part.substring(8).replace("\"", "").trim();
            }
        }
        Map<String, String> headers = new HashMap<>();
        for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
            String name = header.getKey();
            if (name == null || header.getValue() == null || header.getValue().isEmpty()) continue;
            String lower = name.toLowerCase();
            if (lower.startsWith("access-control-") || lower.equals("content-encoding") || lower.equals("content-length") || lower.equals("transfer-encoding")) continue; // the body may have been unzipped
            headers.put(name, header.getValue().get(0));
        }
        headers.put("Access-Control-Allow-Origin", "*");
        InputStream body = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String reason = connection.getResponseMessage();
        if (reason == null || reason.trim().isEmpty()) reason = status >= 400 ? "Error" : "OK";
        return new WebResourceResponse(mime, encoding, status, reason, headers, body);
    }
}
