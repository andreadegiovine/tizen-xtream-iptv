package com.xtrmiptv.tv;

import android.app.ActivityManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.DisplayMetrics;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What the app asks the device (platforms/android/platform.js): leave the app, open a link in another app, the device's facts, the
 * settings screen of exact alarms.
 */
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

    /**
     * Android 12+: the "Alarms & reminders" screen of this app, where the user allows exact alarms (the scheduled viewing notifications
     * come on time). Some TVs have no such screen: then it rejects (startActivity throws), never crashes. Before Android 12 there is
     * nothing to allow.
     */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException | SecurityException e) {
            call.reject("no settings screen for exact alarms", e);
        }
    }
}
