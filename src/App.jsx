import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, Check, Download, FileVideo, Globe, History,
  Link2, Loader2, Menu, Play, RefreshCw, ShieldCheck, Sparkles,
  TrendingDown, X, Zap
} from "lucide-react";

const formats = ["Original"];
const qualities = ["Source"];
const features = [
  ["Lightning fast", "A clean workflow designed to minimize clicks.", Zap],
  ["Direct media", "Download public direct video and audio files you are authorized to save.", FileVideo],
  ["Original quality", "Keep the source file unchanged without transcoding.", Check],
  ["Responsive", "A polished experience on phones and desktops.", Globe]
];

function safeHostname(value) {
  try { return new URL(value).hostname; } catch { return "Invalid media URL"; }
}

function fileExtension(value) {
  try {
    const pathname = new URL(value).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1].toUpperCase() : "";
  } catch {
    return "";
  }
}

function mediaLabel(item) {
  const ext = fileExtension(item.url);
  if (item.type === "stream") return "STREAM";
  if (item.type === "embed") return "EMBED";
  return ext || item.type.toUpperCase();
}

function isYouTube(value) {
  try {
    const u = new URL(value);
    return /(^|\.)((youtube\.com)|(youtu\.be))$/.test(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function friendlyError(error, status) {
  if (status === 400) return error || "Please enter a valid public media URL.";
  if (status === 404) return error || "Video information is unavailable.";
  if (status === 405) return "This request method is not supported.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) return error || "The server could not inspect or reach this media source. Please try again.";
  return error || "Something went wrong. Please try again.";
}


function startBrowserDownload(mediaUrl) {
  const downloadUrl = "/api/download?url=" + encodeURIComponent(mediaUrl);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export default function App() {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState("Source");
  const [format, setFormat] = useState("Original");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("Ready");
  const [history, setHistory] = useState([]);
  const [detectedMedia, setDetectedMedia] = useState([]);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState("");
  const [scanMeta, setScanMeta] = useState({ pagesScanned: 0, count: 0, directCount: 0, streamCount: 0, partial: false });

  const valid = useMemo(() => { try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } }, [url]);

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem("downly-history") || "[]"));
    } catch {
      setHistory([]);
    }
  }, []);

  const saveHistory = (item) => {
    const next = [item, ...history.filter((x) => x.url !== item.url)].slice(0, 10);
    setHistory(next);
    try { localStorage.setItem("downly-history", JSON.stringify(next)); } catch {}
  };

  const submit = async () => {
    const value = url.trim();
    if (!value) {
      setError("Paste a webpage or direct media URL first.");
      return;
    }

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      setError("Enter a complete URL starting with http:// or https://.");
      return;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      setError("Only HTTP(S) URLs are supported.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");
    setInfo(null);
    setDetectedMedia([]);
    setSelectedMediaUrl("");
    setScanMeta({ pagesScanned: 0, count: 0, directCount: 0, streamCount: 0, partial: false });
    setProgress(10);
    setProgressLabel("Inspecting URL...");

    try {
      if (isYouTube(value)) {
        setProgress(35);
        setProgressLabel("Loading video details...");
        const response = await fetch("/api/youtube/info", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ url: value })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(friendlyError(data?.error, response.status));
        if (!data || data.ok !== true) throw new Error(data?.error || "The video details API returned an invalid response.");
        setInfo(data);
        setScanMeta({ pagesScanned: 1, count: 0, directCount: 0, streamCount: 0, partial: false });
        setProgress(100);
        setProgressLabel("Details loaded");
        setMessage(data.note || "Video details loaded. Protected YouTube media streams are not extracted.");
        return;
      }

      setProgress(35);
      setProgressLabel("Finding public media...");
      const response = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url: value })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(friendlyError(data?.error, response.status));
      if (!data || data.ok !== true) throw new Error(data?.error || "The media detector returned an invalid response.");

      const media = Array.isArray(data.media)
        ? data.media.filter((item) => item && typeof item.url === "string" && ["video", "audio", "stream", "embed", "unknown"].includes(item.type))
        : [];
      setInfo({ title: data.title || safeHostname(data.pageUrl || value), author: safeHostname(data.pageUrl || value), thumbnail: null });
      setDetectedMedia(media);
      setScanMeta({
        pagesScanned: Number(data.pagesScanned) || 1,
        count: Number(data.count) || media.length,
        directCount: Number(data.directCount) || media.filter((item) => item.type === "video" || item.type === "audio").length,
        streamCount: Number(data.streamCount) || media.filter((item) => item.type === "stream").length,
        partial: Boolean(data.partial)
      });
      const firstDirect = media.find((item) => item.type === "video" || item.type === "audio");
      setSelectedMediaUrl(firstDirect?.url || "");
      setProgress(100);
      setProgressLabel("Ready");
      setMessage(media.length ? "Found " + media.length + " media source(s) across " + (data.pagesScanned || 1) + " page(s). Direct files can be streamed; playlist/embed sources may require a supported player." : "No public direct media files were found in the pages scanned (" + (data.pagesScanned || 1) + ").");
    } catch (e) {
      setProgress(0);
      setProgressLabel("Ready");
      setProgress(0);
      setError(e?.message || "Unable to inspect this URL.");
    } finally {
      setLoading(false);
    }
  };

  const retry = () => submit();

  const handleDownload = async () => {
    setError("");
    setMessage("");

    const media = detectedMedia.find((item) => item.url === selectedMediaUrl)
      || detectedMedia.find((item) => item.type === "video" || item.type === "audio");

    if (!media) {
      setError("Scan a page and select a direct public video or audio file first.");
      return;
    }
    if (media.type !== "video" && media.type !== "audio") {
      setError("This source is a playlist or embed, not a direct media file. Protected or player-internal streams are not extracted.");
      return;
    }

    try {
      const parsed = new URL(media.url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only public HTTP(S) media URLs are supported.");

      setLoading(true);
      setProgress(25);
      setProgressLabel("Starting secure media stream...");
      startBrowserDownload(media.url);
      setProgress(100);
      setProgressLabel("Download request sent");
      setMessage("Your browser has been sent a streamed download. Large files are not buffered inside the app; check your browser downloads.");
      saveHistory({
        url: media.url,
        title: info?.title || "Downloaded media",
        thumbnail: info?.thumbnail,
        format: "Original",
        quality: "Source",
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      setProgress(0);
      setProgressLabel("Download failed");
      setError(e?.message || "Unable to start this download.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#060914] text-slate-100">
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="absolute left-[8%] top-[-180px] h-[520px] w-[520px] rounded-full bg-indigo-600/20 blur-[130px]" />
        <div className="absolute right-[-120px] top-[28%] h-[480px] w-[480px] rounded-full bg-fuchsia-600/15 blur-[130px]" />
        <div className="absolute bottom-[-180px] left-[35%] h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-[130px]" />
      </div>

      <header className="glass sticky top-0 z-30 border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <a href="#" className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-glow">
              <Download size={20} />
            </span>
            <span className="text-lg font-extrabold tracking-tight">Downly</span>
          </a>
          <nav className="hidden items-center gap-8 text-sm text-slate-400 md:flex">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#how" className="transition hover:text-white">How it works</a>
            <a href="#history" className="transition hover:text-white">History</a>
          </nav>
          <button onClick={() => setOpen(!open)} className="glass rounded-xl p-2 text-slate-300 md:hidden" aria-label="Menu">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {open && (
          <div className="border-t border-white/10 px-5 py-4 md:hidden">
            <div className="flex flex-col gap-4 text-sm text-slate-300">
              <a href="#features" onClick={() => setOpen(false)}>Features</a>
              <a href="#how" onClick={() => setOpen(false)}>How it works</a>
              <a href="#history" onClick={() => setOpen(false)}>History</a>
            </div>
          </div>
        )}
      </header>

      <main className="relative z-10">
        <section className="mx-auto max-w-5xl px-5 pb-16 pt-20 text-center sm:px-8 sm:pt-28">
          <div className="glass mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-indigo-200">
            <Sparkles size={14} /> Fast, simple & beautifully designed
          </div>
          <h1 className="text-4xl font-extrabold leading-tight tracking-[-0.05em] sm:text-6xl">
            Download videos.<br />
            <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">Keep it simple.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
            Scan a public website for direct video/audio files, then stream the original file to your device.
          </p>

          <div className="glass mx-auto mt-10 max-w-3xl rounded-[28px] p-2 shadow-glow sm:p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex min-w-0 flex-1 items-center">
                <Link2 className="absolute left-4 text-slate-500" size={19} />
                <input
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); if (error) setError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Paste a webpage or direct media URL..."
                  aria-label="Webpage or direct media URL"
                  className="h-14 w-full rounded-2xl border border-white/10 bg-black/25 pl-12 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-400/50 focus:bg-black/35 focus:ring-4 focus:ring-indigo-500/10"
                />
              </div>
              <button onClick={submit} disabled={loading} className="group flex h-14 items-center justify-center gap-2 rounded-2xl bg-white px-6 font-bold text-slate-950 transition hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-70">
                {loading ? <Loader2 className="animate-spin" size={19} /> : <Download size={19} />}
                {loading ? "Checking..." : "Detect media"}
                <ArrowRight className="transition group-hover:translate-x-1" size={17} />
              </button>
            </div>

            {(loading || progress > 0) && (
              <div className="px-3 pb-1 pt-4 text-left">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-slate-400">{progressLabel}</span>
                  <span className="font-bold text-indigo-200">{progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="mt-3 flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-left text-sm text-rose-200">
                <AlertCircle className="mt-0.5 shrink-0" size={18} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Request failed</p>
                  <p className="mt-1 text-rose-200/75">{error}</p>
                </div>
                <button onClick={retry} disabled={loading} className="rounded-lg border border-rose-300/20 px-2.5 py-1.5 text-xs font-semibold hover:bg-rose-400/10">Retry</button>
              </div>
            )}

            {message && !error && (
              <div className="mt-3 flex items-start gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/5 px-4 py-3 text-left text-sm text-emerald-200">
                <Check className="mt-0.5 shrink-0" size={18} />
                <span>{message}</span>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><ShieldCheck size={14} /> Secure processing</span>
            <span className="flex items-center gap-1.5"><Zap size={14} /> Fast workflow</span>
            <span className="flex items-center gap-1.5"><Globe size={14} /> Cross-device</span>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 pb-20 sm:px-8">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="glass rounded-3xl p-5">
              <div className="mb-8 flex items-center justify-between">
                <FileVideo className="text-indigo-300" size={24} />
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-500">Preview</span>
              </div>
              <div className="aspect-video overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 p-1">
                {info?.thumbnail ? <img src={info.thumbnail} alt="" className="h-full w-full rounded-xl object-cover" /> : <div className="flex h-full items-center justify-center rounded-xl border border-white/5"><Play className="fill-white text-white" size={28} /></div>}
              </div>
              <div className="mt-4 line-clamp-2 text-sm font-semibold text-white">{info?.title || "Video preview"}</div>
              {scanMeta.count > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-2 text-center">
                    <div className="text-sm font-bold text-white">{scanMeta.count}</div>
                    <div className="text-[10px] text-slate-500">FOUND</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-2 text-center">
                    <div className="text-sm font-bold text-emerald-300">{scanMeta.directCount}</div>
                    <div className="text-[10px] text-slate-500">DIRECT</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-2 text-center">
                    <div className="text-sm font-bold text-indigo-300">{scanMeta.pagesScanned}</div>
                    <div className="text-[10px] text-slate-500">PAGES</div>
                  </div>
                </div>
              )}
              <div className="mt-2 text-xs text-slate-500">{info?.author || "Scan a website or paste a direct media URL"}</div>
            </div>

            <div className="glass rounded-3xl p-5 md:col-span-2">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-bold">Download settings</p><p className="mt-1 text-xs text-slate-500">Stream the original source file without buffering it in app memory.</p></div>
                <TrendingDown className="text-slate-600" size={20} />
              </div>
              {isYouTube(url) && info?.note && (
                <div className="mt-6 rounded-2xl border border-amber-400/15 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-200">
                  <span className="font-bold">YouTube:</span> {info.note}
                </div>
              )}
              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-400">FORMAT
                  <select value={format} onChange={(e) => setFormat(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-indigo-400/50">
                    {formats.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-slate-400">QUALITY
                  <select value={quality} onChange={(e) => setQuality(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-indigo-400/50">
                    {qualities.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </label>
              </div>
              {detectedMedia.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Detected media sources</p>
                  <div className="grid gap-2">
                    {detectedMedia.map((item, index) => {
                      const direct = item.type === "video" || item.type === "audio";
                      return (
                        <button
                          type="button"
                          key={item.url}
                          disabled={!direct}
                          onClick={() => setSelectedMediaUrl(item.url)}
                          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${selectedMediaUrl === item.url ? "border-indigo-400/60 bg-indigo-500/10 text-indigo-100" : "border-white/10 bg-black/20 text-slate-300"}`}
                        >
                          <span className="min-w-0 truncate"><span className="font-bold">{mediaLabel(item)}</span> · {safeHostname(item.url)}</span>
                          <span className="shrink-0">{direct ? (selectedMediaUrl === item.url ? "Selected" : "Select") : "Detected only"}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">Direct files are downloadable in their original format. STREAM/EMBED entries are detected for visibility but are not extracted or converted.</p>
                </div>
              )}
              <button onClick={handleDownload} disabled={loading || !selectedMediaUrl || !detectedMedia.some((item) => item.url === selectedMediaUrl && (item.type === "video" || item.type === "audio"))} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 font-bold transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
                {loading ? "Starting..." : selectedMediaUrl ? "Download selected media" : "Select direct media to download"}
              </button>
            </div>
          </div>
        </section>

        <section id="features" className="border-y border-white/5 bg-white/[0.02]">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
            <div className="max-w-xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">Built for speed</p><h2 className="mt-3 text-3xl font-bold tracking-tight">Everything you need. Nothing you don't.</h2></div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(([title, desc, Icon]) => <div key={title} className="glass rounded-2xl p-5 transition hover:-translate-y-1 hover:bg-white/[0.07]"><div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/10 text-indigo-300"><Icon size={18} /></div><h3 className="mt-5 font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{desc}</p></div>)}
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-5xl px-5 py-20 sm:px-8">
          <div className="text-center"><p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">How it works</p><h2 className="mt-3 text-3xl font-bold">Three simple steps</h2></div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[["01", "Paste your link", "Paste a public webpage or direct media file URL."], ["02", "Scan pages", "Downly scans up to six linked HTML pages on the same website."], ["03", "Stream download", "The browser receives the original file directly from the download API."]].map(([n, t, d]) => <div className="glass rounded-2xl p-6" key={n}><span className="text-sm font-bold text-indigo-300">{n}</span><h3 className="mt-8 font-bold">{t}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{d}</p></div>)}
          </div>
        </section>

        <section id="history" className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <div className="glass rounded-3xl p-6 sm:p-8">
            <div className="flex items-center gap-3"><History className="text-indigo-300" size={21} /><div><h2 className="font-bold">Download history</h2><p className="text-xs text-slate-500">Your recent requests are stored locally on this device.</p></div></div>
            {history.length === 0 ? (
              <div className="mt-7 flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-600">No downloads yet</div>
            ) : (
              <div className="mt-7 grid gap-3">
                {history.map((item) => <div key={item.url} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                  {item.thumbnail ? <img src={item.thumbnail} alt="" className="h-14 w-24 rounded-xl object-cover" /> : <div className="grid h-14 w-24 place-items-center rounded-xl bg-white/5"><FileVideo size={18} /></div>}
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.format} · {item.quality}</p></div>
                  <Check className="shrink-0 text-emerald-400" size={18} />
                </div>)}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-8"><span>© 2026 Downly</span><span>Built with React + Tailwind CSS + Lucide</span></div>
      </footer>
    </div>
  );
}
