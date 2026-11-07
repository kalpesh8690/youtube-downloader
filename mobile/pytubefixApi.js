const API_BASE_URL = "http://192.168.1.100:5000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export async function getVideoInfo(url) {
  return request("/api/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export async function getPreview(url, itag) {
  return request("/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, itag }),
  });
}

export async function startDownload({
  url,
  itag,
  mode = "video",
  outputFormat = "mp3",
}) {
  return request("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      itag,
      mode,
      output_format: outputFormat,
    }),
  });
}

export async function getProgress(jobId) {
  const result = await request(`/api/progress/${jobId}`);
  return result.job;
}

export function getFileUrl(jobId) {
  return `${API_BASE_URL}/api/file/${jobId}`;
}

export async function deleteJob(jobId) {
  return request(`/api/job/${jobId}`, {
    method: "DELETE",
  });
}

export { API_BASE_URL };
