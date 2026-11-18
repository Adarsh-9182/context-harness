import type { Attachment } from "./client-types";

export const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm";

const extensionTypes: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/mp4",
  webm: "video/webm",
};
const MAX_VIDEO_BYTES = 200_000_000;
const MAX_VIDEO_DURATION_SECONDS = 86_400;
const MAX_JPEG_BYTES = 600_000;
const MEDIA_TIMEOUT_MS = 6_000;

function extensionType(name: string) {
  const extension = name.match(/\.(mp4|mov|m4v|webm)$/i)?.[1].toLowerCase();
  return extension ? extensionTypes[extension] : undefined;
}

export function isVideoAttachment(file: File) {
  return file.type.startsWith("video/") || !!extensionType(file.name);
}

function decodeError() {
  return new Error("This browser couldn’t read frames from the video. Export it as H.264 MP4 or attach still images from the clip.");
}

function waitForVideo(
  video: HTMLVideoElement,
  events: readonly string[],
  ready: () => boolean,
  signal?: AbortSignal,
  start?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    function finish(error?: unknown) {
      clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, onReady);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error !== undefined) reject(error);
      else resolve();
    }
    const onReady = () => { if (ready()) finish(); };
    const onError = () => finish(decodeError());
    const onAbort = () => finish(signal?.reason ?? new DOMException("Video sampling cancelled", "AbortError"));
    const timer = setTimeout(onError, MEDIA_TIMEOUT_MS);
    for (const event of events) video.addEventListener(event, onReady);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (video.error) onError();
      else if (start) start();
      else onReady();
    } catch {
      onError();
    }
  });
}

async function readDuration(video: HTMLVideoElement, signal?: AbortSignal) {
  if (video.duration === Infinity) {
    // Some WebM recorders omit duration metadata. A seek beyond the end of
    // the local file lets the browser find its real duration.
    await waitForVideo(video, ["durationchange", "seeked", "timeupdate"],
      () => Number.isFinite(video.duration), signal, () => { video.currentTime = 1e9; });
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) throw decodeError();
  if (video.duration > MAX_VIDEO_DURATION_SECONDS) throw new Error("Trim the video to 24 hours or less before attaching it.");
  return video.duration;
}

async function seekToFrame(video: HTMLVideoElement, seconds: number, signal?: AbortSignal) {
  if (video.seeking || Math.abs(video.currentTime - seconds) > 0.001) {
    await waitForVideo(video, ["seeked"], () => !video.seeking, signal,
      () => { video.currentTime = seconds; });
  }
  await waitForVideo(video, ["loadeddata", "canplay"], () => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA, signal);
}

function timestampLabel(seconds: number) {
  const total = Math.floor(seconds * 1000);
  const minute = String(Math.floor(total / 60_000)).padStart(2, "0");
  const second = String(Math.floor(total / 1000) % 60).padStart(2, "0");
  const millisecond = String(total % 1000).padStart(3, "0");
  return `${minute}:${second}.${millisecond}`;
}

function encodeJpeg(canvas: HTMLCanvasElement) {
  const prefix = "data:image/jpeg;base64,";
  for (const quality of [0.78, 0.64, 0.48]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (!url.startsWith(prefix)) break;
    const data = url.slice(prefix.length);
    if (data.length * 3 / 4 <= MAX_JPEG_BYTES) return data;
  }
  throw new Error("The sampled frames could not fit in an attachment. Try a smaller H.264 MP4 clip.");
}

export async function sampleVideoAttachment(file: File, signal?: AbortSignal): Promise<Attachment> {
  signal?.throwIfAborted();
  if (!isVideoAttachment(file) || !file.size) throw new Error("Choose a nonempty MP4, MOV, M4V, or WebM video.");
  if (file.size > MAX_VIDEO_BYTES) throw new Error("Choose a video under 200 MB or trim it before attaching it.");

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  Object.assign(video.style, { position: "fixed", left: "-10000px", top: "0", width: "1px", height: "1px" });
  const inferredType = extensionType(file.name);
  const source = !file.type.startsWith("video/") && inferredType ? file.slice(0, file.size, inferredType) : file;
  const url = URL.createObjectURL(source);

  try {
    document.body.append(video);
    await waitForVideo(video, ["loadedmetadata"], () => video.readyState >= HTMLMediaElement.HAVE_METADATA,
      signal, () => { video.src = url; });
    if (!video.videoWidth || !video.videoHeight) throw decodeError();
    const durationSeconds = await readDuration(video, signal);
    const count = Math.min(4, Math.ceil(durationSeconds * 4));
    const timestampsSeconds = Array.from({ length: count }, (_, index) => durationSeconds * ((index + 0.5) / count));
    const scale = Math.min(1, 720 / video.videoWidth, 480 / video.videoHeight);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const tileWidth = Math.max(220, width) + 16;
    const imageHeight = Math.max(72, height);
    const tileHeight = imageHeight + 44;
    const columns = Math.min(2, count);
    const canvas = document.createElement("canvas");
    canvas.width = columns * tileWidth;
    canvas.height = Math.ceil(count / columns) * tileHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Your browser could not prepare the video contact sheet.");
    context.fillStyle = "#151820";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = "600 16px system-ui, sans-serif";
    context.textBaseline = "middle";

    for (const [index, timestamp] of timestampsSeconds.entries()) {
      await seekToFrame(video, timestamp, signal);
      signal?.throwIfAborted();
      const column = (index % columns) * tileWidth;
      const row = Math.floor(index / columns) * tileHeight;
      try {
        context.drawImage(video, column + (tileWidth - width) / 2, row + 8 + (imageHeight - height) / 2, width, height);
      } catch {
        throw decodeError();
      }
      context.fillStyle = "#f5f7fa";
      context.fillText(`Frame ${index + 1} · ${timestampLabel(timestamp)}`, column + 12, row + imageHeight + 26, tileWidth - 24);
    }

    return {
      type: "image",
      mimeType: "image/jpeg",
      name: file.name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim().slice(0, 200) || "Video",
      data: encodeJpeg(canvas),
      video: { durationSeconds, timestampsSeconds },
    };
  } finally {
    try {
      video.removeAttribute("src");
      video.load();
    } finally {
      video.remove();
      URL.revokeObjectURL(url);
    }
  }
}
