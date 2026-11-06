package com.xtrmiptv.tv;

import android.view.KeyEvent;
import android.webkit.WebView;

/**
 * Remote keys the WebView would not pass to the page as the app needs them (Back closes the activity, media and channel keys have no
 * key code in the page): they reach it as keydown events with the code 10000 + the Android key code, which the Android adapter of the
 * app maps to its actions (platforms/android/platform.js).
 */
final class RemoteKeys {

    static final int OFFSET = 10000;

    private static final int[] FORWARDED = {
        KeyEvent.KEYCODE_BACK,
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        KeyEvent.KEYCODE_MEDIA_PLAY,
        KeyEvent.KEYCODE_MEDIA_PAUSE,
        KeyEvent.KEYCODE_MEDIA_STOP,
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
        KeyEvent.KEYCODE_MEDIA_REWIND,
        KeyEvent.KEYCODE_MEDIA_NEXT,
        KeyEvent.KEYCODE_MEDIA_PREVIOUS,
        KeyEvent.KEYCODE_CHANNEL_UP,
        KeyEvent.KEYCODE_CHANNEL_DOWN,
    };

    private RemoteKeys() {}

    static boolean isForwarded(int keyCode) {
        for (int code : FORWARDED) {
            if (code == keyCode) return true;
        }
        return false;
    }

    static void send(WebView webView, int keyCode) {
        webView.evaluateJavascript("window.__xtreamKey && window.__xtreamKey(" + (OFFSET + keyCode) + ")", null);
    }
}
