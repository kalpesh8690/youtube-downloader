import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, ArrowRight, Check, Clipboard, Download, FileVideo, Globe, History,
  Link2, Loader2, Menu, Play, RefreshCw, ShieldCheck, Sparkles,
  TrendingDown, X, Zap, Trash2
} from "lucide-react";

const outputModes = ["MP4", "MP3"];
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
  const ext = String(item.ext || fileExtension(item.url)).toUpperCase();
  if (item.type === "stream") return ext || "STREAM";
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


function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + units[i];
}


export default function App() {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState("best");
  const [format, setFormat] = useState("MP4");
  const [availableFormats, setAvailableFormats] = useState([]);
  const [inspectState, setInspectState] = useState("idle");
  const inspectAbortRef = useRef(null);
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
  const [transferState, setTransferState] = useState("idle");

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem("downly-history") || "[]"));
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    const value = url.trim();
    if (!value) {
      inspectAbortRef.current?.abort();
      setInspectState("idle");
      return;
    }
    let parsed;
    try { parsed = new URL(value); } catch { return; }
    if (!["http:", "https:"].includes(parsed.protocol)) return;
    const timer = setTimeout(() => inspectMediaUrl(value, true), 650);
    return () => {
      clearTimeout(timer);
      inspectAbortRef.current?.abort();
    };
  }, [url]);

  const saveHistory = (item) => {
    const next = [item, ...history.filter((x) => x.url !== item.url)].slice(0, 10);
    setHistory(next);
    try { localStorage.setItem("downly-history", JSON.stringify(next)); } catch {}
  };

  const inspectMediaUrl = async (input, automatic = false) => {
    const value = String(input || "").trim();
    if (!value) return null;
    let parsed;
    try { parsed = new URL(value); } catch { return null; }
    if (!["http:", "https:"].includes(parsed.protocol)) return null;

    inspectAbortRef.current?.abort();
    const controller = new AbortController();
    inspectAbortRef.current = controller;
    setInspectState("loading");
    setError("");
    if (!automatic) setMessage("");

    try {
      const response = await fetch("/api/media/info", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url: value }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => null);

      if (response.ok && data?.ok && Array.isArray(data.formats) && data.formats.length) {
        setInfo(data);
        setAvailableFormats(data.formats);
        const firstVideo = data.formats.find((x) => x.hasVideo) || data.formats[0];
        setFormat(firstVideo?.hasVideo ? "MP4" : "MP3");
        setQuality(firstVideo?.id || "best");
        setDetectedMedia([]);
        setSelectedMediaUrl("");
        setScanMeta({ pagesScanned: 1, count: data.formats.length, directCount: data.formats.length, streamCount: 0, partial: false });
        setProgress(100);
        setProgressLabel("Media details ready");
        setInspectState("ready");
        setMessage((data.title ? "Ready: " + data.title : "Media details loaded.") + " · " + data.formats.length + " formats available.");
        return data;
      }

      if (response.ok && data?.ok) {
        setInfo(data);
        setAvailableFormats([]);
        setInspectState("ready");
      }

      const crawlResponse = await fetch("/api/media/crawl?"+new URLSearchParams({url:value}), { signal: controller.signal });
      const crawl = await crawlResponse.json().catch(() => null);
      if (crawlResponse.ok && crawl?.ok && Array.isArray(crawl.items) && crawl.items.length) {
        setInfo((prev) => prev || { title: crawl.title || safeHostname(value), author: safeHostname(value), thumbnail: null });
        const media = crawl.items.map((item) => ({
          url: item.url,
          type: item.kind === "hls" || item.kind === "dash" ? "stream" : (String(item.mime || "").startsWith("audio/") ? "audio" : "video"),
          ext: item.extension,
          mime: item.mime,
          title: crawl.title
        }));
        setDetectedMedia(media);
        const first = media.find((item) => item.type === "video" || item.type === "audio");
        setSelectedMediaUrl(first?.url || media[0]?.url || "");
        setScanMeta({ pagesScanned: 1, count: media.length, directCount: media.filter((item) => item.type !== "stream").length, streamCount: media.filter((item) => item.type === "stream").length, partial: false });
        setProgress(100);
        setProgressLabel("Page media scan ready");
        setInspectState("ready");
        setMessage("Found " + media.length + " media source(s) on this page.");
        return crawl;
      }

      const detectResponse = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url: value }),
        signal: controller.signal
      });
      const detect = await detectResponse.json().catch(() => null);
      if (!detectResponse.ok || !detect?.ok) throw new Error(data?.error || detect?.error || "No downloadable media was found.");

      const media = Array.isArray(detect.media) ? detect.media.filter((item) => item?.url) : [];
      setInfo((prev) => prev || { title: detect.title || safeHostname(value), author: safeHostname(value), thumbnail: null });
      setAvailableFormats([]);
      setDetectedMedia(media);
      const firstDirect = media.find((item) => item.type === "video" || item.type === "audio");
      setSelectedMediaUrl(firstDirect?.url || "");
      setScanMeta({
        pagesScanned: Number(detect.pagesScanned) || 1,
        count: Number(detect.count) || media.length,
        directCount: Number(detect.directCount) || media.filter((item) => item.type === "video" || item.type === "audio").length,
        streamCount: Number(detect.streamCount) || media.filter((item) => item.type === "stream").length,
        partial: Boolean(detect.partial)
      });
      setProgress(100);
      setProgressLabel("Media scan ready");
      setInspectState("ready");
      setMessage(media.length ? "Found " + media.length + " media source(s). Select a direct file to download." : "No downloadable media was found.");
      return detect;
    } catch (e) {
      if (e?.name === "AbortError") return null;
      setInspectState("error");
      setProgress(0);
      setProgressLabel("Inspection failed");
      setError(friendlyError(e?.message, 422));
      return null;
    }
  };



  const submit = async () => {
    const value = url.trim();
    if (!value) {
      setError("Paste a video or media URL first.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    setProgress(15);
    setProgressLabel("Inspecting media...");
    try {
      await inspectMediaUrl(value, false);
    } finally {
      setLoading(false);
    }
  };
  const retry = () => submit();

  const pasteFromClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (!value) throw new Error("Clipboard is empty.");
      setUrl(value.trim());
      setError("");
      setMessage("Link pasted from clipboard.");
    } catch (e) {
      setError(e?.message || "Clipboard access is unavailable. Paste the link manually.");
    }
  };

  const clearWorkspace = () => {
    inspectAbortRef.current?.abort();
    setUrl("");
    setInfo(null);
    setAvailableFormats([]);
    setDetectedMedia([]);
    setSelectedMediaUrl("");
    setError("");
    setMessage("");
    setProgress(0);
    setProgressLabel("Ready");
    setTransferState("idle");
    setInspectState("idle");
  };

  const handleDownload = async () => {
    setError("");
    setMessage("");

    const media = detectedMedia.find((item) => item.url === selectedMediaUrl)
      || detectedMedia.find((item) => item.type === "video" || item.type === "audio");

    if (!availableFormats.length && !media) {
      setError("Inspect the URL first. No downloadable format is available.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setProgress(0);
      setTransferState("downloading");
      setProgressLabel("Starting Chrome download...");

      if (availableFormats.length) {
        const audioOnly = format === "MP3";
        const selected = availableFormats.find((x) => x.id === quality && (audioOnly ? x.hasAudio : x.hasVideo))
          || availableFormats.find((x) => audioOnly ? x.hasAudio : x.hasVideo)
          || availableFormats[0];
        const directUrl = !audioOnly && selected?.hasAudio && selected?.directUrl ? selected.directUrl : null;
        const selector = audioOnly ? "ba/b" : (selected?.selector || "bv*+ba/b");
        const title = String(info?.title || "downly-download")
          .replace(/[\\/:*?"<>|]+/g, " ")
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, 140) || "downly-download";
        const selectedExt = String(selected?.ext || "").toLowerCase();
        const outputExt = audioOnly ? "mp3" : (directUrl && /^[a-z0-9]{2,5}$/.test(selectedExt) ? selectedExt : "mp4");
        const filename = title + "." + outputExt;

        const href = "/api/ytdlp/stream?" + new URLSearchParams({
          url: url.trim(),
          direct_url: directUrl || "",
          referer: info?.webpageUrl || url.trim(),
          format: selector,
          audio_only: audioOnly ? "true" : "false",
          filename
        }).toString();

        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = filename;
        anchor.rel = "noopener";
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        setTransferState("browser");
        setProgress(0);
        setProgressLabel("Chrome Downloads · download requested");
        setMessage(directUrl
          ? "Direct source sent to Chrome Downloads. This page does not buffer the file."
          : audioOnly
            ? "MP3 conversion stream sent to Chrome Downloads. The file is converted while it streams."
            : "Media stream sent to Chrome Downloads. The worker streams the result without saving a completed copy first.");
        saveHistory({
          url: url.trim(),
          title: info?.title || "Media download",
          thumbnail: info?.thumbnail,
          format: audioOnly ? "MP3" : "MP4",
          quality: selected?.label || "Best",
          createdAt: new Date().toISOString(),
          resumable: false,
          filename,
          sizeBytes: selected?.filesize || 0
        });
        setLoading(false);
        return;
      }

      if (media?.url) {
        const ext = String(media.ext || fileExtension(media.url)).toLowerCase();
        const isAudioMp3 = media.type === "audio" && ext === "mp3";
        const needsMp3Conversion = media.type === "audio" && !isAudioMp3;
        const isDirect = /\.(?:mp4|webm|m4v|mov|mkv|mp3|m4a|aac|wav|ogg|flac)(?:$|\?)/i.test(media.url);
        const outputExt = needsMp3Conversion ? "mp3" : (ext || (media.type === "audio" ? "mp3" : "mp4"));
        const filename = ((info?.title || "downly-download").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 140) || "downly-download") + "." + outputExt;
        const href = "/api/ytdlp/stream?" + new URLSearchParams({
          url: isDirect ? url.trim() : media.url,
          direct_url: isDirect && !needsMp3Conversion ? media.url : "",
          referer: url.trim(),
          format: "best",
          audio_only: needsMp3Conversion ? "true" : "false",
          filename
        }).toString();
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = filename;
        anchor.rel = "noopener";
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTransferState("browser");
        setProgress(0);
        setProgressLabel("Chrome Downloads · download requested");
        setMessage(isDirect
          ? "Direct media sent to Chrome Downloads. Downly does not buffer the file."
          : "Media stream sent to Chrome Downloads.");
        setLoading(false);
        return;
      }

      throw new Error("No downloadable media source was found.");
    } catch (e) {
      setProgress(0);
      setTransferState("error");
      setProgressLabel("Download failed");
      setError(e?.message || "Unable to start this download.");
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
        <section className="mx-auto max-w-6xl px-5 pb-14 pt-14 sm:px-8 sm:pt-20">
          <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_.95fr]">
            <div className="text-left">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-200">
                <Sparkles size={13} /> Downly 2.0 · Local worker powered
              </div>
              <h1 className="max-w-3xl text-4xl font-black leading-[1.05] tracking-[-0.05em] sm:text-6xl">
                Your media.<br />
                <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">Your download control.</span>
              </h1>
              <p className="mt-5 max-w-xl text-sm leading-7 text-slate-400 sm:text-base">
                Paste a public media URL, inspect it, choose the format, and manage the download with live progress, pause, resume and cancellation.
              </p>
              <div className="mt-7 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5"><ShieldCheck className="mr-1 inline" size={12}/> On-device worker</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5"><Gauge className="mr-1 inline" size={12}/> Live speed</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5"><RefreshCw className="mr-1 inline" size={12}/> Resume</span>
              </div>
            </div>

            <div className="glass rounded-[30px] border border-white/10 p-3 shadow-2xl shadow-indigo-950/30">
              <div className="rounded-[24px] border border-white/10 bg-black/25 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <div>
                    <p className="text-sm font-bold text-white">Download console</p>
                    <p className="text-[11px] text-slate-500">Paste a link to begin</p>
                  </div>
                  <button onClick={clearWorkspace} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white" title="Clear">
                    <Trash2 size={15}/>
                  </button>
                </div>
                <div className="relative">
                  <Link2 className="absolute left-4 top-4 text-slate-500" size={18}/>
                  <input value={url} onChange={(e)=>{setUrl(e.target.value);if(error)setError("");}} onKeyDown={(e)=>e.key==="Enter"&&submit()} placeholder="https://..." aria-label="Media URL" className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.03] pl-11 pr-24 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-400/50 focus:ring-4 focus:ring-indigo-500/10"/>
                  <button onClick={pasteFromClipboard} className="absolute right-2 top-2 flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-300 hover:bg-white/10">
                    <Clipboard size={14}/> Paste
                  </button>
                </div>
                <button onClick={submit} disabled={loading || !url.trim()} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white font-bold text-slate-950 transition hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-60">
                  {loading ? <Loader2 className="animate-spin" size={18}/> : <Download size={18}/>}
                  {loading || inspectState==="loading" ? "Inspecting media..." : inspectState==="ready" ? "Refresh metadata" : "Inspect & continue"} <ArrowRight size={16}/>
                </button>

                <div className="mt-3 flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px]">
                  <span className="text-slate-500">Status</span>
                  <span className={error ? "text-rose-300" : transferState==="browser" ? "text-emerald-300" : "text-indigo-200"}>{error ? "Action required" : transferState==="browser" ? "Sent to Chrome Downloads" : progressLabel}</span>
                </div>

                {loading && inspectState === "loading" && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-left" role="status" aria-live="polite">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="truncate pr-3 text-slate-400">{progressLabel}</span>
                      <Loader2 className="animate-spin text-indigo-300" size={14}/>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 animate-pulse"/>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">Preparing metadata and available formats. Your browser download starts only after you press Download.</p>
                  </div>
                )}
                {error && <div role="alert" className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3 text-left">
                  <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 shrink-0 text-rose-300" size={17}/><div className="min-w-0 flex-1"><p className="text-xs font-bold text-rose-200">Something went wrong</p><p className="mt-1 text-xs leading-5 text-rose-200/70">{error}</p></div><button onClick={retry} disabled={loading} className="rounded-lg border border-rose-300/20 px-2 py-1 text-[11px] font-semibold text-rose-100">Retry</button></div>
                </div>}
                {message && !error && <div className="mt-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-xs text-emerald-200"><Check className="mr-2 inline" size={15}/>{message}</div>}
              </div>
            </div>
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
              <div className="mt-4 line-clamp-2 text-sm font-semibold text-white">{info?.title || "Paste a URL to inspect media"}</div>
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
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{info?.author || "Scan a website or paste a direct media URL"}</span>
                {info?.extractor && <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{info.extractor}</span>}
                {info?.durationString && <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{info.durationString}</span>}
              </div>
            </div>

            <div className="glass rounded-3xl p-5 md:col-span-2">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-bold">Download settings</p><p className="mt-1 text-xs text-slate-500">Start a native Chrome download. Direct source files are proxied byte-for-byte; conversion happens only when needed.</p></div>
                <TrendingDown className="text-slate-600" size={20} />
              </div>
              {isYouTube(url) && info?.note && (
                <div className="mt-6 rounded-2xl border border-emerald-400/15 bg-emerald-400/5 px-4 py-3 text-xs leading-5 text-emerald-200">
                  <span className="font-bold">YouTube:</span> {info.note}
                </div>
              )}
              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-400">FORMAT
                  <select value={format} onChange={(e) => {
                    const next=e.target.value;
                    setFormat(next);
                    const first=availableFormats.find((x) => next==="MP3" ? x.hasAudio : x.hasVideo);
                    if(first) setQuality(first.id);
                  }} disabled={!availableFormats.length} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-indigo-400/50 disabled:opacity-40">
                    {outputModes.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-slate-400">QUALITY / SOURCE
                  <select value={quality} onChange={(e) => setQuality(e.target.value)} disabled={!availableFormats.length} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-indigo-400/50 disabled:opacity-40">
                    {availableFormats.filter((x) => format === "MP3" ? x.hasAudio : x.hasVideo).slice(0,80).map((x) => <option key={x.id} value={x.id}>{x.label}{x.filesize ? " · " + formatBytes(Number(x.filesize)) : ""}</option>)}
                  </select>
                </label>
              </div>
              {availableFormats.length > 0 && (
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Available formats</span>
                    <span className="text-[11px] text-slate-600">{availableFormats.length} detected</span>
                  </div>
                  <div className="max-h-52 space-y-1 overflow-auto pr-1">
                    {availableFormats.slice(0,80).map((x) => (
                      <button key={x.id} type="button" onClick={() => {setQuality(x.id);setFormat(x.hasVideo ? "MP4" : "MP3");}} className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition ${quality===x.id ? "bg-indigo-500/15 text-indigo-100" : "text-slate-400 hover:bg-white/5"}`}>
                        <span className="truncate">{x.label}</span>
                        <span className="ml-3 shrink-0 text-slate-600">{x.id}{x.filesize ? " · "+formatBytes(Number(x.filesize)) : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!isYouTube(url) && detectedMedia.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Detected media sources</p>
                  <div className="grid gap-2">
                    {detectedMedia.map((item, index) => {
                      const direct = item.type === "video" || item.type === "audio" || item.type === "stream";
                      return (
                        <button
                          type="button"
                          key={item.url}
                          disabled={!direct}
                          onClick={() => setSelectedMediaUrl(item.url)}
                          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${selectedMediaUrl === item.url ? "border-indigo-400/60 bg-indigo-500/10 text-indigo-100" : "border-white/10 bg-black/20 text-slate-300"}`}
                        >
                          <span className="min-w-0 truncate"><span className="font-bold">{mediaLabel(item)}</span> · {safeHostname(item.url)}</span>
                          <span className="shrink-0">{direct ? (selectedMediaUrl === item.url ? "Selected" : "Select") : "Preview only"}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">Clicking Download opens a native attachment response so Chrome's Downloads manager receives the bytes directly. Downly does not first save the finished file on the worker.</p>
                </div>
              )}
              <button onClick={handleDownload} disabled={loading || (!availableFormats.length && !detectedMedia.some((item) => item.url === selectedMediaUrl && (item.type === "video" || item.type === "audio")))} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 font-bold transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
                {loading ? "Preparing..." : availableFormats.length ? (format === "MP3" ? "Download MP3" : "Download " + (availableFormats.find((x) => x.id === quality)?.label || "selected video")) : selectedMediaUrl ? "Download selected media" : "Inspect media first"}
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
