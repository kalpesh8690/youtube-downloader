import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, Check, Download, FileVideo, Globe, History,
  Link2, Loader2, Menu, Play, RefreshCw, ShieldCheck, Sparkles,
  TrendingDown, X, Zap
} from "lucide-react";

const formats = ["MP4", "MP3", "WEBM"];
const qualities = ["1080p", "720p", "480p", "360p"];
const features = [
  ["Lightning fast", "A clean workflow designed to minimize clicks.", Zap],
  ["Multiple formats", "Prepare MP4, MP3 and WEBM outputs.", FileVideo],
  ["Quality control", "Pick the resolution that fits your needs.", Check],
  ["Responsive", "A polished experience on phones and desktops.", Globe]
];

function isYouTube(value) {
  try {
    const u = new URL(value);
    return /(^|\.)((youtube\.com)|(youtu\.be))$/.test(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function friendlyError(error, status) {
  if (status === 400) return error || "Please enter a valid YouTube URL.";
  if (status === 404) return error || "Video information is unavailable.";
  if (status === 405) return "This request method is not supported.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) return "The server could not reach the video service. Please try again.";
  return error || "Something went wrong. Please try again.";
}

export default function App() {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState("1080p");
  const [format, setFormat] = useState("MP4");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("Ready");
  const [history, setHistory] = useState([]);

  const valid = useMemo(() => isYouTube(url), [url]);

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
    setMessage("");
    setError("");
    setInfo(null);
    setProgress(0);

    if (!url.trim()) {
      setError("Paste a YouTube URL to continue.");
      return;
    }
    if (!valid) {
      setError("That doesn't look like a valid YouTube URL.");
      return;
    }

    setLoading(true);
    setProgressLabel("Validating URL...");
    setProgress(12);

    try {
      setProgressLabel("Connecting to API...");
      setProgress(30);

      const response = await fetch("/api/youtube/info", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url: url.trim() })
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        throw new Error("The API returned an invalid response.");
      }

      if (!response.ok || !data?.ok) {
        const e = new Error(friendlyError(data?.error, response.status));
        e.status = response.status;
        throw e;
      }

      setProgressLabel("Processing video information...");
      setProgress(72);
      await new Promise((resolve) => setTimeout(resolve, 250));

      setInfo(data);
      setProgress(100);
      setProgressLabel("Complete");
      setMessage("Video information loaded. Download only content you own or are authorized to use.");
      saveHistory({
        url: url.trim(),
        title: data.title || "Untitled video",
        thumbnail: data.thumbnail,
        format,
        quality,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      setProgress(0);
      setProgressLabel("Failed");
      setError(e?.message || "Unable to complete the request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const retry = () => submit();

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
            Paste a video link, choose your format and quality, and get your download workflow ready in seconds.
          </p>

          <div className="glass mx-auto mt-10 max-w-3xl rounded-[28px] p-2 shadow-glow sm:p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex min-w-0 flex-1 items-center">
                <Link2 className="absolute left-4 text-slate-500" size={19} />
                <input
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); if (error) setError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Paste YouTube URL here..."
                  aria-label="YouTube URL"
                  className="h-14 w-full rounded-2xl border border-white/10 bg-black/25 pl-12 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-400/50 focus:bg-black/35 focus:ring-4 focus:ring-indigo-500/10"
                />
              </div>
              <button onClick={submit} disabled={loading} className="group flex h-14 items-center justify-center gap-2 rounded-2xl bg-white px-6 font-bold text-slate-950 transition hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-70">
                {loading ? <Loader2 className="animate-spin" size={19} /> : <Download size={19} />}
                {loading ? "Checking..." : "Download"}
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
              <div className="mt-2 text-xs text-slate-500">{info?.author || "Paste a URL to load video information"}</div>
            </div>

            <div className="glass rounded-3xl p-5 md:col-span-2">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-bold">Download settings</p><p className="mt-1 text-xs text-slate-500">Choose your preferred output.</p></div>
                <TrendingDown className="text-slate-600" size={20} />
              </div>
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
              <button onClick={submit} disabled={loading} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 font-bold transition hover:bg-indigo-400 disabled:opacity-60">
                <Download size={18} /> Download {format} · {quality}
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
            {[["01", "Paste your link", "Add a supported video URL."], ["02", "Choose output", "Select format and quality."], ["03", "Start download", "The API validates the URL and returns video metadata."]].map(([n, t, d]) => <div className="glass rounded-2xl p-6" key={n}><span className="text-sm font-bold text-indigo-300">{n}</span><h3 className="mt-8 font-bold">{t}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{d}</p></div>)}
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
