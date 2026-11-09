package com.aurasynq.app;

import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.DisplayCutout;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // The phone's own status bar (clock, battery, notification icons) stays hidden: the app shows its
    // own quieter bar. A swipe down from the top only shows the system bar briefly; it fades out again
    // by itself after about three seconds (transient bars), and is re-hidden whenever the app returns.
    private static final long REHIDE_DELAY_MS = 3000;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable hideBars = this::hideStatusBar;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Let the app draw beside the camera notch / punch-hole, so the in-app bar can sit there
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = getWindow().getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attrs);
        }
        hideStatusBar();

        // If the bar is shown for any reason (a swipe, a dialog), hide it again shortly after
        View decor = getWindow().getDecorView();
        decor.setOnApplyWindowInsetsListener((view, insets) -> {
            WindowInsetsCompat compat = WindowInsetsCompat.toWindowInsetsCompat(insets, view);
            if (compat.isVisible(WindowInsetsCompat.Type.statusBars())) {
                handler.removeCallbacks(hideBars);
                handler.postDelayed(hideBars, REHIDE_DELAY_MS);
            }
            publishCutout(insets);
            return view.onApplyWindowInsets(insets);
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        hideStatusBar();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Back from the notification shade, a permission dialog or another app
        if (hasFocus) hideStatusBar();
    }

    private void hideStatusBar() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.statusBars());
    }

    // Tell the page where the camera cutout is (CSS px), so its own clock and battery avoid it:
    // --cutout-left / --cutout-right for corner punch-holes, --cutout-center-width for a centre notch
    private void publishCutout(WindowInsets insets) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P || bridge == null) return;
        DisplayCutout cutout = insets.getDisplayCutout();
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        float density = metrics.density;
        int width = getWindow().getDecorView().getWidth();
        if (width == 0) width = metrics.widthPixels;
        float left = 0, right = 0, center = 0;
        if (cutout != null) {
            for (Rect r : cutout.getBoundingRects()) {
                if (r.top > 0) continue; // only cutouts at the top edge
                float cx = r.exactCenterX();
                if (cx < width / 3f) left = Math.max(left, r.right / density);
                else if (cx > width * 2f / 3f) right = Math.max(right, (width - r.left) / density);
                else center = Math.max(center, r.width() / density);
            }
        }
        final String js = String.format(java.util.Locale.US,
                "(function(s){s.setProperty('--cutout-left','%.1fpx');s.setProperty('--cutout-right','%.1fpx');" +
                "s.setProperty('--cutout-center-width','%.1fpx');})(document.documentElement.style)",
                left, right, center);
        WebView webView = bridge.getWebView();
        if (webView != null) webView.post(() -> webView.evaluateJavascript(js, null));
    }
}
