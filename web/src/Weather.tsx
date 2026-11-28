import React, { useCallback, useEffect, useRef, useState } from "react";
import { Sun, Moon, Cloud, CloudSun, CloudMoon, CloudRain, CloudDrizzle, CloudLightning, CloudFog, Snowflake, CloudOff, RefreshCw } from "lucide-react";
import { activeNow, activeSubs, useActiveTick } from "./native";
import { Boundary } from "./Boundary";

// ===== Dữ liệu: Open-Meteo (miễn phí, không cần khoá API). Vị trí cố định: Hải Phòng =====
type Wx = { temp: number; feels: number; code: number; day: boolean; hi: number; lo: number; rain: number };
type Err = "offline" | "timeout" | "api" | "nodata";
const CITY = "Hải Phòng";
const URL_WX = "https://api.open-meteo.com/v1/forecast?latitude=20.8449&longitude=106.6881&current=temperature_2m,apparent_temperature,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FBangkok&forecast_days=1";
const KEY = "grape-weather-v2";
const REFRESH_MS = 20 * 60 * 1000;   // làm mới định kỳ
const STALE_MS = 45 * 60 * 1000;     // quá hạn này thì đánh dấu "dữ liệu cũ"
const TIMEOUT_MS = 10000;
const MSG: Record<Err, string> = { offline: "Không có mạng", timeout: "Máy chủ phản hồi chậm", api: "Dịch vụ thời tiết đang lỗi", nodata: "Chưa có dữ liệu thời tiết" };

export function wmo(code: number) {
  if (code === 0) return "Trời quang"; if (code === 1) return "Ít mây"; if (code === 2) return "Có mây"; if (code === 3) return "Nhiều mây";
  if (code <= 48) return "Sương mù"; if (code <= 57) return "Mưa phùn"; if (code <= 67) return "Mưa";
  if (code <= 77) return "Tuyết"; if (code <= 82) return "Mưa rào"; if (code <= 86) return "Tuyết rơi"; return "Dông";
}
function WxIcon({ code, day, size }: { code: number; day: boolean; size: number }) {
  const P = { size, strokeWidth: 1.8 };
  if (code === 0) return day ? <Sun {...P} /> : <Moon {...P} />;
  if (code <= 2) return day ? <CloudSun {...P} /> : <CloudMoon {...P} />;
  if (code === 3) return <Cloud {...P} />;
  if (code <= 48) return <CloudFog {...P} />;
  if (code <= 57) return <CloudDrizzle {...P} />;
  if (code <= 67 || (code >= 80 && code <= 82)) return <CloudRain {...P} />;
  if (code <= 77 || (code >= 85 && code <= 86)) return <Snowflake {...P} />;
  return <CloudLightning {...P} />;
}

type Saved = { at: number; wx: Wx };
const loadSaved = (): Saved | null => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null") as Saved | null;
    return s && typeof s.at === "number" && s.wx && Number.isFinite(s.wx.temp) ? s : null;
  } catch { return null; }
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function parse(j: any): Wx | null {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = j?.current, d = j?.daily;
  const temp = num(c?.temperature_2m), code = num(c?.weather_code);
  if (temp === null || code === null) return null;
  return { temp: Math.round(temp), feels: Math.round(num(c.apparent_temperature) ?? temp), code, day: c.is_day !== 0,
    hi: Math.round(num(d?.temperature_2m_max?.[0]) ?? temp), lo: Math.round(num(d?.temperature_2m_min?.[0]) ?? temp), rain: Math.round(num(d?.precipitation_probability_max?.[0]) ?? 0) };
}

/** Tải thời tiết: 1 yêu cầu tại một thời điểm, hết giờ 10 giây, lỗi thì thử lại giãn dần (1→2→4→8→16→20 phút), không tải khi launcher ẩn. */
function useWeather() {
  const [saved, setSaved] = useState<Saved | null>(loadSaved);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<Err | null>(null);
  const [, setTick] = useState(0);
  const inflight = useRef(false);
  const fails = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  const savedRef = useRef(saved); savedRef.current = saved;

  const schedule = useCallback((ms: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => load(false), ms); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async (manual: boolean) => {
    if (inflight.current || !alive.current) return;
    if (!manual && !activeNow) return;                        // launcher ẩn: sẽ tải khi hiện lại
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setErr("offline"); return; } // 'online' event sẽ kích hoạt tải lại
    inflight.current = true; setLoading(true);
    const ac = new AbortController(); const to = window.setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(URL_WX, { signal: ac.signal });
      if (!r.ok) throw Object.assign(new Error("http"), { kind: "api" });
      const wx = parse(await r.json());
      if (!wx) throw Object.assign(new Error("parse"), { kind: "nodata" });
      const s = { at: Date.now(), wx };
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* đầy bộ nhớ: bỏ qua */ }
      if (alive.current) { setSaved(s); setErr(null); }
      fails.current = 0; schedule(REFRESH_MS);
    } catch (e) {
      const k = (e as { kind?: string }).kind;
      const kind: Err = (e as Error).name === "AbortError" ? "timeout" : k === "api" ? "api" : k === "nodata" ? "nodata" : "offline";
      if (alive.current) setErr(kind);
      fails.current += 1; schedule(Math.min(60000 * 2 ** (fails.current - 1), REFRESH_MS));
    } finally { window.clearTimeout(to); inflight.current = false; if (alive.current) setLoading(false); }
  }, [schedule]);

  useEffect(() => {
    alive.current = true;
    const stale = savedRef.current ? Date.now() - savedRef.current.at > REFRESH_MS : true;
    if (stale) load(false); else schedule(REFRESH_MS - (Date.now() - savedRef.current!.at));
    const onOnline = () => load(false);
    window.addEventListener("online", onOnline);
    const sub = (a: boolean) => { if (a && (!savedRef.current || Date.now() - savedRef.current.at > REFRESH_MS)) load(false); };
    activeSubs.add(sub);
    return () => { alive.current = false; window.clearTimeout(timer.current); window.removeEventListener("online", onOnline); activeSubs.delete(sub); };
  }, [load, schedule]);
  useActiveTick(() => setTick((n) => n + 1), 5 * 60 * 1000);   // chỉ để cập nhật nhãn "dữ liệu cũ" — chỉ thẻ này render lại
  return { saved, loading, err, retry: () => { fails.current = 0; load(true); } };
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

function RetryBtn({ onClick, label, r }: { onClick: () => void; label: string; r: number }) {
  return <button type="button" onClick={onClick} className="t-focus flex shrink-0 items-center gap-1 border border-white/20 bg-white/5 px-2 py-1 text-[11px] font-semibold" style={{ borderRadius: r }}><RefreshCw size={12} />{label}</button>;
}

function WeatherInner({ rad }: { rad: number }) {
  const { saved, loading, err, retry } = useWeather();
  const r = rad === 4 ? 4 : 10;
  const shell = "flex items-center gap-4";

  if (!saved) {   // chưa có dữ liệu nào
    return (
      <section aria-label={`Thời tiết ${CITY}`} className={shell}>
        <span className="grid h-11 w-11 shrink-0 place-items-center accent-soft" style={{ borderRadius: rad }}>{err ? <CloudOff size={24} className="text-[var(--muted)]" /> : <Cloud size={24} className="accent-text opacity-60" />}</span>
        <div className="min-w-[8.5rem] leading-tight">
          <p className="text-[11px] font-semibold text-[var(--muted)]">{CITY}</p>
          <p className="mt-0.5 text-[13px] font-semibold">{err ? MSG[err] : "Đang tải thời tiết…"}</p>
        </div>
        {err && !loading && <RetryBtn onClick={retry} label="Thử lại" r={r} />}
      </section>
    );
  }

  const { wx, at } = saved;
  const stale = Date.now() - at > STALE_MS;
  const note = loading ? "Đang cập nhật…" : err ? `${MSG[err]} · dữ liệu lúc ${hhmm(at)}` : stale ? `Dữ liệu lúc ${hhmm(at)}` : "";
  return (
    <section aria-label={`Thời tiết ${CITY}`} className={shell}>
      <span className="grid h-12 w-12 shrink-0 place-items-center accent-soft accent-text" style={{ borderRadius: rad }}><WxIcon code={wx.code} day={wx.day} size={30} /></span>
      <div className="min-w-0 leading-none">
        <p className="text-[11px] font-semibold text-[var(--muted)]">{CITY}</p>
        <p key={wx.temp} className="wx-fade mt-1 flex items-baseline gap-2 whitespace-nowrap"><span className="text-[28px] font-extrabold tabular-nums leading-none">{wx.temp}°</span><span className="text-[13px] font-semibold text-[var(--muted-2)]">{wx_desc(wx.code)}</span></p>
        {note && <p className={`mt-1 text-[10px] ${err || stale ? "text-amber-300" : "text-[var(--muted)]"}`}>{note}</p>}
      </div>
      <div className="hidden shrink-0 items-center gap-5 border-l border-white/15 pl-5 min-[900px]:flex">
        <Stat label="Cảm giác" value={`${wx.feels}°`} />
        <Stat label="Cao / Thấp" value={`${wx.hi}° / ${wx.lo}°`} />
        <Stat label="Mưa" value={`${wx.rain}%`} />
      </div>
      {err && !loading && <RetryBtn onClick={retry} label="Thử lại" r={r} />}
    </section>
  );
}
const wx_desc = wmo;
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="leading-none"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{label}</p><p className="mt-1 text-[15px] font-bold tabular-nums">{value}</p></div>;
}

/** Thẻ thời tiết độc lập: tự tải, tự render; lỗi (API, render) không ảnh hưởng phần còn lại của launcher. */
export const WeatherCard = React.memo(function WeatherCard({ rad }: { rad: number }) {
  return <Boundary name="weather" silent><WeatherInner rad={rad} /></Boundary>;
});
