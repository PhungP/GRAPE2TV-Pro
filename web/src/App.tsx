import React, { useCallback, useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon, Play, Pause, SkipForward, SkipBack, Clock3, Sparkles, ChevronRight, X, Grape, Cloud, Droplets, Wind, Download, RefreshCw, CheckCircle2, Info, ShieldCheck, Loader2, Library } from "lucide-react";
import { WeatherCard } from "./Weather";
import { bridge, safeJson, nativeFetch, activeNow, activeSubs, useActiveTick, useNativeEvent, type AndroidBridge } from "./native";

import "./index.css";

type Album = { title: string; detail: string; minutes: string; hue: string; mark: string };
type Theme = "liquid" | "xperia";
type IconSize = "sm" | "md" | "lg";
type LibSize = "sm" | "md" | "lg";
type WallKind = "default" | "picsum" | "bing";
type SaverStyle = "clock" | "wall";
type SettingsValue = { theme: Theme; clock24: boolean; softMotion: boolean; iconSize: IconSize; libSize: LibSize; npSize: LibSize; wall: WallKind; wallSeed: number; saverMin: number; saverStyle: SaverStyle };
// Ô Thư viện: Nhỏ = nhiều bìa nhỏ, Lớn = ít bìa nhưng to
const LIB_SIZES: Record<LibSize, { label: string; n: number; cols: number }> = { sm: { label: "Nhỏ", n: 9, cols: 3 }, md: { label: "Vừa", n: 4, cols: 2 }, lg: { label: "Lớn", n: 1, cols: 1 } };
// Hộp "Đang phát": rộng (vw) / ảnh bìa (px) / cỡ chữ tên bài
const NP_SIZES: Record<LibSize, { label: string; w: number; art: number; title: number }> = { sm: { label: "Nhỏ", w: 42, art: 60, title: 16 }, md: { label: "Vừa", w: 50, art: 72, title: 18 }, lg: { label: "Lớn", w: 60, art: 96, title: 22 } };
const ORDER_KEY = "grape-app-order";
const COVERS_KEY = "grape-covers";
const readJson = <T,>(k: string, fb: T): T => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? fb; } catch { return fb; } };
const writeJson = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* đầy bộ nhớ: bỏ qua */ } };
const verParts = (v: string) => v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
const isNewer = (a: string, b: string) => { const x = verParts(a), y = verParts(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
type Net = { type: string; level: number };
type Cover = { src?: string; hue?: string; mark?: string; id?: string; title?: string };
type LibAlbum = { cover: string; id?: string; title?: string };
function Seg({ label, value, options, onChange, r }: { label: string; value: string; options: Array<{ v: string; t: string }>; onChange: (v: string) => void; r: number }) {
  return (
    <div role="radiogroup" aria-label={label} className="mt-2.5">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{label}</p>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
            className={`t-focus min-w-0 flex-1 border px-1 py-1.5 text-[11px] font-semibold leading-tight ${value === o.v ? "border-[var(--accent-line)] accent-soft accent-text" : "border-white/10 bg-white/[.04]"}`} style={{ borderRadius: r }}>{o.t}</button>
        ))}
      </div>
    </div>
  );
}
function Toggle({ label, on, onChange, r }: { label: string; on: boolean; onChange: (v: boolean) => void; r: number }) {
  return (
    <button type="button" onClick={() => onChange(!on)} aria-pressed={on} className="t-focus mt-1.5 flex w-full items-center justify-between gap-2 border border-white/10 bg-white/[.04] px-2.5 py-1.5 text-left" style={{ borderRadius: r }}>
      <span className="text-[11px] font-semibold">{label}</span>
      <span className={`relative h-4 w-8 shrink-0 rounded-full ${on ? "accent-bg" : "bg-white/15"}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} /></span>
    </button>
  );
}
function SBtn({ children, onClick, r, primary, disabled, className = "" }: { children: React.ReactNode; onClick?: () => void; r: number; primary?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`t-focus flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold ${primary ? "accent-bg" : "border border-white/20 bg-white/5"} ${disabled ? "opacity-70" : ""} ${className}`} style={{ borderRadius: r }}>{children}</button>
  );
}
function WifiIcon({ net }: { net: Net }) {
  const on = net.type !== "none";
  const c = (n: number) => (on && net.level >= n ? "var(--accent)" : "rgba(255,255,255,.28)");
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 8.8a15 15 0 0 1 20 0" stroke={c(3)} />
      <path d="M5 12.5a10 10 0 0 1 14 0" stroke={c(2)} />
      <path d="M8.5 16a5 5 0 0 1 7 0" stroke={c(1)} />
      <circle cx="12" cy="19.6" r="1.3" fill={on ? "var(--accent)" : "rgba(255,255,255,.28)"} stroke="none" />
      {!on && <path d="M4 4l16 16" stroke="#ff6b6b" />}
    </svg>
  );
}
const ICON_SIZES: Record<IconSize, { label: string; cols: number; icon: number; font: number }> = {
  sm: { label: "Nhỏ", cols: 8, icon: 56, font: 12 },
  md: { label: "Vừa", cols: 6, icon: 72, font: 14 },
  lg: { label: "Lớn", cols: 5, icon: 84, font: 15 },
};
type UpdateState = "idle" | "checking" | "available" | "downloading" | "ready" | "latest" | "error";
type AppItem = { name: string; short: string; bg: string; note: string; pkg?: string; icon?: string };
type QItem = { title: string; artist: string };
type Session = { title?: string; artist?: string; album?: string; queue?: QItem[]; playing?: boolean; duration?: number; pkg?: string; needAccess?: boolean } | null;
type Progress = { position: number; duration: number; playing: boolean };

// Đồng hồ: chỉ component dùng nó render lại (mỗi phút đổi chữ), không kéo cả App render theo
const DAYS = ["Chủ Nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const clockText = (d: Date, c24: boolean) => { const h = d.getHours(); const hh = c24 ? h : h % 12 || 12; return `${String(hh).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}${c24 ? "" : h >= 12 ? " CH" : " SA"}`; };
const dateText = (d: Date) => `${DAYS[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}`;
function useClock(clock24: boolean) {
  const [v, setV] = useState(() => { const d = new Date(); return { clock: clockText(d, clock24), date: dateText(d) }; });
  useActiveTick(() => { const d = new Date(); const clock = clockText(d, clock24), date = dateText(d); setV((o) => (o.clock === clock && o.date === date ? o : { clock, date })); }, 1000);
  useEffect(() => { const d = new Date(); setV({ clock: clockText(d, clock24), date: dateText(d) }); }, [clock24]);
  return v;
}
const ClockBlock = React.memo(function ClockBlock({ clock24, rad }: { clock24: boolean; rad: number }) {
  const { clock, date } = useClock(clock24);
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-12 w-12 shrink-0 place-items-center accent-bg" style={{ borderRadius: rad }}><Grape size={24} /></span>
      <div className="leading-none">
        <p className="text-[clamp(1.65rem,5vw,2.4rem)] font-extrabold leading-none tabular-nums tracking-tight">{clock}</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted)]"><Clock3 size={13} className="accent-text shrink-0" /><span>{date}</span></p>
      </div>
    </div>
  );
});
const SaverClock = React.memo(function SaverClock({ clock24, nowPlaying }: { clock24: boolean; nowPlaying: string }) {
  const { clock, date } = useClock(clock24);
  return (<>
    <p className="text-[clamp(3rem,14vw,7rem)] font-extrabold leading-none tabular-nums tracking-tight">{clock}</p>
    <p className="mt-2 text-lg text-white/70">{date}</p>
    {nowPlaying && <p className="mt-3 text-sm accent-text">♪ {nowPlaying}</p>}
  </>);
});
// Thanh tiến độ bài hát: tự đọc vị trí từ bản đệm Android mỗi giây (chỉ khi đang phát và launcher hiển thị) — không render lại App
const ProgressBar = React.memo(function ProgressBar({ hasBridge, playing, title, simElapsed, simTotal }: { hasBridge: boolean; playing: boolean; title: string; simElapsed: number; simTotal: number }) {
  const [p, setP] = useState<Progress>({ position: 0, duration: 0, playing: false });
  const read = useCallback(() => {
    const b = bridge(); if (!b) return;
    const n = safeJson<Progress>(b.getProgress(), { position: 0, duration: 0, playing: false });
    const q = { position: Math.floor(n.position / 1000) * 1000, duration: n.duration, playing: n.playing };
    setP((o) => (o.position === q.position && o.duration === q.duration && o.playing === q.playing ? o : q));
  }, []);
  useActiveTick(read, 1000, hasBridge && playing);              // đang phát: mỗi giây
  useEffect(() => { if (hasBridge && !playing) read(); }, [hasBridge, playing, title, read]); // tạm dừng/đổi bài: đọc một lần
  const elapsed = hasBridge ? Math.floor(p.position / 1000) : simElapsed;
  const total = hasBridge ? Math.floor(p.duration / 1000) : simTotal;
  const progress = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="w-10 text-[11px] tabular-nums text-[var(--muted-2)]">{fmt(elapsed)}</span>
      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-black/30" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến độ bài hát">
        <div className="progress-fill h-full rounded-full accent-bg" style={{ width: `${progress}%` }} />
      </div>
      <span className="w-10 text-right text-[11px] tabular-nums text-[var(--muted-2)]">{total > 0 ? fmt(total) : "--:--"}</span>
    </div>
  );
});
const PALETTE = ["#c01a22", "#d92b20", "#f26b16", "#e83e8c", "#18a84f", "#3e6be0", "#7a4bd6", "#0f9aa8", "#b7744a", "#8c8f94"];
// Thiết bị yếu (RAM ≤ 2 GB hoặc ≤ 4 lõi): mặc định bật "Chuyển động nhẹ" — người dùng vẫn đổi được trong Cài đặt
const lowEnd = (() => { const n = navigator as Navigator & { deviceMemory?: number }; return (n.deviceMemory !== undefined && n.deviceMemory <= 2) || (n.hardwareConcurrency !== undefined && n.hardwareConcurrency <= 4); })();
const GRAPE_PKG = "com.grape.play"; // gói của ứng dụng GRAPE2Play đầy đủ — sửa nếu khác
const SETTINGS_KEY = "grape-launcher-settings";

const DEFAULT_VERSION = "v1.2.1";
const REPO = "PhungP/GRAPE2TV-Pro"; // https://github.com/PhungP/GRAPE2TV-Pro — kho GitHub Releases dùng để kiểm tra cập nhật (URL cũ grape2launcher vẫn được GitHub chuyển hướng)

const albums: Album[] = [
  { title: "Đêm Hổ Phách", detail: "Tuyển tập đêm • GRAPE2Play", minutes: "42 phút", hue: "linear-gradient(135deg,#ff9d1e,#7a2b08)", mark: "ĐH" },
  { title: "Sài Gòn Mưa", detail: "Acoustic • Buổi chiều", minutes: "38 phút", hue: "linear-gradient(135deg,#3f7d82,#122a2d)", mark: "SG" },
  { title: "Vàng Son", detail: "Nhạc xưa • Bản thu ấm", minutes: "51 phút", hue: "linear-gradient(135deg,#e8b64c,#5a3007)", mark: "VS" },
  { title: "Nhôm & Lụa", detail: "Jazz • Không lời", minutes: "47 phút", hue: "linear-gradient(135deg,#8c8f94,#232326)", mark: "NL" },
  { title: "Trà Chiều", detail: "Chill • Cuối tuần", minutes: "35 phút", hue: "linear-gradient(135deg,#b7744a,#442313)", mark: "TC" },
];

const demoApps: AppItem[] = [
  { name: "Netflix", short: "N", bg: "#c01a22", note: "Phim & series" },
  { name: "YouTube", short: "▶", bg: "#d92b20", note: "Video" },
  { name: "FPT Play", short: "F", bg: "#f26b16", note: "Truyền hình" },
  { name: "VieON", short: "V", bg: "#e83e8c", note: "Giải trí" },
  { name: "Spotify", short: "S", bg: "#18a84f", note: "Nhạc" },
  { name: "TIDAL", short: "T", bg: "#d9d3ca", note: "Hi-Fi" },
  { name: "Qobuz", short: "Q", bg: "#3e6be0", note: "Hi-Res" },
  { name: "GRAPE2Play", short: "G", bg: "#ffab2e", note: "Đang chọn" },
];

function fmt(total: number) {
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Ô ứng dụng: React.memo để đổi focus chỉ render lại 2 ô (ô cũ/ô mới) thay vì cả lưới
type TileProps = { app: AppItem; i: number; sz: { icon: number; font: number }; active: boolean; focused: boolean; lifted: boolean; xperia: boolean; onOpen: (i: number) => void; onFocusTile: (i: number) => void; setRef: (i: number, el: HTMLButtonElement | null) => void };
const AppTile = React.memo(function AppTile({ app, i, sz, active, focused, lifted, xperia, onOpen, onFocusTile, setRef }: TileProps) {
  const r = xperia ? 4 : sz.icon / 4.5;
  return (
    <button ref={(el) => setRef(i, el)} onClick={() => onOpen(i)} onFocus={() => onFocusTile(i)}
      className={`t-card t-focus group flex flex-col items-center justify-center px-2 py-3 text-center ${active ? "border-[var(--accent-line)] accent-soft" : ""} ${focused ? "t-focused" : ""}`}
      style={lifted ? { transform: "scale(1.06)", borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent), 0 18px 40px rgba(0,0,0,.5)" } : undefined}>
      <span className="grid place-items-center overflow-hidden font-black" style={{ width: sz.icon, height: sz.icon, fontSize: sz.icon / 3, background: app.icon ? "transparent" : app.bg, color: app.name === "TIDAL" || app.name === "GRAPE2Play" ? "#211505" : "#fff", borderRadius: r }}>
        {app.icon ? <img src={`data:image/png;base64,${app.icon}`} alt="" decoding="async" className="h-full w-full object-contain" /> : app.short}
      </span>
      <span className="mt-2.5 block w-full truncate font-semibold" style={{ fontSize: sz.font }}>{app.name}</span>
      {app.note && <span className="block w-full truncate text-[11px] text-[var(--muted)]">{app.note}</span>}
      {active && <span className="mt-1.5 block h-1 w-6 rounded-full accent-bg" />}
    </button>
  );
});

export default function App() {
  const hasBridge = !!bridge();
  const [current, setCurrent] = useState(0);
  const [simPlaying, setSimPlaying] = useState(true);
  const [simElapsed, setSimElapsed] = useState(38);
  const [apps, setApps] = useState<AppItem[]>(hasBridge ? [] : demoApps);
  const [selectedApp, setSelectedApp] = useState(0);
  const [focusedApp, setFocusedApp] = useState(0);
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("liquid");
  const [iconSize, setIconSize] = useState<IconSize>("lg");
  const [art, setArt] = useState("");
  const [libSize, setLibSize] = useState<LibSize>("md");
  const [npSize, setNpSize] = useState<LibSize>("md");
  const [wall, setWall] = useState<WallKind>("default");
  const [wallSeed, setWallSeed] = useState(1);
  const [saverMin, setSaverMin] = useState(0);
  const [saverStyle, setSaverStyle] = useState<SaverStyle>("clock");
  const [wallUrl, setWallUrl] = useState("");
  const [tab, setTab] = useState<"ui" | "wall" | "update" | "system">("ui");
  const [diag, setDiag] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [saverOn, setSaverOn] = useState(false);
  const [saverPos, setSaverPos] = useState({ x: 50, y: 50 });
  const saverRef = useRef(false);
  const saverShownAt = useRef(0);
  const lastAct = useRef(Date.now());
  const [net, setNet] = useState<Net>({ type: "wifi", level: 4 });
  const [providerCovers, setProviderCovers] = useState<Cover[]>([]);
  const [history, setHistory] = useState<Array<{ k: string; d: string }>>(() => readJson(COVERS_KEY, []));
  const [arrange, setArrange] = useState(false);
  const [picked, setPicked] = useState(false);
  const orderRef = useRef<string[]>(readJson(ORDER_KEY, []));
  const arrangeRef = useRef(false);
  const [clock24, setClock24] = useState(true);
  const [softMotion, setSoftMotion] = useState(lowEnd);
  const [saveState, setSaveState] = useState("");
  const [session, setSession] = useState<Session>(null);
  const [info, setInfo] = useState<{ versionName: string; packageName: string }>({ versionName: DEFAULT_VERSION, packageName: "com.grape.launcher" });
  const toastTimer = useRef<number | null>(null);
  const appRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const albumRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const playRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const settingsOpenRef = useRef(false);
  // React đã mount xong → báo Android (nếu không báo trong 15 giây Android coi là treo và phục hồi)
  useEffect(() => { bridge()?.ready(); }, []);
  const simTotal = 214;
  const CURRENT_VERSION = info.versionName.startsWith("v") ? info.versionName : `v${info.versionName}`;
  const PACKAGE_NAME = info.packageName;

  // Cập nhật từ GitHub Releases
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [checkedAt, setCheckedAt] = useState("");
  const [latestVersion, setLatestVersion] = useState("");
  const [changelog, setChangelog] = useState<string[]>([]);
  const [apkUrl, setApkUrl] = useState("");
  const updateTimer = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3600);
  };

  useEffect(() => { settingsOpenRef.current = settingsOpen; }, [settingsOpen]);
  useEffect(() => { arrangeRef.current = arrange; }, [arrange]);

  // Cài đặt lưu cục bộ (localStorage) — không cần mạng
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") as Partial<SettingsValue> | null;
      if (v) {
        if (v.theme === "liquid" || v.theme === "xperia") setTheme(v.theme);
        if (typeof v.clock24 === "boolean") setClock24(v.clock24);
        if (typeof v.softMotion === "boolean") setSoftMotion(v.softMotion);
        if (v.iconSize === "sm" || v.iconSize === "md" || v.iconSize === "lg") setIconSize(v.iconSize);
        if (v.libSize === "sm" || v.libSize === "md" || v.libSize === "lg") setLibSize(v.libSize);
        if (v.npSize === "sm" || v.npSize === "md" || v.npSize === "lg") setNpSize(v.npSize);
        if (v.wall === "default" || v.wall === "picsum" || v.wall === "bing") setWall(v.wall);
        if (typeof v.wallSeed === "number") setWallSeed(v.wallSeed);
        if (typeof v.saverMin === "number") setSaverMin(v.saverMin);
        if (v.saverStyle === "clock" || v.saverStyle === "wall") setSaverStyle(v.saverStyle);
      }
    } catch { /* bỏ qua */ }
  }, []);
  const persist = (next: SettingsValue) => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); setSaveState("Đã lưu lựa chọn"); }
    catch { setSaveState("Chưa lưu được — vẫn dùng tạm"); }
  };

  // Thông tin phiên bản của launcher
  useEffect(() => {
    const b = bridge();
    if (b) setInfo((o) => ({ ...o, ...safeJson<Partial<typeof o>>(b.getInfo(), {}) }));
  }, []);

  // Danh sách ứng dụng thật trên TV (cập nhật khi quay lại launcher)
  const lastAppsRaw = useRef("");
  const loadApps = useCallback(() => {
    const b = bridge();
    if (!b) return;
    const raw = b.getApps();
    if (raw === lastAppsRaw.current) return;   // danh sách không đổi: không dựng lại giao diện
    lastAppsRaw.current = raw;
    const list = safeJson<Array<{ name: string; pkg: string; icon?: string }>>(raw, []);
    const mapped: AppItem[] = list.map((a, i) => ({
      name: a.name, pkg: a.pkg, icon: a.icon, short: (a.name[0] || "?").toUpperCase(), bg: PALETTE[i % PALETTE.length],
      note: "",
    }));
    const ord = orderRef.current;
    if (ord.length) {
      // thứ tự do người dùng sắp xếp; app mới cài xếp cuối
      const idx = (a: AppItem) => { const k = ord.indexOf(a.pkg || a.name); return k < 0 ? 1e6 : k; };
      mapped.sort((x, y) => idx(x) - idx(y));
    } else {
      mapped.sort((x, y) => (x.pkg === GRAPE_PKG ? -1 : 0) - (y.pkg === GRAPE_PKG ? -1 : 0)); // GRAPE2Play lên đầu
    }
    setApps(mapped);
  }, []);
  useActiveTick(loadApps, apps.length === 0 && hasBridge ? 3000 : 0);              // lần đầu + mỗi lần launcher hiện lại (bản đệm Android nên rất rẻ)
  useNativeEvent("__appsChanged", loadApps); // cài/gỡ/cập nhật app → Android báo lên
  const firstFocus = useRef(true);
  useEffect(() => {
    if (apps.length && firstFocus.current) { firstFocus.current = false; window.setTimeout(() => appRefs.current[0]?.focus({ preventScroll: true }), 150); }
  }, [apps]);

  // Nhạc đang phát thật (MediaSession) — cần cấp "Quyền truy cập thông báo" cho launcher
  // Android đẩy sự kiện (__mediaChanged) mỗi khi bài/trạng thái đổi; vòng hỏi 10 giây chỉ là dự phòng. Chỉ cập nhật khi nội dung thật sự đổi.
  const lastSession = useRef("");
  const pollSession = useCallback(() => {
    const b = bridge(); if (!b) return;
    const raw = b.getNowPlaying();
    if (raw === lastSession.current) return;
    lastSession.current = raw;
    setSession(safeJson<Session>(raw, null));
  }, []);
  useActiveTick(pollSession, 10000, hasBridge);
  useNativeEvent("__mediaChanged", pollSession);

  // Trạng thái mạng (biểu tượng Wi-Fi)
  // Android báo __netChanged khi mạng đổi; vòng hỏi 30 giây chỉ là dự phòng (Android 5–6 không có callback)
  const pollNet = useCallback(() => {
    const b = bridge(); if (!b) return;
    const n = safeJson<Net>(b.getNetwork(), { type: "none", level: 0 });
    setNet((o) => (o.type === n.type && o.level === n.level ? o : n));
  }, []);
  useActiveTick(pollNet, 30000, hasBridge);
  useActiveTick(() => { const b = bridge(); if (b) setIsDefault(b.isDefaultLauncher()); }, 0, hasBridge); // kiểm tra lại mỗi khi quay về launcher (sau khi người dùng chọn trong hệ thống)
  useNativeEvent("__netChanged", pollNet);

  // Bìa album trong thư viện GRAPE2Play (nếu app cung cấp ContentProvider), tải lại khi quay về launcher
  const loadCovers = useCallback(() => {
    const b = bridge();
    if (!b) return;
    const list = safeJson<LibAlbum[]>(b.getLibraryAlbums(), []);
    setProviderCovers(list.filter((x) => x && x.cover).map((x) => ({ src: `data:image/jpeg;base64,${x.cover}`, id: x.id, title: x.title })));
  }, []);
  useActiveTick(loadCovers, 0, hasBridge);

  // Ảnh bìa của bài đang phát (chỉ tải lại khi đổi bài)
  const artKey = `${session?.pkg || ""}|${session?.title || ""}`;
  useEffect(() => {
    const b = bridge();
    if (!b || !session?.title) { setArt(""); return; }
    const raw = b.getArt();
    setArt(raw ? `data:image/jpeg;base64,${raw}` : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artKey]);

  // Lưu bìa album đã từng phát qua GRAPE2Play để dựng thư viện khi app chưa cung cấp danh sách
  useEffect(() => {
    if (!art) return;
    const k = `${art.length}:${art.slice(art.length >> 1, (art.length >> 1) + 40)}`;
    setHistory((h) => {
      if (h.some((x) => x.k === k)) return h;
      const next = [{ k, d: art }, ...h].slice(0, 12);
      writeJson(COVERS_KEY, next);
      return next;
    });
  }, [art]);

  // Hình nền từ nguồn miễn phí: Picsum (ảnh Unsplash) hoặc ảnh trang chủ Bing mỗi ngày
  useEffect(() => {
    let off = false;
    const apply = (u: string) => { const im = new Image(); im.onload = () => { if (!off) setWallUrl(u); }; im.onerror = () => { if (!off) setWallUrl(""); }; im.src = u; };
    if (wall === "default") { setWallUrl(""); return; }
    if (wall === "picsum" || !hasBridge) { apply(`https://picsum.photos/seed/${wallSeed}/1920/1080`); return () => { off = true; }; }
    const today = new Date().toISOString().slice(0, 10);
    const cache = readJson<{ d: string; u: string } | null>("grape-bing", null);
    if (cache && cache.d === today) { apply(cache.u); return () => { off = true; }; }
    nativeFetch("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=vi-VN").then((txt) => {
      try {
        const u = "https://www.bing.com" + JSON.parse(txt).images[0].url;
        writeJson("grape-bing", { d: today, u });
        if (!off) apply(u);
      } catch { if (!off) setWallUrl(cache?.u || ""); if (cache?.u) apply(cache.u); }
    });
    return () => { off = true; };
  }, [wall, wallSeed, hasBridge]);

  // Bảo vệ màn hình: sau N phút không bấm phím sẽ hiện đồng hồ di chuyển chậm (chống burn-in)
  useEffect(() => { saverRef.current = saverOn; if (saverOn) saverShownAt.current = Date.now(); }, [saverOn]);
  useEffect(() => {
    const act = (e: Event) => {
      lastAct.current = Date.now();
      if (saverRef.current && Date.now() - saverShownAt.current > 700) { e.preventDefault(); e.stopPropagation(); setSaverOn(false); }
    };
    const evs = ["keydown", "mousedown", "touchstart", "mousemove"];
    evs.forEach((n) => window.addEventListener(n, act, true));
    const t = window.setInterval(() => {
      if (activeNow && saverMin > 0 && !saverRef.current && Date.now() - lastAct.current > saverMin * 60000) setSaverOn(true);
    }, 5000);
    const mv = window.setInterval(() => { if (activeNow && saverRef.current) setSaverPos({ x: 30 + Math.random() * 40, y: 35 + Math.random() * 30 }); }, 20000);
    return () => { evs.forEach((n) => window.removeEventListener(n, act, true)); window.clearInterval(t); window.clearInterval(mv); };
  }, [saverMin]);

  // Cửa sổ Cài đặt: giữ con trỏ (focus) bên trong cửa sổ, không chạy ra ngoài
  useEffect(() => {
    if (!settingsOpen) return;
    const h = (e: FocusEvent) => {
      const root = dialogRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) root.querySelector<HTMLElement>("button")?.focus();
    };
    document.addEventListener("focusin", h);
    return () => document.removeEventListener("focusin", h);
  }, [settingsOpen]);
  const onDialogKeys = (e: React.KeyboardEvent) => {
    const dirs: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const root = dialogRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled])"));
    const cur = document.activeElement as HTMLElement | null;
    if (e.key === "Escape" || e.key === "BrowserBack") { e.preventDefault(); setSettingsOpen(false); return; }
    if (e.key === "Tab") { e.preventDefault(); const i = cur ? els.indexOf(cur) : -1; els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length]?.focus(); return; }
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    if (!cur || !els.includes(cur)) { els[0]?.focus(); return; }
    const cr = cur.getBoundingClientRect(); const cx = cr.left + cr.width / 2; const cy = cr.top + cr.height / 2;
    let best: HTMLElement | null = null; let bs = Infinity;
    for (const el of els) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx; const dy = r.top + r.height / 2 - cy;
      const along = d[0] ? dx * d[0] : dy * d[1];
      if (along <= 4) continue;
      const across = d[0] ? Math.abs(dy) : Math.abs(dx);
      const sc = along + across * 2.5;
      if (sc < bs) { bs = sc; best = el; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: "nearest" }); }
  };

  // Mô phỏng khi chạy trên trình duyệt
  useEffect(() => {
    if (hasBridge || !simPlaying) return;
    const t = window.setInterval(() => {
      setSimElapsed((v) => {
        if (v + 1 >= simTotal) { setCurrent((c) => (c + 1) % albums.length); return 0; }
        return v + 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [simPlaying, hasBridge]);

  // Nút Back trên remote
  useEffect(() => {
    window.__onBack = () => {
      if (saverRef.current) { setSaverOn(false); return true; }
      if (settingsOpenRef.current) { setSettingsOpen(false); return true; }
      if (arrangeRef.current) { setArrange(false); setPicked(false); return true; }
      return false;
    };
    return () => { window.__onBack = undefined; };
  }, []);
  // Khi mở Cài đặt: đưa focus vào hộp thoại
  useEffect(() => {
    if (settingsOpen) window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("button[role=radio]")?.focus(), 80);
    else if (!settingsOpen && apps.length) window.setTimeout(() => appRefs.current[focusedApp]?.focus(), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);

  useEffect(() => () => { if (updateTimer.current) window.clearTimeout(updateTimer.current); }, []);

  const changeSetting = (patch: Partial<SettingsValue>) => {
    const next: SettingsValue = { theme, clock24, softMotion, iconSize, libSize, npSize, wall, wallSeed, saverMin, saverStyle, ...patch };
    setTheme(next.theme); setClock24(next.clock24); setSoftMotion(next.softMotion); setIconSize(next.iconSize); setLibSize(next.libSize); setNpSize(next.npSize);
    setWall(next.wall); setWallSeed(next.wallSeed); setSaverMin(next.saverMin); setSaverStyle(next.saverStyle);
    persist(next);
  };
  const changeTheme = (t: Theme) => { changeSetting({ theme: t }); showToast(t === "liquid" ? "Đã chuyển sang Liquid Glass." : "Đã chuyển sang Xperia."); };

  const openGrape = () => {
    const b = bridge();
    if (!b) { showToast("Đang mở GRAPE2Play — trình phát đầy đủ…"); return; }
    if (!b.launch(GRAPE_PKG)) showToast("Chưa cài GRAPE2Play trên TV này.");
  };
  // Chọn một album trong ô Thư viện: mở GRAPE2Play ở đúng album nếu có mã (nếu không thì mở thư viện)
  const openAlbum = (c: Cover) => {
    const b = bridge();
    if (!b) { showToast(c.title ? `Đang mở album “${c.title}”…` : "Đang mở Thư viện âm nhạc…"); return; }
    const ok = c.id || c.title ? b.openAlbum(c.id || "", c.title || "") : b.launchWith(GRAPE_PKG, "library");
    if (!ok) showToast("Chưa cài GRAPE2Play trên TV này.");
  };
  const openLibrary = () => {
    const b = bridge();
    if (!b) { showToast("Đang mở Thư viện âm nhạc…"); return; }
    if (!b.launchWith(GRAPE_PKG, "library")) showToast("Chưa cài GRAPE2Play trên TV này.");
  };
  const moveApp = (from: number, to: number) => {
    if (to < 0 || to >= apps.length || from === to) return;
    const arr = [...apps];
    const [it] = arr.splice(from, 1);
    arr.splice(to, 0, it);
    setApps(arr);
    orderRef.current = arr.map((a) => a.pkg || a.name);
    writeJson(ORDER_KEY, orderRef.current);
    setFocusedApp(to);
    window.setTimeout(() => appRefs.current[to]?.focus(), 0);
  };
  const startArrange = () => {
    setSettingsOpen(false); setArrange(true); setPicked(false);
    showToast("Sắp xếp: chọn ứng dụng, bấm OK để nhấc rồi dùng phím mũi tên. Bấm Back để xong.");
  };
  const resetOrder = () => {
    orderRef.current = [];
    try { localStorage.removeItem(ORDER_KEY); } catch { /* bỏ qua */ }
    loadApps(); showToast("Đã đặt lại thứ tự ứng dụng.");
  };
  const openApp = (i: number) => {
    if (arrange) { setFocusedApp(i); setPicked((p) => (focusedApp === i ? !p : true)); return; }
    setSelectedApp(i); setFocusedApp(i);
    const a = apps[i]; if (!a) return;
    const b = bridge();
    if (!b) { showToast(`Đang mở ${a.name}…`); return; }
    if (a.pkg && !b.launch(a.pkg)) showToast(`Không mở được ${a.name}.`);
  };
  const openRef = useRef(openApp); openRef.current = openApp;
  const stableOpen = useCallback((i: number) => openRef.current(i), []);
  const stableFocus = useCallback((i: number) => setFocusedApp(i), []);
  const setAppRef = useCallback((i: number, el: HTMLButtonElement | null) => { appRefs.current[i] = el; }, []);
  const playAlbum = (i: number) => { setCurrent(i); setSimElapsed(4); setSimPlaying(true); showToast(`Đang phát “${albums[i].title}”`); };
  const next = () => {
    const b = bridge();
    if (b) { b.media("next"); return; }
    const n = (current + 1) % albums.length; setCurrent(n); setSimElapsed(0); setSimPlaying(true);
  };
  const prev = () => {
    const b = bridge();
    if (b) { b.media("prev"); return; }
    const n = (current - 1 + albums.length) % albums.length; setCurrent(n); setSimElapsed(0); setSimPlaying(true);
  };
  const checkMusic = () => {
    const b = bridge();
    setDiag(b ? b.debugSessions() : "Chỉ kiểm tra được khi chạy trên TV.");
  };
  const togglePlay = () => {
    const b = bridge();
    if (b) {
      if (session?.needAccess) { b.openNotificationAccess(); showToast("Bật “Quyền truy cập thông báo” cho GRAPE2TV Pro để điều khiển nhạc."); return; }
      if (!session?.title) { openGrape(); return; }
      b.media("playpause"); return;
    }
    setSimPlaying(!simPlaying);
  };

  // Điều hướng bằng D-pad: ← → ↑ ↓ trong lưới ứng dụng
  const onKeys = (e: React.KeyboardEvent) => {
    if (settingsOpen) { if (e.key === "Escape" || e.key === "BrowserBack") setSettingsOpen(false); return; }
    if (arrange && (e.key === "Escape" || e.key === "BrowserBack")) { e.preventDefault(); setArrange(false); setPicked(false); return; }
    const inGrid = (e.target as HTMLElement).closest("[data-grid=apps]");
    if (!inGrid || !apps.length) return;
    const cols = Math.max(1, getComputedStyle(gridRef.current!).gridTemplateColumns.split(" ").length);
    const go = (n: number) => { e.preventDefault(); setFocusedApp(n); appRefs.current[n]?.focus(); };
    if (arrange && picked) {
      // đang cầm một ứng dụng: mũi tên = di chuyển nó
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? cols : e.key === "ArrowUp" ? -cols : 0;
      if (d) { e.preventDefault(); moveApp(focusedApp, Math.max(0, Math.min(apps.length - 1, focusedApp + d))); }
      return;
    }
    if (e.key === "ArrowRight") go((focusedApp + 1) % apps.length);
    else if (e.key === "ArrowLeft") go((focusedApp - 1 + apps.length) % apps.length);
    else if (e.key === "ArrowDown") { if (focusedApp + cols < apps.length) go(focusedApp + cols); else if (!hasBridge) { e.preventDefault(); albumRefs.current[current]?.focus(); } else e.preventDefault(); }
    else if (e.key === "ArrowUp") { if (focusedApp - cols >= 0) go(focusedApp - cols); else { e.preventDefault(); playRef.current?.focus(); } }
  };

  // Kiểm tra cập nhật thật từ GitHub Releases
  const checkUpdate = async () => {
    if (updateState === "checking" || updateState === "downloading") return;
    setUpdateState("checking");
    setDownloadProgress(0);
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const tag: string = j.tag_name || "";
      const apk = (j.assets || []).find((a: { name: string; browser_download_url: string }) => /\.apk$/i.test(a.name));
      setLatestVersion(tag);
      setApkUrl(apk?.browser_download_url || "");
      setChangelog(String(j.body || "").split(/\r?\n/).map((l: string) => l.replace(/^[-*•\s]+/, "").trim()).filter(Boolean).slice(0, 5));
      setCheckedAt(new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }));
      setUpdateState(tag && isNewer(tag, CURRENT_VERSION) && apk ? "available" : "latest");
    } catch {
      setUpdateState("error");
    }
  };

  const startDownload = () => {
    if (updateState === "downloading" || !apkUrl) return;
    const b = bridge();
    if (!b) { window.open(apkUrl, "_blank"); return; }
    setUpdateState("downloading");
    setDownloadProgress(0);
    b.downloadAndInstall(apkUrl);
    const tick = () => {
      const p = b.getDownloadProgress();
      if (p < 0) { setUpdateState("error"); return; }
      setDownloadProgress(p);
      if (p >= 100) { setUpdateState("ready"); showToast(`Đã tải xong ${latestVersion} — đang mở trình cài đặt…`); return; }
      updateTimer.current = window.setTimeout(tick, 400);
    };
    updateTimer.current = window.setTimeout(tick, 400);
  };

  // Giá trị hiển thị cho dải "Đang phát"
  const demo = albums[current];
  const album = hasBridge
    ? { title: session?.title || "Chưa có nhạc đang phát", detail: session?.title ? ([session.artist, session.album].filter(Boolean).join(" · ") || session.pkg || "") : (session?.needAccess ? "Bấm ▶ để cấp quyền điều khiển nhạc" : "Mở GRAPE2Play để bắt đầu"), hue: "linear-gradient(135deg,#7545c8,#1a1028)", mark: (session?.title?.[0] || "♪").toUpperCase() }
    : demo;
  const playing = hasBridge ? !!session?.playing : simPlaying;
  const isXperia = theme === "xperia";
  const grapeIcon = apps.find((a) => a.pkg === GRAPE_PKG)?.icon;
  const sz = ICON_SIZES[iconSize];
  const nextUp: QItem[] = hasBridge ? (session?.queue || []) : albums.slice(1, 5).map((a) => ({ title: a.title, artist: a.detail }));
  const lib = LIB_SIZES[libSize];
  const realCovers: Cover[] = providerCovers.length ? providerCovers : history.map((h) => ({ src: h.d }));
  const np = NP_SIZES[npSize];
  const covers: Cover[] = hasBridge
    ? Array.from({ length: lib.n }, (_, i) => realCovers[i] || {})
    : albums.slice(0, lib.n).map((a) => ({ hue: a.hue, mark: a.mark }));

  const rad = (n: number) => (isXperia ? 4 : n);

  return (
    <div data-safe-area-inset-root style={{ boxSizing: "border-box", minHeight: "100dvh" }} className={`app-shell overflow-x-clip theme-${theme}${softMotion ? " soft" : ""}`}>
      <div className="app-shell-bg fixed inset-0" aria-hidden="true" />
      {wallUrl && <div className="fixed inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${wallUrl})` }} aria-hidden="true" />}
      {wallUrl && <div className="fixed inset-0 bg-[linear-gradient(180deg,rgba(6,8,20,.55),rgba(6,8,20,.35)_40%,rgba(6,8,20,.65))]" aria-hidden="true" />}
      {!wallUrl && <div className="blobs" aria-hidden="true"><span className="blob blob-a" /><span className="blob blob-b" /><span className="blob blob-c" /></div>}
      <div className="xperia-lines" aria-hidden="true" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col" onKeyDown={onKeys} {...({ inert: settingsOpen ? "" : undefined } as Record<string, unknown>)}>
        <main className="min-w-0 flex-1 px-[5vw] pb-[6vh] pt-[4vh]">
          {/* ĐỒNG HỒ + THỜI TIẾT (trái) — Wi-Fi + CÀI ĐẶT (góc phải) */}
          <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="flex min-w-0 justify-start"><ClockBlock clock24={clock24} rad={rad(999)} /></div>
            <WeatherCard rad={rad(999) === 999 ? 14 : 4} />

            <div className="flex items-center justify-end gap-2 self-start">
              <button type="button" onClick={() => (bridge() ? bridge()!.openWifiSettings() : showToast("Mở cài đặt Wi-Fi"))} aria-label="Wi-Fi" title="Cài đặt Wi-Fi"
                className="t-btn t-focus grid h-8 w-8 shrink-0 place-items-center border border-white/20 bg-white/5 hover:bg-white/10" style={{ borderRadius: rad(999) }}>
                <WifiIcon net={net} />
              </button>
              <button type="button" onClick={() => { setTab("ui"); setSettingsOpen(true); }} aria-label="Mở Cài đặt" title="Cài đặt"
                className="t-btn t-focus grid h-8 w-8 shrink-0 place-items-center border border-white/20 bg-white/5 text-white hover:bg-white/10" style={{ borderRadius: rad(999) }}>
                <SettingsIcon size={15} />
              </button>
            </div>
          </header>

          {/* THƯ VIỆN (vuông, trái) — ĐANG PHÁT (giữa màn hình) — TIẾP THEO (phải) */}
          <section aria-label="Thư viện, đang phát, tiếp theo" className="mt-[3vh] grid items-start gap-3" style={{ gridTemplateColumns: `minmax(0,1fr) ${np.w}vw minmax(0,1fr)` }}>
            <div className="pt-6">
              <div className="t-card relative block aspect-square w-full overflow-hidden">
                <div className="absolute inset-2 bottom-9 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${lib.cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}>
                  {covers.map((c, i) => (
                    <button key={i} type="button" onClick={() => openAlbum(c)} aria-label={c.title ? `Album ${c.title}` : "Album trong thư viện"} className="t-focus relative block min-h-0 overflow-hidden"
                      style={{ borderRadius: rad(10), background: c.src ? "transparent" : c.hue || "rgba(255,255,255,.07)" }}>
                      {c.src ? <img src={c.src} alt="" className="h-full w-full object-cover" />
                        : <span className="absolute inset-0 grid place-items-center text-base font-extrabold text-white/70">{c.mark || <Library size={18} className="opacity-40" />}</span>}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={openLibrary} aria-label="Mở thư viện âm nhạc" className="t-focus absolute inset-x-1.5 bottom-1.5 flex h-7 items-center gap-1.5 bg-black/40 px-2 text-left" style={{ borderRadius: rad(8) }}>
                  <Library size={14} className="shrink-0 accent-text" /><span className="truncate text-[11px] font-bold">Thư viện âm nhạc</span>
                </button>
              </div>
            </div>

            <div className="flex min-w-0 flex-col">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] accent-text">Đang phát</p>
              <div className="t-panel t-panel-hero relative flex-1 overflow-hidden p-3">
                <div className="flex items-center gap-3">
                  <button onClick={openGrape} aria-label={`Mở GRAPE2Play, đang phát ${album.title}`} className="t-focus relative shrink-0 overflow-hidden"
                    style={{ width: np.art, height: np.art, borderRadius: rad(18), background: art || grapeIcon ? "transparent" : album.hue }}>
                    {art ? <img src={art} alt="" className="h-full w-full object-cover" />
                      : grapeIcon ? <img src={`data:image/png;base64,${grapeIcon}`} alt="GRAPE2Play" className="h-full w-full object-contain" />
                      : <span className="absolute inset-0 grid place-items-center text-white/95"><Grape size={34} /></span>}
                  </button>
                  <button onClick={openGrape} className="t-focus min-w-0 flex-1 text-left">
                    <span className="block truncate font-bold leading-tight" style={{ fontSize: np.title }}>{album.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--muted-2)]">{album.detail}</span>
                    <span className="mt-1 block text-[11px] font-semibold accent-text">{hasBridge && !session?.title ? "" : playing ? "● Đang phát" : "❚❚ Tạm dừng"}</span>
                  </button>
                </div>
                <ProgressBar hasBridge={hasBridge} playing={playing} title={session?.title || ""} simElapsed={simElapsed} simTotal={simTotal} />
                <div className="mt-3 flex items-center justify-center gap-3">
                  <button onClick={prev} aria-label="Bài trước" title="Bài trước" className="t-btn t-focus grid h-10 w-10 place-items-center border border-[rgba(255,255,255,.28)] bg-black/20 text-white hover:bg-black/35" style={{ borderRadius: rad(999) }}><SkipBack size={17} /></button>
                  <button ref={playRef} onClick={togglePlay} aria-label={playing ? "Tạm dừng" : "Phát"} className="t-btn t-focus grid h-11 w-11 place-items-center accent-bg shadow-[0_8px_22px_rgba(117,69,200,.45)] hover:opacity-90" style={{ borderRadius: rad(999) }}>
                    {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" className="ml-0.5" />}
                  </button>
                  <button onClick={next} aria-label="Bài tiếp theo" title="Bài tiếp theo" className="t-btn t-focus grid h-10 w-10 place-items-center border border-[rgba(255,255,255,.28)] bg-black/20 text-white hover:bg-black/35" style={{ borderRadius: rad(999) }}><SkipForward size={17} /></button>
                </div>
              </div>
            </div>

            <div className="pt-6">
              <section aria-label="Tiếp theo" className="t-panel flex aspect-square w-full flex-col overflow-hidden p-2.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] accent-text">Tiếp theo</p>
                {nextUp.length > 0 ? (
                  <ol className="flex min-h-0 flex-1 flex-col justify-between gap-1">
                    {nextUp.slice(0, 4).map((q, i) => (
                      <li key={`${q.title}-${i}`} className="min-w-0">
                        <p className="truncate text-[12px] font-semibold leading-tight">{q.title}</p>
                        <p className="truncate text-[10px] text-[var(--muted)]">{q.artist}</p>
                      </li>
                    ))}
                  </ol>
                ) : <p className="m-auto px-1 text-center text-[11px] leading-snug text-[var(--muted)]">Chưa có bài tiếp theo</p>}
              </section>
            </div>
          </section>

          {/* ỨNG DỤNG */}
          <section aria-label="Ứng dụng" className="mt-[3vh]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-bold">Ứng dụng</h2>
              {arrange && <p className="text-xs font-semibold accent-text">{picked ? "Đang di chuyển: dùng ← → ↑ ↓, bấm OK để thả" : "Sắp xếp: chọn ứng dụng, bấm OK để nhấc • Back để xong"}</p>}
            </div>
            {hasBridge && apps.length === 0 && <p className="text-xs text-[var(--muted)]">Đang tải danh sách ứng dụng…</p>}
            <div ref={gridRef} data-grid="apps" className="grid gap-3" style={{ gridTemplateColumns: `repeat(${sz.cols}, minmax(0, 1fr))` }}>
              {apps.map((app, i) => (
                <AppTile key={app.pkg || app.name} app={app} i={i} sz={sz} xperia={isXperia} active={selectedApp === i && !arrange} focused={focusedApp === i}
                  lifted={arrange && picked && focusedApp === i} onOpen={stableOpen} onFocusTile={stableFocus} setRef={setAppRef} />
              ))}
            </div>
          </section>

          {/* NGHE TIẾP — chỉ khi xem thử trên trình duyệt */}
          {!hasBridge && (
            <section aria-label="Nghe tiếp" className="mt-5">
              <h2 className="mb-2.5 text-[15px] font-bold">Nghe tiếp</h2>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
                {albums.map((a, i) => (
                  <button key={a.title} ref={(el) => { albumRefs.current[i] = el; }} onClick={() => playAlbum(i)}
                    className={`t-card t-focus group min-w-0 p-2 text-left sm:p-3 ${current === i ? "border-[var(--accent-line)] accent-soft" : ""}`}>
                    <span className="relative block aspect-square overflow-hidden" style={{ background: a.hue, borderRadius: rad(14) }}>
                      <span className="absolute inset-0 grid place-items-center text-lg font-extrabold text-white/95 sm:text-2xl">{a.mark}</span>
                    </span>
                    <span className="mt-2 block truncate text-[10px] font-semibold sm:text-[12px]">{a.title}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

        </main>
      </div>

      {toast && (
        <div role="status" className="toast-in fixed bottom-5 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-2 rounded-2xl border border-[var(--accent-line)] bg-[#1a1624] px-4 py-3 shadow-2xl">
          <Sparkles size={16} className="shrink-0 accent-text" />
          <p className="min-w-0 flex-1 text-[13px] font-medium [overflow-wrap:anywhere]">{toast}</p>
          <button onClick={() => setToast("")} aria-label="Đóng thông báo" className="shrink-0 text-[var(--muted)] hover:text-white"><X size={16} /></button>
        </div>
      )}

      {saverOn && (
        <div className="fixed inset-0 z-[70] overflow-hidden bg-black" aria-hidden="true">
          {saverStyle === "wall" && wallUrl && <div className="absolute inset-0 bg-cover bg-center opacity-45" style={{ backgroundImage: `url(${wallUrl})` }} />}
          <div className="absolute text-center" style={{ left: `${saverPos.x}%`, top: `${saverPos.y}%`, transform: "translate(-50%,-50%)", transition: softMotion ? "none" : "left 2s ease, top 2s ease" }}>
            <SaverClock clock24={clock24} nowPlaying={hasBridge && playing && session?.title ? album.title : ""} />
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/50" role="dialog" aria-modal="true" aria-label="Cài đặt GRAPE2TV Pro" onKeyDown={onDialogKeys}>
          <div className="flex h-full items-start justify-end p-[2vh]">
            <div ref={dialogRef} className="t-panel flex max-h-[96vh] w-[30vw] min-w-[280px] max-w-[330px] flex-col overflow-hidden p-3 shadow-2xl" style={{ background: isXperia ? "#111" : undefined }}>
              {/* Đầu cửa sổ */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center accent-bg" style={{ borderRadius: rad(999) }}><Grape size={16} /></span>
                  <div className="min-w-0 leading-tight"><h2 className="text-[13px] font-bold">Cài đặt</h2><p className="truncate text-[10px] text-[var(--muted)]">GRAPE2TV Pro • {CURRENT_VERSION}</p></div>
                </div>
                <button onClick={() => setSettingsOpen(false)} aria-label="Đóng cài đặt" className="t-focus grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/5"><X size={15} /></button>
              </div>

              {/* Thẻ */}
              <div role="tablist" className="mt-2.5 grid grid-cols-4 gap-1">
                {([["ui", "Giao diện"], ["wall", "Nền"], ["update", "Cập nhật"], ["system", "Hệ thống"]] as const).map(([k, t]) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                    className={`t-focus truncate border px-1 py-1.5 text-[11px] font-semibold ${tab === k ? "border-[var(--accent-line)] accent-soft accent-text" : "border-white/10 bg-white/[.04]"}`} style={{ borderRadius: rad(10) }}>{t}</button>
                ))}
              </div>

              <div className="mt-1 min-h-0 flex-1 overflow-y-auto pb-1 pr-0.5">
                {tab === "ui" && (
                  <div>
                    <Seg label="Giao diện" value={theme} r={rad(10)} options={[{ v: "liquid", t: "Liquid Glass" }, { v: "xperia", t: "Xperia" }]} onChange={(v) => changeTheme(v as Theme)} />
                    <Seg label="Cỡ biểu tượng ứng dụng" value={iconSize} r={rad(10)} options={(["sm", "md", "lg"] as IconSize[]).map((k) => ({ v: k, t: ICON_SIZES[k].label }))} onChange={(v) => changeSetting({ iconSize: v as IconSize })} />
                    <p className="mb-0 mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Hiển thị &amp; hiệu năng</p>
                    <Toggle label="Đồng hồ 24 giờ" on={clock24} r={rad(10)} onChange={(v) => changeSetting({ clock24: v })} />
                    <Toggle label="Chuyển động nhẹ (giảm mờ, bóng, hiệu ứng)" on={softMotion} r={rad(10)} onChange={(v) => changeSetting({ softMotion: v })} />
                    <p className="mb-0 mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Music Center</p>
                    <Seg label="Cỡ ô Thư viện" value={libSize} r={rad(10)} options={(["sm", "md", "lg"] as LibSize[]).map((k) => ({ v: k, t: LIB_SIZES[k].label }))} onChange={(v) => changeSetting({ libSize: v as LibSize })} />
                    <Seg label="Cỡ hộp Đang phát" value={npSize} r={rad(10)} options={(["sm", "md", "lg"] as LibSize[]).map((k) => ({ v: k, t: NP_SIZES[k].label }))} onChange={(v) => changeSetting({ npSize: v as LibSize })} />
                    <div className="mt-2.5 flex gap-1.5">
                      <SBtn r={rad(10)} onClick={startArrange} className="flex-1">Sắp xếp ứng dụng</SBtn>
                      <SBtn r={rad(10)} onClick={resetOrder}>Đặt lại</SBtn>
                    </div>
                    {saveState && <p aria-live="polite" className="mt-1.5 text-[10px] text-[var(--muted)]">{saveState}</p>}
                  </div>
                )}

                {tab === "wall" && (
                  <div>
                    <Seg label="Hình nền" value={wall} r={rad(10)} options={[{ v: "default", t: "Mặc định" }, { v: "picsum", t: "Ngẫu nhiên" }, { v: "bing", t: "Bing mỗi ngày" }]} onChange={(v) => changeSetting({ wall: v as WallKind })} />
                    <p className="mt-1.5 text-[10px] leading-snug text-[var(--muted)]">
                      {wall === "picsum" ? "Ảnh miễn phí từ Unsplash qua Picsum (cần mạng)." : wall === "bing" ? "Ảnh trang chủ Bing, đổi mỗi ngày (cần mạng)." : "Nền gradient mặc định, không cần mạng."}
                    </p>
                    {wall === "picsum" && <SBtn r={rad(10)} onClick={() => changeSetting({ wallSeed: Math.floor(Math.random() * 100000) })} className="mt-1.5 w-full"><RefreshCw size={13} /> Đổi ảnh khác</SBtn>}
                    <Seg label="Bảo vệ màn hình sau" value={String(saverMin)} r={rad(10)} options={[{ v: "0", t: "Tắt" }, { v: "2", t: "2′" }, { v: "5", t: "5′" }, { v: "10", t: "10′" }, { v: "30", t: "30′" }]} onChange={(v) => changeSetting({ saverMin: Number(v) })} />
                    <Seg label="Kiểu bảo vệ" value={saverStyle} r={rad(10)} options={[{ v: "clock", t: "Đồng hồ nền đen" }, { v: "wall", t: "Đồng hồ + ảnh nền" }]} onChange={(v) => changeSetting({ saverStyle: v as SaverStyle })} />
                    <SBtn r={rad(10)} onClick={() => { setSettingsOpen(false); window.setTimeout(() => setSaverOn(true), 500); }} className="mt-2 w-full">Xem thử bảo vệ màn hình</SBtn>
                    <p className="mt-1.5 text-[10px] leading-snug text-[var(--muted)]">Bấm phím bất kỳ để thoát. Đồng hồ tự dịch chuyển để tránh in hình lên màn hình.</p>
                  </div>
                )}

                {tab === "update" && (
                  <div className="mt-2.5">
                    <div className="flex items-center justify-between gap-2 border border-white/10 bg-black/20 p-2.5" style={{ borderRadius: rad(10) }}>
                      <div><p className="text-[10px] text-[var(--muted)]">Hiện tại</p><p className="text-sm font-extrabold">{CURRENT_VERSION}</p></div>
                      <div className="text-right"><p className="text-[10px] text-[var(--muted)]">Mới nhất</p><p className="text-sm font-extrabold accent-text">{latestVersion || "—"}</p></div>
                    </div>
                    {updateState === "idle" && <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">Chưa kiểm tra trong phiên này. Bấm nút bên dưới để kiểm tra từ GitHub.</p>}
                    {updateState === "latest" && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-emerald-300"><CheckCircle2 size={14} /> Đang dùng bản mới nhất{checkedAt ? ` (${checkedAt})` : ""}.</p>}
                    {updateState === "error" && <p className="mt-2 text-[11px] font-semibold text-red-300">Không kiểm tra/tải được. Hãy kiểm tra mạng rồi thử lại.</p>}
                    {updateState === "checking" && <p role="status" className="mt-2 flex items-center gap-2 text-[11px] font-medium"><Loader2 size={15} className="animate-spin accent-text" /> Đang kiểm tra…</p>}
                    {(updateState === "available" || updateState === "downloading" || updateState === "ready") && (
                      <div className="mt-2 border border-[var(--accent-line)] accent-soft p-2.5" style={{ borderRadius: rad(10) }}>
                        <p className="flex items-start gap-1.5 text-[12px] font-bold"><CheckCircle2 size={15} className="mt-0.5 shrink-0 accent-text" /><span>Có bản mới {latestVersion}</span></p>
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[10px] leading-snug text-[var(--muted)]">{changelog.map((c) => <li key={c}>{c}</li>)}</ul>
                        {updateState === "downloading" && (
                          <div className="mt-2">
                            <div className="flex justify-between text-[10px] font-semibold"><span>Đang tải…</span><span className="tabular-nums">{downloadProgress}%</span></div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/30" role="progressbar" aria-valuenow={downloadProgress} aria-valuemin={0} aria-valuemax={100}><div className="h-full accent-bg transition-all" style={{ width: `${downloadProgress}%` }} /></div>
                          </div>
                        )}
                        {updateState === "ready" && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-emerald-300"><CheckCircle2 size={14} /> Đã tải xong — mở trình cài đặt…</p>}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {updateState === "idle" && <SBtn r={rad(10)} primary onClick={checkUpdate} className="flex-1"><RefreshCw size={13} /> Kiểm tra cập nhật</SBtn>}
                      {(updateState === "available" || updateState === "ready") && (
                        <>
                          <SBtn r={rad(10)} primary onClick={startDownload} className="flex-1"><Download size={13} /> Tải và cài đặt</SBtn>
                          <SBtn r={rad(10)} onClick={() => { setUpdateState("idle"); showToast("Để sau — bạn có thể kiểm tra lại bất cứ lúc nào."); }}>Để sau</SBtn>
                        </>
                      )}
                      {updateState === "downloading" && <SBtn r={rad(10)} primary disabled className="flex-1"><Loader2 size={13} className="animate-spin" /> Đang tải {downloadProgress}%</SBtn>}
                      {updateState !== "idle" && updateState !== "downloading" && <SBtn r={rad(10)} onClick={checkUpdate}><RefreshCw size={13} /> Kiểm tra lại</SBtn>}
                    </div>
                    <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-snug text-[var(--muted)]"><ShieldCheck size={12} className="mt-0.5 shrink-0 accent-text" /><span>Nguồn: github.com/{REPO}. Chỉ cài APK cùng gói {PACKAGE_NAME}, cùng khoá ký.</span></p>
                  </div>
                )}

                {tab === "system" && (
                  <div className="mt-2.5">
                    {hasBridge ? (
                      <div className="grid grid-cols-1 gap-1.5">
                        <SBtn r={rad(10)} onClick={() => {
                          const r = bridge()?.setDefaultLauncher();
                          if (r === "none") showToast("TV không cho đổi: nhấn HOME, chọn GRAPE2TV Pro rồi chọn “Luôn dùng”, hoặc vào Cài đặt TV > Ứng dụng > Ứng dụng mặc định.");
                          else if (isDefault) showToast("GRAPE2TV Pro đã là launcher mặc định.");
                          else setSettingsOpen(false);
                        }}>{isDefault ? "✓ Đang là launcher mặc định" : "Đặt làm launcher mặc định"}</SBtn>
                        <SBtn r={rad(10)} onClick={() => bridge()?.openNotificationAccess()}>Cấp quyền hiển thị nhạc</SBtn>
                        <SBtn r={rad(10)} onClick={checkMusic}>Kiểm tra nhạc (chẩn đoán GRAPE2Play)</SBtn>
                        <SBtn r={rad(10)} onClick={() => setDiag(bridge()?.getDiagnostics() || "")}>Chẩn đoán treo / màn hình đen</SBtn>
                        <SBtn r={rad(10)} onClick={() => bridge()?.openSystemSettings()}>Cài đặt TV</SBtn>
                      </div>
                    ) : <p className="text-[11px] text-[var(--muted)]">Các mục hệ thống chỉ có khi chạy trên TV.</p>}
                    {diag && <pre className="mt-2 whitespace-pre-wrap break-words border border-white/10 bg-black/30 p-2 font-sans text-[10px] leading-snug" style={{ borderRadius: rad(10) }}>{diag}</pre>}
                    <p className="mb-1 mt-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]"><Info size={12} /> Về ứng dụng</p>
                    <div className="space-y-1 text-[11px]">
                      {([["Tên", "GRAPE2TV Pro"], ["Phiên bản", CURRENT_VERSION], ["Gói", PACKAGE_NAME], ["Kho cập nhật", REPO]] as const).map(([k, v]) => (
                        <p key={k} className="flex justify-between gap-2"><span className="text-[var(--muted)]">{k}</span><span className="text-right font-semibold [overflow-wrap:anywhere]">{v}</span></p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <SBtn r={rad(10)} primary onClick={() => setSettingsOpen(false)} className="mt-2 w-full">Xong</SBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
