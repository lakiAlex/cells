import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

// Anonymous usage stats through Aptabase, switched in the gear menu. On unless turned off.
const KEY = "cells.usageStats";

export function usageStatsOn() {
  return localStorage.getItem(KEY) !== "0";
}

export function saveUsageStats(on: boolean) {
  localStorage.setItem(KEY, on ? "1" : "0");
}

/**
 * Sends one anonymous "app_started" event, from the main window only, so extra windows do not count twice.
 * Does nothing when the setting is off, and fails quietly in builds without an Aptabase key.
 */
export function trackAppStarted() {
  if (!usageStatsOn() || getCurrentWebviewWindow().label !== "main") return;
  invoke("plugin:aptabase|track_event", { name: "app_started" }).catch(() => {});
}
