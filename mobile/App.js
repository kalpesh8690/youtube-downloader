import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

const CLOUD_API = "https://youtube-downloader.chauhankalpesh760.workers.dev";
const LOCAL_API = "http://127.0.0.1:3000";

const COLORS = {
  bg: "#05070d",
  card: "#0c111b",
  card2: "#101827",
  border: "#202a3a",
  text: "#f8fafc",
  muted: "#94a3b8",
  purple: "#7c3aed",
  purple2: "#6366f1",
  green: "#34d399",
  red: "#fb7185",
};

function cleanName(value) {
  return (
    String(value || "downly-download")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "downly-download"
  );
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function isYouTube(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return /(^|\.)((youtube\.com)|(youtu\.be))$/.test(hostname);
  } catch {
    return false;
  }
}

async function requestJson(base, path, options = {}) {
  const response = await fetch(base + path, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

export default function App() {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState(null);
  const [formats, setFormats] = useState([]);
  const [mode, setMode] = useState("MP4");
  const [quality, setQuality] = useState("");
  const [backend, setBackend] = useState("cloud");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState(0);
  const [total, setTotal] = useState(0);
  const taskRef = useRef(null);

  const choices = useMemo(
    () =>
      formats
        .filter((item) => (mode === "MP3" ? item?.hasAudio : item?.hasVideo))
        .slice(0, 10),
    [formats, mode]
  );

  const reset = () => {
    setUrl("");
    setInfo(null);
    setFormats([]);
    setQuality("");
    setError("");
    setStatus("Ready");
  };

  const inspect = async () => {
    const value = url.trim();
    setError("");
    setInfo(null);
    setFormats([]);
    setQuality("");

    if (!/^https?:\/\//i.test(value)) {
      setError("Paste a complete http(s) URL.");
      return;
    }

    setBusy(true);
    setStatus("Inspecting media…");

    try {
      let result = await requestJson(CLOUD_API, "/api/media/info", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ url: value }),
      });

      let activeBackend = "cloud";

      if ((!result.response.ok || !result.data?.ok) && isYouTube(value)) {
        setStatus("Cloud unavailable. Trying local Termux…");
        try {
          const local = await requestJson(LOCAL_API, "/api/media/info", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ url: value }),
          });

          if (local.response.ok && local.data?.ok && local.data?.formats?.length) {
            result = local;
            activeBackend = "local";
          }
        } catch {
          // Local Termux is optional.
        }
      }

      if (!result.response.ok || !result.data?.ok) {
        throw new Error(
          result.data?.error || `Inspection failed (${result.response.status})`
        );
      }

      const list = Array.isArray(result.data.formats) ? result.data.formats : [];
      if (!list.length) throw new Error("No downloadable formats returned.");

      const firstVideo = list.find((item) => item?.hasVideo);
      setInfo(result.data);
      setFormats(list);
      setBackend(activeBackend);
      setMode(firstVideo ? "MP4" : "MP3");
      setQuality((firstVideo || list[0])?.id || "");
      setStatus(
        `Ready · ${list.length} formats · ${activeBackend === "local" ? "Local" : "Cloud"} worker`
      );
    } catch (err) {
      setStatus("Inspection failed");
      setError(err?.message || "Could not inspect this URL.");
    } finally {
      setBusy(false);
    }
  };

  const downloadFrom = async (base, filename, selected, audioOnly) => {
    const directUrl =
      !audioOnly && selected?.hasAudio && selected?.directUrl
        ? selected.directUrl
        : "";

    const selector = audioOnly
      ? "ba/b"
      : selected?.selector || "bv*+ba/b";

    const params = new URLSearchParams({
      url: url.trim(),
      direct_url: directUrl,
      referer: info?.webpageUrl || url.trim(),
      format: selector,
      audio_only: String(audioOnly),
      filename,
    });

    const destination = new File(Paths.document, filename);
    if (destination.exists) destination.delete();

    const task = File.createDownloadTask(
      `${base}/api/ytdlp/stream?${params.toString()}`,
      destination,
      {
        onProgress: ({ bytesWritten, totalBytes }) => {
          setWritten(bytesWritten);
          setTotal(totalBytes > 0 ? totalBytes : 0);
        },
      }
    );

    taskRef.current = task;
    return task.downloadAsync();
  };

  const download = async () => {
    if (!info || !formats.length) {
      setError("Inspect a URL first.");
      return;
    }

    const audioOnly = mode === "MP3";
    const selected =
      formats.find(
        (item) =>
          item.id === quality &&
          (audioOnly ? item.hasAudio : item.hasVideo)
      ) ||
      formats.find((item) => (audioOnly ? item.hasAudio : item.hasVideo)) ||
      formats[0];

    const filename = `${cleanName(info?.title)}.${audioOnly ? "mp3" : "mp4"}`;

    setBusy(true);
    setError("");
    setWritten(0);
    setTotal(0);
    setStatus(`Downloading ${filename}…`);

    try {
      let activeBackend = backend;
      let file;

      try {
        file = await downloadFrom(
          backend === "local" ? LOCAL_API : CLOUD_API,
          filename,
          selected,
          audioOnly
        );
      } catch (cloudError) {
        if (backend !== "local" && isYouTube(url)) {
          setStatus("Cloud download failed. Trying local Termux…");
          file = await downloadFrom(
            LOCAL_API,
            filename,
            selected,
            audioOnly
          );
          activeBackend = "local";
          setBackend("local");
        } else {
          throw cloudError;
        }
      }

      if (!file) throw new Error("Download was cancelled.");

      setStatus(
        `Download complete · ${activeBackend === "local" ? "Local" : "Cloud"} worker`
      );

      Alert.alert("Downly", `${filename}\n\nDownload complete.`, [
        {
          text: "Share / Save",
          onPress: async () => {
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(file.uri, {
                dialogTitle: "Save or share your Downly download",
              });
            } else {
              Alert.alert("Saved", file.uri);
            }
          },
        },
        { text: "OK" },
      ]);
    } catch (err) {
      setStatus("Download failed");
      setError(err?.message || "Download failed.");
    } finally {
      taskRef.current = null;
      setBusy(false);
    }
  };

  const cancel = () => {
    try {
      taskRef.current?.cancel();
      setStatus("Download cancelled");
    } catch {}
  };

  const percent =
    total > 0 ? Math.min(100, Math.round((written / total) * 100)) : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>↓</Text>
          </View>
          <View>
            <Text style={styles.brand}>Downly</Text>
            <Text style={styles.tagline}>Fast. Simple. Yours.</Text>
          </View>
        </View>

        <View style={styles.workerBadge}>
          <View style={styles.workerDot} />
          <Text style={styles.workerText}>
            {backend === "local" ? "Local Termux worker" : "Cloud worker"}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Download anything</Text>
          <Text style={styles.subheading}>
            Paste a public media URL and choose your format.
          </Text>

          <TextInput
            value={url}
            onChangeText={(value) => {
              setUrl(value);
              setError("");
            }}
            placeholder="https://youtube.com/..."
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={inspect}
            style={styles.input}
          />

          <View style={styles.actionRow}>
            <Pressable
              style={styles.inspectButton}
              onPress={inspect}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#070b13" />
              ) : (
                <Text style={styles.inspectText}>Inspect media</Text>
              )}
            </Pressable>

            <Pressable style={styles.clearButton} onPress={reset} disabled={busy}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          </View>

          <Text style={styles.status}>{status}</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {info ? (
            <View style={styles.result}>
              <Text style={styles.title} numberOfLines={3}>
                {info.title || "Media"}
              </Text>

              {info.uploader ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {info.uploader}
                </Text>
              ) : null}

              <View style={styles.modeRow}>
                <Pressable
                  style={[styles.modeButton, mode === "MP4" && styles.modeActive]}
                  onPress={() => setMode("MP4")}
                >
                  <Text style={styles.modeText}>🎬 MP4</Text>
                </Pressable>
                <Pressable
                  style={[styles.modeButton, mode === "MP3" && styles.modeActive]}
                  onPress={() => setMode("MP3")}
                >
                  <Text style={styles.modeText}>🎵 MP3</Text>
                </Pressable>
              </View>

              <Text style={styles.label}>Quality</Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.qualityRow}
              >
                {choices.map((item) => (
                  <Pressable
                    key={String(item.id)}
                    style={[
                      styles.quality,
                      quality === item.id && styles.qualityActive,
                    ]}
                    onPress={() => setQuality(item.id)}
                  >
                    <Text style={styles.qualityText}>
                      {item.label || item.id}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Pressable
                style={styles.downloadButton}
                onPress={download}
                disabled={busy}
              >
                <Text style={styles.downloadText}>
                  ↓  Download {mode}
                </Text>
              </Pressable>

              {busy && status.startsWith("Downloading") ? (
                <View style={styles.progressBox}>
                  <View style={styles.progressTop}>
                    <Text style={styles.progressText}>
                      {formatBytes(written)}
                      {total ? ` / ${formatBytes(total)}` : ""}
                    </Text>
                    <Text style={styles.progressText}>
                      {total ? `${percent}%` : "LIVE"}
                    </Text>
                  </View>

                  <View style={styles.track}>
                    <View
                      style={[
                        styles.fill,
                        { width: `${total ? Math.max(2, percent) : 35}%` },
                      ]}
                    />
                  </View>

                  <Pressable style={styles.cancelButton} onPress={cancel}>
                    <Text style={styles.cancelText}>Cancel download</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Downly Android</Text>
          <Text style={styles.infoText}>
            Downly uses the cloud worker first. For YouTube, if the cloud
            worker is blocked or unavailable, it can automatically try the
            local Termux worker running on this phone.
          </Text>

          <Pressable
            onPress={() => Linking.openURL(CLOUD_API)}
            style={styles.webButton}
          >
            <Text style={styles.webButtonText}>Open Downly Web</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  page: { padding: 18, paddingBottom: 42 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  logo: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: COLORS.purple2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  logoText: { color: "#fff", fontSize: 36, fontWeight: "900", marginTop: -3 },
  brand: { color: COLORS.text, fontSize: 29, fontWeight: "900" },
  tagline: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  workerBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 14,
  },
  workerDot: {
    width: 7,
    height: 7,
    borderRadius: 7,
    backgroundColor: COLORS.green,
    marginRight: 7,
  },
  workerText: { color: "#cbd5e1", fontSize: 11, fontWeight: "700" },
  card: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 24,
    padding: 16,
  },
  heading: { color: COLORS.text, fontSize: 21, fontWeight: "900" },
  subheading: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 5,
    marginBottom: 15,
  },
  input: {
    backgroundColor: "#080d18",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 15,
    minHeight: 56,
    paddingHorizontal: 14,
    color: COLORS.text,
    fontSize: 14,
  },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  inspectButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 15,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },
  inspectText: { color: "#070b13", fontSize: 15, fontWeight: "900" },
  clearButton: {
    minHeight: 50,
    paddingHorizontal: 16,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card2,
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: { color: "#cbd5e1", fontSize: 13, fontWeight: "800" },
  status: {
    color: "#a5b4fc",
    fontSize: 11,
    marginTop: 12,
    textAlign: "center",
  },
  error: {
    color: COLORS.red,
    backgroundColor: "#2a1018",
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
    fontSize: 12,
  },
  result: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 15,
  },
  title: { color: COLORS.text, fontSize: 16, fontWeight: "800", lineHeight: 22 },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  modeRow: { flexDirection: "row", gap: 8 },
  modeButton: {
    flex: 1,
    marginTop: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 13,
    alignItems: "center",
    paddingVertical: 12,
    backgroundColor: "#090e19",
  },
  modeActive: {
    borderColor: COLORS.purple,
    backgroundColor: "#21163c",
  },
  modeText: { color: "#ddd6fe", fontWeight: "800" },
  label: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 8,
  },
  qualityRow: { paddingRight: 5 },
  quality: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginRight: 7,
    backgroundColor: "#090e19",
  },
  qualityActive: {
    borderColor: COLORS.purple2,
    backgroundColor: "#171d38",
  },
  qualityText: { color: "#dbeafe", fontSize: 11, fontWeight: "700" },
  downloadButton: {
    marginTop: 16,
    backgroundColor: COLORS.purple2,
    minHeight: 53,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  downloadText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  progressBox: {
    marginTop: 14,
    backgroundColor: "#080d18",
    borderRadius: 15,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  progressTop: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressText: { color: "#cbd5e1", fontSize: 11, fontWeight: "700" },
  track: {
    height: 8,
    backgroundColor: "#1e293b",
    borderRadius: 8,
    overflow: "hidden",
    marginTop: 9,
  },
  fill: { height: "100%", backgroundColor: COLORS.purple, borderRadius: 8 },
  cancelButton: { alignSelf: "flex-end", paddingTop: 10 },
  cancelText: { color: COLORS.red, fontSize: 11, fontWeight: "800" },
  infoCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "#0a0f1b",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoTitle: { color: COLORS.text, fontWeight: "800", fontSize: 14 },
  infoText: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 7,
  },
  webButton: { marginTop: 10 },
  webButtonText: { color: "#a5b4fc", fontSize: 12, fontWeight: "800" },
});
