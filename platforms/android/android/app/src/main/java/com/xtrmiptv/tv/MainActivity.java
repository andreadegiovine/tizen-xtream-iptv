package com.xtrmiptv.tv;

import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * The only activity: Capacitor's WebView with the app (built in dist/, see capacitor.config.json), and on top of what Capacitor does:
 * - the page is laid out at 1920 px wide and scaled to the screen (the interface is drawn for 1920x1080; a TV WebView would show 960 CSS px);
 * - the WebView is transparent, so ExoPlayer's video (ExoPlayerPlugin, behind it) shows where the page is transparent;
 * - requests to the provider are made natively (ProviderWebViewClient: no CORS, plain http allowed);
 * - Back, the media keys and the channel keys go to the page (RemoteKeys) instead of closing the activity.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ExoPlayerPlugin.class);
        registerPlugin(TvHostPlugin.class);
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setUseWideViewPort(true); // the <meta viewport width=1920> of the page is honoured
        settings.setLoadWithOverviewMode(true); // and the page is scaled to the width of the screen
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setFocusable(true);
        webView.requestFocus();
        getBridge().setWebViewClient(new ProviderWebViewClient(getBridge()));
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null && RemoteKeys.isForwarded(event.getKeyCode())) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) RemoteKeys.send(webView, event.getKeyCode());
            return true; // the page decides (Back on the home page asks before leaving)
        }
        return super.dispatchKeyEvent(event);
    }
}
