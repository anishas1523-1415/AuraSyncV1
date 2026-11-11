# AuraSynq release shrinking (R8). Capacitor's own rules (shipped with @capacitor/android) already
# keep every plugin class and its @PluginMethod methods; Firebase / Google libraries ship theirs.
# The rules below are belt-and-braces for things looked up by name at runtime.

# Methods the WebView calls from JavaScript
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor's bridge finds plugins and their callbacks by annotation and reflection
-keep class com.getcapacitor.** { *; }
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod, Exceptions

# This app's own classes (MainActivity and anything declared in the manifest)
-keep class com.aurasynq.app.** { *; }

# Keep crash stack traces readable (line numbers), without keeping source file names public
-keepattributes LineNumberTable
-renamesourcefileattribute SourceFile

# The Firebase sign-in plugin has optional Facebook login code; the Facebook SDK isn't part of this
# app (no Facebook login), so its classes are absent on purpose
-dontwarn com.facebook.**
