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


async function downloadAuthorizedMedia(mediaUrl, format, quality) {
  const response = await fetch("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify({ url: mediaUrl, format, quality })
  });

  if (!response.ok) {
    let data = null;
    try { data = await response.json(); } catch {}
    throw new Error(friendlyError(data?.error, response.status));
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error("The server returned an empty file.");

  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || `downly-${Date.now()}.${format.toLowerCase()}`;

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
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
  const [detectedMedia, setDetectedMedia] = useState([]);

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
    setMessage("");
    setError("");
    setInfo(null);
    setDetectedMedia([]);
    setProgress(0);

    if (!url.trim()) {
      setError("Paste a webpage or direct media URL to continue.");
      return;
    }
    if (!valid) {
      setError("Enter a valid HTTP(S) URL.");
      return;
    }

    setLoading(true);
    setProgressLabel("Inspecting webpage...");
    setProgress(18);

    try {
      const response = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url: url.trim() })
      });

      let data = null;
      try { data = await response.json(); } catch { throw new Error("The detector returned an invalid response."); }
      if (!response.ok || !data?.ok) throw new Error(friendlyError(data?.error, response.status));

      setProgressLabel("Detecting public media sources...");
      setProgress(65);
      setDetectedMedia(data.media || []);

      let metadata = null;
      if (isYouTube(url)) {
        const yt = await fetch("/api/youtube/info", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ url: url.trim() })
        });
        if (yt.ok) metadata = await yt.json();
      }

      setInfo(metadata || {
        ok: true,
        title: data.title || "Detected media",
        author: new URL(data.pageUrl || url).hostname,
        thumbnail: null,
        watchUrl: data.pageUrl || url
      });
      setProgress(100);
      setProgressLabel("Detection complete");

      if ((data.media || []).length) {
        setMessage(`Detected ${data.media.length} public media source(s). Browser download requires the source to allow CORS.`);
      } else {
        setMessage("No public direct video/audio URL was exposed by this page. Protected, DRM, login-only and player-internal streams are not bypassed.");
      }

      saveHistory({
        url: url.trim(),
        title: metadata?.title || data.title || "Detected media",
        thumbnail: metadata?.thumbnail,
        format,
        quality,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      setProgress(0);
      setProgressLabel("Failed");
      setError(e?.message || "Unable to inspect the URL.");
    } finally {
      setLoading(false);
    }
  };

  const retry = () => submit();

  const handleDownload = async () => {
    setError("");
    setMessage("");

    if (!detectedMedia.length) {
      await submit();
      return;
    }

    const media = detectedMedia.find((item) => item.type === "video" || item.type === "audio");
    if (!media) {
      setError("Only direct video/audio files can be captured as a Blob. HLS/DASH streams require a player and are not converted here.");
      return;
    }

    try {
      setLoading(true);
      setProgressLabel("Fetching media Blob...");
      setProgress(15);

      const response = await fetch(media.url, { mode: "cors" });
      if (!response.ok) throw new Error(`Media server returned HTTP ${response.status}.`);
      const blob = await response.blob();
      if (!blob.size) throw new Error("The media response was empty.");

      setProgress(85);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `downly-${Date.now()}.${format === "WEBM" ? "webm" : format === "MP3" ? "mp3" : "mp4"}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

      setProgress(100);
      setProgressLabel("Blob download complete");
      setMessage("Media captured into a browser Blob and downloaded.");
    } catch (e) {
      setProgress(0);
      setProgressLabel("Capture failed");
      setError(e?.message?.includes("Failed to fetch")
        ? "The media server blocked browser access with CORS. Open the source directly or use a source that permits cross-origin reads."
        : (e?.message || "Unable to capture the media Blob."));
    } finally {
      setLoading(false);
    }
  };
