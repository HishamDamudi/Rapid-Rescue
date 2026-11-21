package com.example.rapidrescue;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.NonNull;

import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.EventChannel;

public class MainActivity extends FlutterActivity {
    private static final String CHANNEL = "rapidrescue/temperature";
    private BroadcastReceiver tempReceiver;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Heads-up channel for relative SOS alerts (Android 8+). FCM posts into it by id.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel("rapidrescue_alerts", "Relative alerts", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("SOS alerts from your relatives");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    @Override
    public void configureFlutterEngine(@NonNull FlutterEngine flutterEngine) {
        super.configureFlutterEngine(flutterEngine);

        new EventChannel(flutterEngine.getDartExecutor().getBinaryMessenger(), CHANNEL).setStreamHandler(
            new EventChannel.StreamHandler() {
                @Override
                public void onListen(Object arguments, final EventChannel.EventSink events) {
                    // ACTION_BATTERY_CHANGED is sticky: registering delivers the current state at once,
                    // then again on every change (including temperature).
                    tempReceiver = new BroadcastReceiver() {
                        @Override
                        public void onReceive(Context context, Intent intent) {
                            if (intent == null) return;
                            int tenths = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
                            if (tenths != Integer.MIN_VALUE) events.success(tenths / 10.0);
                        }
                    };
                    registerReceiver(tempReceiver, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                }

                @Override
                public void onCancel(Object arguments) {
                    unregisterTemp();
                }
            }
        );
    }

    private void unregisterTemp() {
        if (tempReceiver != null) {
            try { unregisterReceiver(tempReceiver); } catch (Exception ignored) { }
            tempReceiver = null;
        }
    }

    @Override
    protected void onDestroy() {
        unregisterTemp();
        super.onDestroy();
    }
}
