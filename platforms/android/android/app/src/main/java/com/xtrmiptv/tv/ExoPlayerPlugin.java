package com.xtrmiptv.tv;

import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/**
 * The video engine of the Android app (the AVPlay of the TV): ExoPlayer draws on a view behind the transparent WebView, the page keeps
 * its own controls on top. Driven by platforms/android/exoEngine.js; everything it tells the page goes through one listener, "event":
 *   { type: 'prepared' | 'buffering' | 'bufferingDone' | 'ended' | 'error' (message) | 'time' (position, duration, buffered, ms)
 *     | 'tracks' (audio: [{ index, language, current }], text: [{ index, language }]) }
 * MPEG-TS, HLS, MKV, MP4 and the audio formats of the device (AC3 / E-AC3 on most TVs) are played by ExoPlayer itself.
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "ExoPlayer")
public class ExoPlayerPlugin extends Plugin {

    private static final long TICK_MS = 500;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private PlayerView view;
    private boolean prepared;
    private final List<TrackRef> audioTracks = new ArrayList<>();
    private final List<TrackRef> textTracks = new ArrayList<>();

    /** A track of a group, as the page numbers them (index in the list of its type). */
    private static final class TrackRef {
        final TrackGroup group;
        final int index;
        final String language;
        final boolean selected;

        TrackRef(TrackGroup group, int index, String language, boolean selected) {
            this.group = group;
            this.index = index;
            this.language = language;
            this.selected = selected;
        }
    }

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (player == null) return;
            JSObject data = new JSObject();
            data.put("position", Math.max(0, player.getCurrentPosition()));
            long duration = player.getDuration();
            data.put("duration", duration == C.TIME_UNSET ? 0 : duration);
            data.put("buffered", Math.max(0, player.getBufferedPosition()));
            emit("time", data);
            handler.postDelayed(this, TICK_MS);
        }
    };

    private void emit(String type, JSObject data) {
        JSObject event = data == null ? new JSObject() : data;
        event.put("type", type);
        notifyListeners("event", event);
    }

    /** start({ url, bufferSeconds }): a new video, from its start (the page seeks to where it should resume). */
    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        int bufferSeconds = call.getInt("bufferSeconds", 10);
        if (url == null) {
            call.reject("url required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            release();
            create(Math.max(2, bufferSeconds));
            player.setMediaItem(MediaItem.fromUri(url));
            player.prepare();
            player.setPlayWhenReady(true);
            handler.post(ticker);
            call.resolve();
        });
    }

    private void create(int bufferSeconds) {
        int bufferMs = bufferSeconds * 1000;
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(Math.max(bufferMs, 15000), Math.max(bufferMs * 2, 50000), Math.min(bufferMs, 2500), Math.min(bufferMs * 2, 5000))
            .build();
        player = new ExoPlayer.Builder(getContext()).setLoadControl(loadControl).build();
        prepared = false;
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_BUFFERING) {
                    JSObject data = new JSObject();
                    data.put("percent", 0);
                    emit("buffering", data);
                } else if (state == Player.STATE_READY) {
                    if (!prepared) {
                        prepared = true;
                        emit("prepared", null);
                    } else emit("bufferingDone", null);
                } else if (state == Player.STATE_ENDED) emit("ended", null);
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                JSObject data = new JSObject();
                data.put("message", error.getErrorCodeName() + (error.getMessage() != null ? ": " + error.getMessage() : ""));
                emit("error", data);
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                readTracks(tracks);
            }
        });
        view = new PlayerView(getContext());
        view.setUseController(false);
        view.setShutterBackgroundColor(Color.BLACK);
        view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        view.setPlayer(player);
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(Color.TRANSPARENT); // again: the video shows only where the WebView (and the page) is transparent
        ViewGroup parent = (ViewGroup) webView.getParent();
        parent.addView(view, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void readTracks(Tracks tracks) {
        audioTracks.clear();
        textTracks.clear();
        for (Tracks.Group group : tracks.getGroups()) {
            int type = group.getType();
            if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i)) continue;
                Format format = group.getTrackFormat(i);
                TrackRef ref = new TrackRef(group.getMediaTrackGroup(), i, format.language == null ? "" : format.language, group.isTrackSelected(i));
                if (type == C.TRACK_TYPE_AUDIO) audioTracks.add(ref);
                else textTracks.add(ref);
            }
        }
        JSArray audio = new JSArray();
        for (int i = 0; i < audioTracks.size(); i++) {
            JSObject track = new JSObject();
            track.put("index", i);
            track.put("language", audioTracks.get(i).language);
            track.put("current", audioTracks.get(i).selected);
            audio.put(track);
        }
        JSArray text = new JSArray();
        for (int i = 0; i < textTracks.size(); i++) {
            JSObject track = new JSObject();
            track.put("index", i);
            track.put("language", textTracks.get(i).language);
            text.put(track);
        }
        JSObject data = new JSObject();
        data.put("audio", audio);
        data.put("text", text);
        emit("tracks", data);
    }

    @PluginMethod
    public void play(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) player.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) player.pause();
            call.resolve();
        });
    }

    /** seekTo({ ms }) */
    @PluginMethod
    public void seekTo(PluginCall call) {
        long ms = call.getLong("ms", 0L);
        getActivity().runOnUiThread(() -> {
            if (player != null) player.seekTo(Math.max(0, ms));
            call.resolve();
        });
    }

    /** setAspect({ mode: 'fit' | 'fill' | 'zoom' }): letterbox, stretched, cropped to fill the screen. */
    @PluginMethod
    public void setAspect(PluginCall call) {
        String mode = call.getString("mode", "fit");
        getActivity().runOnUiThread(() -> {
            if (view != null) {
                int resize = "fill".equals(mode) ? AspectRatioFrameLayout.RESIZE_MODE_FILL : "zoom".equals(mode) ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM : AspectRatioFrameLayout.RESIZE_MODE_FIT;
                view.setResizeMode(resize);
            }
            call.resolve();
        });
    }

    /** selectAudio({ index }): a track of the 'tracks' event. */
    @PluginMethod
    public void selectAudio(PluginCall call) {
        int index = call.getInt("index", -1);
        getActivity().runOnUiThread(() -> {
            if (player != null && index >= 0 && index < audioTracks.size()) {
                TrackRef ref = audioTracks.get(index);
                player.setTrackSelectionParameters(
                    player.getTrackSelectionParameters().buildUpon().setOverrideForType(new TrackSelectionOverride(ref.group, ref.index)).build()
                );
            }
            call.resolve();
        });
    }

    /** selectText({ index }): a subtitle track drawn by ExoPlayer, or -1 for none. */
    @PluginMethod
    public void selectText(PluginCall call) {
        int index = call.getInt("index", -1);
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                TrackSelectionParameters.Builder builder = player.getTrackSelectionParameters().buildUpon();
                if (index < 0 || index >= textTracks.size()) builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
                else {
                    TrackRef ref = textTracks.get(index);
                    builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setOverrideForType(new TrackSelectionOverride(ref.group, ref.index));
                }
                player.setTrackSelectionParameters(builder.build());
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            release();
            call.resolve();
        });
    }

    private void release() {
        handler.removeCallbacks(ticker);
        if (player != null) {
            player.release();
            player = null;
        }
        if (view != null) {
            ViewGroup parent = (ViewGroup) view.getParent();
            if (parent != null) parent.removeView(view);
            view = null;
        }
        audioTracks.clear();
        textTracks.clear();
        prepared = false;
    }

    // The app in the background (Home, standby): the video pauses; it is released when the app closes.
    @Override
    protected void handleOnPause() {
        if (player != null) player.pause();
    }

    @Override
    protected void handleOnDestroy() {
        release();
    }
}
