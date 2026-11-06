package com.xtrmiptv.tv;

import android.app.ActivityManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.DisplayMetrics;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** What the app asks the device (platforms/android/platform.js): leave the app, open a link in another app, the device's facts. */
@CapacitorPlugin(name = "TvHost")
public class TvHostPlugin extends Plugin {

    @PluginMethod
    public void exit(PluginCall call) {
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().finish());
    }

    /** A YouTube link opens in the YouTube app of the TV (trailers); any other link in the app that handles it. */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url required");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no app opens this link", e);
        }
    }

    /** Flavor (androidtv / firetv), model, Android version, screen in pixels and memory of the device. */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject out = new JSObject();
        out.put("flavor", BuildConfig.FLAVOR);
        out.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        out.put("android", Build.VERSION.RELEASE);
        out.put("sdk", Build.VERSION.SDK_INT);
        DisplayMetrics metrics = new DisplayMetrics();
        getActivity().getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
        out.put("width", metrics.widthPixels);
        out.put("height", metrics.heightPixels);
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (manager != null) {
            ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
            manager.getMemoryInfo(memory);
            out.put("memoryTotal", memory.totalMem);
            out.put("memoryAvailable", memory.availMem);
        }
        call.resolve(out);
    }
}
