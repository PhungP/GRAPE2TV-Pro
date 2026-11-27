import { useEffect, useRef } from "react";

// ===== Cầu nối với Android (MainActivity.kt). Chạy trên trình duyệt thì Android = undefined → dùng dữ liệu mẫu =====
export type AndroidBridge = {
  ready(): void; reportError(msg: string, fatal: boolean): void; recover(): void; log(event: string, detail: string): void; getDiagnostics(): string;
  getApps(): string; launch(pkg: string): boolean; launchWith(pkg: string, extra: string): boolean; getArt(): string; getNowPlaying(): string; getProgress(): string; media(action: string): void;
  openNotificationAccess(): void; openSystemSettings(): void; openWifiSettings(): void; getNetwork(): string; getLibraryCovers(): string; debugSessions(): string; fetchText(url: string, id: string): void; getInfo(): string;
  downloadAndInstall(url: string): void; getDownloadProgress(): number;
};
declare global { interface Window { Android?: AndroidBridge; __onBack?: () => boolean; __cb?: (id: string, text: string) => void; __setActive?: (a: boolean) => void; __mediaChanged?: () => void; __netChanged?: () => void; __appsChanged?: () => void; __alive?: () => number } }

// ===== Launcher đang hiển thị hay đang ẩn (Android gọi __setActive khi onResume/onPause) =====
// Khi ẩn: mọi bộ đếm dừng, không polling. Khi hiện lại: mỗi bộ đếm tự đồng bộ ngay một lần.
export let activeNow = typeof document === "undefined" ? true : document.visibilityState !== "hidden";
export const activeSubs = new Set<(a: boolean) => void>();
export const setActiveNow = (a: boolean) => { if (a === activeNow) return; activeNow = a; activeSubs.forEach((f) => f(a)); };
window.__setActive = setActiveNow;
document.addEventListener("visibilitychange", () => setActiveNow(document.visibilityState !== "hidden"));
/** Chạy fn ngay rồi lặp mỗi `ms` mili-giây, chỉ khi launcher hiển thị; hiện lại thì chạy ngay. ms=0: không lặp (chỉ chạy lúc hiện lại). */
export function useActiveTick(fn: () => void, ms: number, on = true) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    if (!on) return;
    let t: number | undefined;
    const start = () => { ref.current(); if (ms > 0) t = window.setInterval(() => ref.current(), ms); };
    const stop = () => { if (t !== undefined) { window.clearInterval(t); t = undefined; } };
    if (activeNow) start();
    const sub = (a: boolean) => { stop(); if (a) start(); };
    activeSubs.add(sub);
    return () => { stop(); activeSubs.delete(sub); };
  }, [ms, on]);
}
/** Đăng ký hàm Android gọi khi có thay đổi (window.__mediaChanged ...). */
export function useNativeEvent(name: "__mediaChanged" | "__netChanged" | "__appsChanged", fn: () => void) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { window[name] = () => ref.current(); return () => { window[name] = undefined; }; }, [name]);
}

// Gọi mạng qua Android (tránh giới hạn CORS của WebView); chỉ các máy chủ trong danh sách cho phép ở phía Android
const pendingCb: Record<string, (t: string) => void> = {};
window.__cb = (id, t) => { pendingCb[id]?.(t); delete pendingCb[id]; };
export const nativeFetch = (url: string) => new Promise<string>((resolve) => {
  const b = window.Android;
  if (!b) { resolve(""); return; }
  const id = Math.random().toString(36).slice(2);
  pendingCb[id] = resolve;
  b.fetchText(url, id);
  window.setTimeout(() => { if (pendingCb[id]) { delete pendingCb[id]; resolve(""); } }, 12000);
});
export const bridge = (): AndroidBridge | undefined => window.Android;
export const safeJson = <T,>(raw: string | undefined, fallback: T): T => { try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };

window.__alive = () => 1;
