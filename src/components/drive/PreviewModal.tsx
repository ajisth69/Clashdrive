import { useState, useRef, useEffect, useCallback } from "react";
import type { DriveFile } from "../../types";
import { formatBytes } from "../../lib/manifest";
import { FileIcon } from "./FileIcon";

type SheetCell = string | number | boolean | Date | null | undefined;
type SheetRow = SheetCell[];

interface XlsxWorkbook {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}

interface XlsxApi {
  read(data: Uint8Array, options: { type: "array" }): XlsxWorkbook;
  utils: {
    sheet_to_json(sheet: unknown, options: { header: 1; defval: string }): SheetRow[];
  };
}

interface DocxPreviewApi {
  renderAsync(
    blob: Blob,
    container: HTMLElement,
    styleContainer: HTMLElement | null,
    options: {
      className: string;
      inWrapper: boolean;
      ignoreWidth: boolean;
      ignoreHeight: boolean;
    }
  ): Promise<void>;
}

declare global {
  interface Window {
    XLSX?: XlsxApi;
    docx?: DocxPreviewApi;
    ePub?: any;
  }
}

class BiquadFilter {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
  x1 = 0; x2 = 0;
  y1 = 0; y2 = 0;

  constructor(cutoff: number, sampleRate: number) {
    const ff = Math.min(0.45, cutoff / sampleRate);
    const ita = 1.0 / Math.tan(Math.PI * ff);
    const q = Math.sqrt(2.0);
    const den = 1.0 + q * ita + ita * ita;
    this.b0 = 1.0 / den;
    this.b1 = 2.0 / den;
    this.b2 = 1.0 / den;
    this.a1 = 2.0 * (1.0 - ita * ita) / den;
    this.a2 = (1.0 - q * ita + ita * ita) / den;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function decodeDsfToWav(arrayBuffer: ArrayBuffer): Blob | null {
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0, true) !== 0x20445344) { // "DSD "
    return null;
  }
  
  let offset = 28;
  let sampleRate = 2822400;
  let channels = 2;
  let blockSize = 4096;
  let dataOffset = 0;
  let dataSize = 0;
  
  while (offset < arrayBuffer.byteLength - 12) {
    const chunkHeader = view.getUint32(offset, true);
    const chunkSize = Number(view.getBigUint64(offset + 4, true));
    
    if (chunkHeader === 0x20746d66) { // "fmt "
      channels = view.getUint32(offset + 24, true);
      sampleRate = view.getUint32(offset + 28, true);
      if (chunkSize >= 48) {
        blockSize = view.getUint32(offset + 44, true);
      }
    } else if (chunkHeader === 0x61746164) { // "data"
      dataOffset = offset + 12;
      dataSize = chunkSize - 12;
      break;
    }
    offset += chunkSize;
  }
  
  if (dataOffset === 0 || dataSize === 0) return null;
  
  const dsdData = new Uint8Array(arrayBuffer, dataOffset, dataSize);
  const groupSize = blockSize * channels;
  const numGroups = Math.floor(dataSize / groupSize);
  
  const samplesPerChannelPerGroup = blockSize / 8;
  const numOutputSamples = numGroups * samplesPerChannelPerGroup;
  
  const pcmData = new Float32Array(numOutputSamples * channels);
  const wavSampleRate = sampleRate / 64;
  
  const lpFilters = Array.from({ length: channels }, () => new BiquadFilter(16000, wavSampleRate));

  let pcmIdx = 0;
  for (let g = 0; g < numGroups; g++) {
    const groupStart = g * groupSize;
    for (let s = 0; s < samplesPerChannelPerGroup; s++) {
      for (let c = 0; c < channels; c++) {
        const channelByteOffset = groupStart + (c * blockSize) + (s * 8);
        let onesCount = 0;
        for (let b = 0; b < 8; b++) {
          let temp = dsdData[channelByteOffset + b];
          while (temp > 0) {
            onesCount += temp & 1;
            temp >>= 1;
          }
        }
        const pcmVal = (onesCount / 32) - 1.0;
        pcmData[pcmIdx + c] = lpFilters[c].process(pcmVal);
      }
      pcmIdx += channels;
    }
  }
  
  const wavHeader = new ArrayBuffer(44);
  const wavView = new DataView(wavHeader);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  const wavByteRate = wavSampleRate * channels * 2;
  const wavBlockAlign = channels * 2;

  writeString(wavView, 0, 'RIFF');
  wavView.setUint32(4, 36 + numOutputSamples * channels * 2, true);
  writeString(wavView, 8, 'WAVE');
  writeString(wavView, 12, 'fmt ');
  wavView.setUint32(16, 16, true);
  wavView.setUint16(20, 1, true);
  wavView.setUint16(22, channels, true);
  wavView.setUint32(24, wavSampleRate, true);
  wavView.setUint32(28, wavByteRate, true);
  wavView.setUint16(32, wavBlockAlign, true);
  wavView.setUint16(34, 16, true);
  writeString(wavView, 36, 'data');
  wavView.setUint32(40, numOutputSamples * channels * 2, true);
  
  const outputBuffer = new Uint8Array(wavHeader.byteLength + numOutputSamples * channels * 2);
  outputBuffer.set(new Uint8Array(wavHeader), 0);
  
  const outView = new DataView(outputBuffer.buffer);
  let outOffset = 44;
  for (let i = 0; i < pcmData.length; i++) {
    const pcmSample = Math.max(-32768, Math.min(32767, pcmData[i] * 32767));
    outView.setInt16(outOffset, pcmSample, true);
    outOffset += 2;
  }
  
  return new Blob([outputBuffer], { type: "audio/wav" });
}

interface PreviewModalProps {
  file: DriveFile;
  url: string | null;
  progress?: number | null;
  error?: string | null;
  onDownload?: () => void | Promise<void>;
  onClose: () => void;
  isLiked?: boolean;
  onToggleLike?: () => void;
  onOpenMoveCopy?: () => void;
}

/* ═══════════════════════════════════════════════════════════
   UTILITY HELPERS
   ═══════════════════════════════════════════════════════════ */

function formatTime(time: number) {
  if (isNaN(time) || !isFinite(time)) return "0:00";
  const hrs = Math.floor(time / 3600);
  const mins = Math.floor((time % 3600) / 60);
  const secs = Math.floor(time % 60);
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export function PreviewModal({
  file,
  url,
  progress,
  error,
  onDownload,
  onClose,
  isLiked = false,
  onToggleLike,
  onOpenMoveCopy,
}: PreviewModalProps) {
  // ─── Core modal state ───
  const [closing, setClosing] = useState(false);

  // ─── Image state ───
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [rotation, setRotation] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);

  // ─── Video state ───
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoBuffered, setVideoBuffered] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [videoVolume, setVideoVolume] = useState(1);
  const [videoMuted, setVideoMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [seekTooltip, setSeekTooltip] = useState<{ x: number; time: string } | null>(null);

  // ─── Audio state ───
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(1);
  const [audioSpeed, setAudioSpeed] = useState(1);

  // ─── Text preview state ───
  const [textContent, setTextContent] = useState<string | null>(null);

  // ─── Excel / Spreadsheet state ───
  const [sheetData, setSheetData] = useState<SheetRow[] | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [workbookRef, setWorkbookRef] = useState<XlsxWorkbook | null>(null);

  // ─── Word docx state ───
  const [loadingDocx, setLoadingDocx] = useState(false);
  const docxContainerRef = useRef<HTMLDivElement | null>(null);

  // ─── DSD state ───
  const [dsdDecodedUrl, setDsdDecodedUrl] = useState<string | null>(null);
  const [dsdLoading, setDsdLoading] = useState(false);
  const [dsdError, setDsdError] = useState<string | null>(null);

  // ─── Audio visualizer refs ───
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // ─── EPUB state ───
  const [loadingEpub, setLoadingEpub] = useState(false);
  const [epubError, setEpubError] = useState<string | null>(null);
  const epubContainerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<any>(null);

  // ─── File info popover ───
  const [showFileInfo, setShowFileInfo] = useState(false);

  /* ═══════════════════════════════════════════════════════
     FILE TYPE DETECTION
     ═══════════════════════════════════════════════════════ */

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const mimeType = file.mimeType || "";

  const isImage = mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
  const isVideo = mimeType.startsWith("video/") || ["mp4", "webm", "ogg", "mov", "mkv", "avi", "3gp", "flv"].includes(ext);
  const isAudio = mimeType.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac", "dsf", "dff", "opus", "oga", "caf", "aac"].includes(ext);
  const isText = ["txt", "md", "json", "js", "ts", "py", "rs", "go", "html", "css", "xml"].includes(ext);
  const isPdf = mimeType === "application/pdf" || ext === "pdf";
  const isDocx = ext === "docx";
  const isSheet = ["xlsx", "xls", "csv"].includes(ext);
  const isEpub = ext === "epub";
  const isDsdFile = ["dsf", "dff"].includes(ext);
  const isDsd = false; // Decoded on-the-fly inside the streaming pipeline

  /* ═══════════════════════════════════════════════════════
     CLOSE HANDLER
     ═══════════════════════════════════════════════════════ */

  const handleClose = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
    if (videoRef.current) videoRef.current.pause();
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
    }
    setClosing(true);
    setTimeout(onClose, 280);
  }, [onClose]);

  /* ═══════════════════════════════════════════════════════
     ESCAPE KEY & KEYBOARD SHORTCUTS
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if focus is inside an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case "Escape":
          handleClose();
          break;
        case " ":
        case "k":
          e.preventDefault();
          if (isVideo) toggleVideoPlay();
          if (isAudio) toggleAudioPlay();
          break;
        case "f":
          if (isVideo) toggleFullscreen();
          break;
        case "m":
          if (isVideo) setVideoMuted((m) => !m);
          break;
        case "ArrowLeft":
          if (isVideo && videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
          if (isAudio && audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15);
          break;
        case "ArrowRight":
          if (isVideo && videoRef.current) videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 10);
          if (isAudio && audioRef.current) audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 15);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (isVideo) setVideoVolume((v) => clamp(v + 0.1, 0, 1));
          if (isAudio) setAudioVolume((v) => clamp(v + 0.1, 0, 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          if (isVideo) setVideoVolume((v) => clamp(v - 0.1, 0, 1));
          if (isAudio) setAudioVolume((v) => clamp(v - 0.1, 0, 1));
          break;
        case "+":
        case "=":
          if (isImage) setZoom((z) => clamp(z + 0.25, 0.25, 5));
          break;
        case "-":
          if (isImage) setZoom((z) => clamp(z - 0.25, 0.25, 5));
          break;
        case "0":
          if (isImage) { setZoom(1); setPanOffset({ x: 0, y: 0 }); }
          break;
        case "r":
          if (isImage) setRotation((r) => (r + 90) % 360);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleClose, isVideo, isAudio, isImage]);

  // Lock body scroll and cleanup audio context / timers
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      if (controlsTimer.current) {
        clearTimeout(controlsTimer.current);
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        try {
          audioCtxRef.current.close();
        } catch {}
        audioCtxRef.current = null;
      }
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, [file.id, url]);

  // Concentric Circles Audio Visualizer Loop
  useEffect(() => {
    if (!isAudio) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let phase = 0;
    let scale = 1.0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w = canvas.width / window.devicePixelRatio;
      const h = canvas.height / window.devicePixelRatio;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;

      if (audioPlaying) {
        phase += 0.04;
        scale = scale * 0.95 + 1.15 * 0.05;
      } else {
        phase += 0.005;
        scale = scale * 0.95 + 1.0 * 0.05;
      }

      // Draw glowing waves concentric layers
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const radius = (w * 0.3) + i * 14 * scale;
        const opacity = (0.16 - i * 0.045) * (audioPlaying ? 1.4 : 0.6);
        
        ctx.strokeStyle = `rgba(6, 182, 212, ${opacity})`;
        ctx.lineWidth = i === 0 ? 3 : 1.5;
        
        const points = 72;
        for (let p = 0; p <= points; p++) {
          const angle = (p / points) * Math.PI * 2;
          const waveAmp = audioPlaying 
            ? (5 + Math.sin(angle * 7 + phase * 2.2) * 4) 
            : Math.sin(angle * 4 + phase) * 0.5;
          const r = radius + waveAmp;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (p === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
    };
  }, [isAudio, audioPlaying]);

  /* ═══════════════════════════════════════════════════════
     IMAGE: ZOOM & PAN
     ═══════════════════════════════════════════════════════ */

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!isImage) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom((z) => {
      const next = clamp(z + delta, 0.25, 5);
      if (next <= 1) setPanOffset({ x: 0, y: 0 });
      return next;
    });
  }, [isImage]);

  const handleImageDoubleClick = useCallback(() => {
    if (zoom > 1) {
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    } else {
      setZoom(2.5);
    }
  }, [zoom]);

  const handlePanStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsPanning(true);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    panStart.current = { x: clientX, y: clientY, ox: panOffset.x, oy: panOffset.y };
  }, [zoom, panOffset]);

  const handlePanMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isPanning) return;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const dx = clientX - panStart.current.x;
    const dy = clientY - panStart.current.y;
    setPanOffset({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
  }, [isPanning]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  /* ═══════════════════════════════════════════════════════
     VIDEO: CUSTOM PLAYER
     ═══════════════════════════════════════════════════════ */

  const toggleVideoPlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(console.error);
    } else {
      videoRef.current.pause();
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = videoContainerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen().catch(console.error);
    }
  }, []);

  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.error("PiP error:", err);
    }
  }, []);

  // Sync volume to video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = videoVolume;
      videoRef.current.muted = videoMuted;
    }
  }, [videoVolume, videoMuted]);

  // Sync playback speed
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  // Sync audio volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = audioVolume;
  }, [audioVolume]);

  // Sync audio playback speed
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = audioSpeed;
  }, [audioSpeed]);

  // Auto-hide video controls
  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false);
      }
    }, 3000);
  }, []);

  // Fullscreen change listener
  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // Video event handlers
  const onVideoTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setVideoTime(v.currentTime);
    if (v.buffered.length > 0) {
      setVideoBuffered(v.buffered.end(v.buffered.length - 1));
    }
  }, []);

  const handleVideoSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const time = parseFloat(e.target.value);
    videoRef.current.currentTime = time;
    setVideoTime(time);
  }, []);

  const handleSeekTooltip = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const time = ratio * (videoDuration || 0);
    setSeekTooltip({ x: e.clientX - rect.left, time: formatTime(time) });
  }, [videoDuration]);

  /* ═══════════════════════════════════════════════════════
     AUDIO CONTROLS
     ═══════════════════════════════════════════════════════ */

  const toggleAudioPlay = useCallback(() => {
    if (!audioRef.current) return;

    if (!audioCtxRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        
        const source = ctx.createMediaElementSource(audioRef.current);
        source.connect(analyser);
        analyser.connect(ctx.destination);
        
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        sourceRef.current = source;
      } catch (err) {
        console.warn("Web Audio API not supported:", err);
      }
    }

    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }

    if (audioPlaying) {
      audioRef.current.pause();
      setAudioPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setAudioPlaying(true);
    }
  }, [audioPlaying]);

  /* ═══════════════════════════════════════════════════════
     TEXT PREVIEW LOADER
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!isText || !url) return;
    const controller = new AbortController();
    fetch(url, { headers: { Range: "bytes=0-131071" }, signal: controller.signal })
      .then((r) => {
        if (!r.ok && r.status !== 206) throw new Error(`Text preview failed with status ${r.status}`);
        return r.text();
      })
      .then((txt) => setTextContent(txt.slice(0, 50000)))
      .catch((e) => {
        if (!controller.signal.aborted) {
          console.error("Text fetch error:", e);
          setTextContent("Unable to load text preview.");
        }
      });
    return () => controller.abort();
  }, [isText, url, file.id]);

  /* ═══════════════════════════════════════════════════════
     DYNAMIC SCRIPT HELPER
     ═══════════════════════════════════════════════════════ */

  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  }

  /* ═══════════════════════════════════════════════════════
     EXCEL / SPREADSHEET LOADER
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!isSheet || !url) return;
    let cancelled = false;
    const controller = new AbortController();
    loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js")
      .then(() => fetch(url, { signal: controller.signal }))
      .then((r) => r.arrayBuffer())
      .then((buffer) => {
        if (cancelled) return;
        const XLSX = window.XLSX;
        if (!XLSX) throw new Error("Spreadsheet parser did not load");
        const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
        setWorkbookRef(workbook);
        setSheetNames(workbook.SheetNames);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        setSheetData(jsonData);
      })
      .catch((e) => { if (!cancelled) console.error("Spreadsheet load/parse error:", e); });
    return () => { cancelled = true; controller.abort(); };
  }, [isSheet, url, file.id]);

  const handleSheetSwitch = (index: number) => {
    if (!workbookRef) return;
    setActiveSheetIndex(index);
    const XLSX = window.XLSX;
    if (!XLSX) return;
    const sheetName = workbookRef.SheetNames[index];
    const worksheet = workbookRef.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    setSheetData(jsonData);
  };

  /* ═══════════════════════════════════════════════════════
     WORD (.DOCX) LOADER
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!isDocx || !url || !docxContainerRef.current) return;
    let cancelled = false;
    const controller = new AbortController();
    const container = docxContainerRef.current;
    setLoadingDocx(true);
    loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js")
      .then(() => loadScript("https://cdn.jsdelivr.net/npm/docx-preview@0.1.15/dist/docx-preview.min.js"))
      .then(() => fetch(url, { signal: controller.signal }))
      .then((r) => r.blob())
      .then((blob) => {
        if (cancelled || !container) return;
        const docx = window.docx;
        if (!docx) throw new Error("DOCX renderer did not load");
        container.innerHTML = "";
        return docx.renderAsync(blob, container, null, {
          className: "docx-preview-body",
          inWrapper: false,
          ignoreWidth: true,
          ignoreHeight: true,
        });
      })
      .catch((e) => { if (!cancelled) console.error("Docx load/render error:", e); })
      .finally(() => { if (!cancelled) setLoadingDocx(false); });
    return () => { cancelled = true; controller.abort(); if (container) container.innerHTML = ""; };
  }, [isDocx, url, file.id]);

  /* ═══════════════════════════════════════════════════════
     DSD DECODER HOOK
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!isDsd || !url) return;
    let cancelled = false;
    setDsdLoading(true);
    setDsdError(null);
    
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch DSD file");
        return r.arrayBuffer();
      })
      .then((buffer) => {
        if (cancelled) return;
        const blob = decodeDsfToWav(buffer);
        if (!blob) throw new Error("Failed to decode DSD file layout (DSF supported only)");
        const blobUrl = URL.createObjectURL(blob);
        setDsdDecodedUrl(blobUrl);
        setDsdLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("DSD decode error:", err);
        setDsdError(err.message || "Failed to decode DSD audio.");
        setDsdLoading(false);
      });
      
    return () => {
      cancelled = true;
      setDsdDecodedUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [isDsd, url]);

  /* ═══════════════════════════════════════════════════════
     AUDIO VISUALIZER RENDERING LOOP
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    let animationId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const resizeCanvas = () => {
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    
    const bufferLength = analyserRef.current ? analyserRef.current.frequencyBinCount : 0;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      animationId = requestAnimationFrame(draw);
      
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      
      ctx.fillStyle = "rgba(18, 18, 24, 0.18)";
      ctx.fillRect(0, 0, width, height);
      
      if (analyserRef.current && audioPlaying) {
        analyserRef.current.getByteFrequencyData(dataArray);
        
        const centerX = width / 2;
        const centerY = height / 2;
        const baseRadius = Math.min(width, height) * 0.28;
        
        ctx.shadowBlur = 18;
        ctx.shadowColor = "rgba(96, 165, 250, 0.4)";
        
        ctx.beginPath();
        for (let i = 0; i < bufferLength; i++) {
          const angle = (i / bufferLength) * Math.PI * 2;
          const value = dataArray[i] / 255;
          const radius = baseRadius + value * 22;
          
          const x = centerX + Math.cos(angle) * radius;
          const y = centerY + Math.sin(angle) * radius;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        
        const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius, centerX, centerY, baseRadius + 22);
        gradient.addColorStop(0, "#60a5fa");
        gradient.addColorStop(1, "#a78bfa");
        
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        
        ctx.shadowBlur = 4;
        ctx.beginPath();
        for (let i = 0; i < bufferLength; i++) {
          const angle = (i / bufferLength) * Math.PI * 2;
          const value = dataArray[bufferLength - 1 - i] / 255;
          const radius = baseRadius - 6 - value * 10;
          
          const x = centerX + Math.cos(angle) * radius;
          const y = centerY + Math.sin(angle) * radius;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.strokeStyle = "rgba(167, 139, 250, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        ctx.shadowBlur = 0;
      } else {
        const centerX = width / 2;
        const centerY = height / 2;
        const baseRadius = Math.min(width, height) * 0.28;
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };
    
    draw();
    
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [audioPlaying]);

  /* ═══════════════════════════════════════════════════════
     EPUB EBOOK LOADER
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!isEpub || !url || !epubContainerRef.current) return;
    let cancelled = false;
    const controller = new AbortController();
    const container = epubContainerRef.current;
    setLoadingEpub(true);
    setEpubError(null);
    
    loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js")
      .then(() => loadScript("https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.88/epub.min.js"))
      .then(() => fetch(url, { signal: controller.signal }))
      .then((r) => r.arrayBuffer())
      .then((buffer) => {
        if (cancelled || !container) return;
        const ePub = window.ePub;
        if (!ePub) throw new Error("EPUB reader library did not load");
        
        container.innerHTML = "";
        const book = ePub(buffer);
        const rendition = book.renderTo(container, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          stylesheet: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700&display=swap"
        });
        
        renditionRef.current = rendition;
        
        rendition.themes.default({
          body: {
            background: "transparent !important",
            color: "#e2e8f0 !important",
            "font-family": "'Outfit', sans-serif !important",
            "line-height": "1.75 !important",
            "font-size": "16px !important",
            padding: "0 20px !important"
          },
          p: {
            "margin-bottom": "1rem !important"
          },
          h1: {
            color: "#ffffff !important",
            "font-weight": "700 !important"
          },
          h2: {
            color: "#ffffff !important",
            "font-weight": "600 !important"
          }
        });
        
        return rendition.display();
      })
      .then(() => {
        if (!cancelled) {
          setLoadingEpub(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("EPUB render error:", err);
          setEpubError(err.message || "Failed to render EPUB.");
          setLoadingEpub(false);
        }
      });
      
    return () => {
      cancelled = true;
      controller.abort();
      if (renditionRef.current) {
        try {
          renditionRef.current.destroy();
        } catch {}
      }
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [isEpub, url]);

  /* ═══════════════════════════════════════════════════════
     LOADING FLAGS
     ═══════════════════════════════════════════════════════ */

  const isTextLoading = isText && Boolean(url) && textContent === null;
  const isSheetLoading = isSheet && Boolean(url) && sheetData === null && sheetNames.length === 0;

  /* ═══════════════════════════════════════════════════════
     FILE DATE HELPER
     ═══════════════════════════════════════════════════════ */

  const fileDate = new Date(file.date * 1000);
  const fileDateStr = fileDate.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  /* ═══════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════ */

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-none`}
      onMouseUp={handlePanEnd}
      onTouchEnd={handlePanEnd}
    >
      {/* ─── Backdrop ─── */}
      <div
        className={`absolute inset-0 preview-overlay ${closing ? "animate-backdrop-exit" : "animate-backdrop-enter"}`}
        onClick={handleClose}
      />

      {/* ─── Modal Container ─── */}
      <div
        className={`relative w-full h-full sm:w-[calc(100%-1.5rem)] sm:h-[calc(100%-1.5rem)] sm:max-w-[1440px] sm:max-h-[960px] bg-[#0a0a0a] sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col ${closing ? "animate-preview-exit" : "animate-preview-enter"}`}
      >

        {/* ═══════════════════════════════════════════════
            HEADER BAR
            ═══════════════════════════════════════════════ */}
        <div className="relative z-30 shrink-0 h-14 sm:h-[3.5rem] px-3 sm:px-4 flex items-center gap-3 bg-[#0a0a0a]/95 border-b border-white/[0.06] select-none backdrop-blur-md">
          {/* Back button */}
          <button
            onClick={handleClose}
            className="w-9 h-9 shrink-0 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center transition-all duration-200 active:scale-90 cursor-pointer group"
            title="Close (Esc)"
          >
            <svg className="w-[18px] h-[18px] text-white/80 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* File icon + name */}
          <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
            <FileIcon fileName={file.name} className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-white/95 truncate text-[13px] sm:text-sm leading-tight">{file.name}</h3>
            <p className="text-[10px] text-white/40 font-medium mt-0.5 leading-none">
              {formatBytes(file.size)} • {fileDateStr}
              {file.uploaderName && <span> • {file.uploaderName}</span>}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* File info toggle */}
            <button
              onClick={() => setShowFileInfo(!showFileInfo)}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer ${showFileInfo ? "bg-brand-500/25 text-brand-400" : "bg-white/[0.08] hover:bg-white/[0.15] text-white/60 hover:text-white/90"}`}
              title="File Info"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>

            {/* Star Favorite Toggle */}
            {onToggleLike && (
              <button
                onClick={onToggleLike}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer ${
                  isLiked 
                    ? "bg-yellow-500/25 text-yellow-400" 
                    : "bg-white/[0.08] hover:bg-white/[0.15] text-white/60 hover:text-white/90"
                }`}
                title={isLiked ? "Remove from Favourites" : "Add to Favourites"}
              >
                <svg className="w-4 h-4" fill={isLiked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isLiked ? 0 : 2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </button>
            )}

            {/* Move / Copy */}
            {onOpenMoveCopy && (
              <button
                onClick={onOpenMoveCopy}
                className="w-9 h-9 rounded-full bg-white/[0.08] hover:bg-brand-500/25 text-white/60 hover:text-brand-400 flex items-center justify-center transition-all duration-200 cursor-pointer"
                title="Move or Copy File"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>
            )}

            {/* Download */}
            {onDownload && (
              <button
                onClick={onDownload}
                className="w-9 h-9 rounded-full bg-white/[0.08] hover:bg-brand-500/25 text-white/60 hover:text-brand-400 flex items-center justify-center transition-all duration-200 cursor-pointer"
                title="Download"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            )}

            {/* Close */}
            <button
              onClick={handleClose}
              className="w-9 h-9 rounded-full bg-white/[0.08] hover:bg-red-500/25 text-white/60 hover:text-red-400 flex items-center justify-center transition-all duration-200 cursor-pointer"
              title="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ─── File Info Popover ─── */}
        {showFileInfo && (
          <div className="absolute right-4 top-16 z-40 bg-[#1a1a1e] border border-white/10 rounded-xl p-4 w-64 shadow-2xl animate-spring-in text-left space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold">File Details</p>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-white/50">Name</span><span className="text-white/90 font-medium truncate ml-3 text-right max-w-[140px]">{file.name}</span></div>
              <div className="flex justify-between"><span className="text-white/50">Size</span><span className="text-white/90 font-medium">{formatBytes(file.size)}</span></div>
              <div className="flex justify-between"><span className="text-white/50">Date</span><span className="text-white/90 font-medium">{fileDateStr}</span></div>
              <div className="flex justify-between"><span className="text-white/50">Extension</span><span className="text-white/90 font-medium">.{ext}</span></div>
              {file.mimeType && <div className="flex justify-between"><span className="text-white/50">MIME</span><span className="text-white/90 font-medium truncate ml-3 text-right max-w-[140px]">{file.mimeType}</span></div>}
              {file.uploaderName && <div className="flex justify-between"><span className="text-white/50">Uploader</span><span className="text-white/90 font-medium">{file.uploaderName}</span></div>}
              <div className="flex justify-between"><span className="text-white/50">ID</span><span className="text-white/90 font-mono text-[10px]">{file.id}</span></div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════
            CONTENT AREA
            ═══════════════════════════════════════════════ */}
        <div className="relative flex-1 min-h-0 overflow-hidden bg-black">
          {!url ? (
            /* ─── Loading / Error State ─── */
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-full max-w-sm p-8 text-center space-y-6">
                {error ? (
                  <>
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-white/[0.06] flex items-center justify-center">
                      <svg className="w-8 h-8 text-red-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-white font-semibold text-base">Preview unavailable</p>
                      <p className="text-sm text-white/40 leading-relaxed">{error}</p>
                    </div>
                    {onDownload && (
                      <button
                        onClick={onDownload}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 transition-colors active:scale-95"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download Instead
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {/* Gradient ring progress */}
                    <div className="relative w-20 h-20 mx-auto">
                      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="35" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                        <circle
                          cx="40" cy="40" r="35" fill="none"
                          stroke="url(#progressGrad)" strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * 35}`}
                          strokeDashoffset={`${2 * Math.PI * 35 * (1 - (progress ?? 0) / 100)}`}
                          className="transition-all duration-500 ease-out"
                        />
                        <defs>
                          <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#6366f1" />
                            <stop offset="100%" stopColor="#06b6d4" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-white font-bold text-sm tabular-nums">
                          {progress !== undefined && progress !== null ? `${progress}%` : "0%"}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-white font-semibold text-base">Preparing preview</p>
                      <p className="text-sm text-white/35">
                        {progress !== undefined && progress !== null && progress > 0
                          ? `Downloading... ${progress}%`
                          : "Connecting to Telegram..."}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center overflow-hidden relative">

              {/* ══════════════════════════════════════════
                  IMAGE PREVIEW
                  ══════════════════════════════════════════ */}
              {isImage && (
                <div
                  className={`relative w-full h-full flex items-center justify-center overflow-hidden ${zoom > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"}`}
                  onWheel={handleWheel}
                  onDoubleClick={handleImageDoubleClick}
                  onMouseDown={handlePanStart}
                  onMouseMove={handlePanMove}
                  onTouchStart={handlePanStart}
                  onTouchMove={handlePanMove}
                >
                  {/* Image loading skeleton */}
                  {!imageLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-48 h-48 rounded-2xl bg-white/[0.04] animate-pulse" />
                    </div>
                  )}
                  <img
                    src={url}
                    alt={file.name}
                    loading="eager"
                    decoding="async"
                    onLoad={() => setImageLoaded(true)}
                    className="max-w-full max-h-full object-contain select-none"
                    style={{
                      transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                      transition: isPanning ? "none" : "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                      opacity: imageLoaded ? 1 : 0,
                    }}
                    draggable={false}
                  />

                  {/* Floating image toolbar */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/70 backdrop-blur-md rounded-full px-2 py-1.5 shadow-2xl border border-white/[0.08]">
                    <button onClick={() => setZoom((z) => clamp(z - 0.25, 0.25, 5))} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer" title="Zoom Out (-)">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" /></svg>
                    </button>
                    <span className="text-[11px] font-semibold text-white/70 tabular-nums w-12 text-center select-none">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button onClick={() => setZoom((z) => clamp(z + 0.25, 0.25, 5))} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer" title="Zoom In (+)">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                    </button>
                    <div className="w-px h-5 bg-white/10 mx-0.5" />
                    <button onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer" title="Fit (0)">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                    </button>
                    <button onClick={() => setRotation((r) => (r + 90) % 360)} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer" title="Rotate (R)">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3m0 0l3 3m-3-3v8" /></svg>
                    </button>
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════
                  VIDEO PLAYER — CUSTOM CONTROLS
                  ══════════════════════════════════════════ */}
              {isVideo && (
                <div
                  ref={videoContainerRef}
                  className="relative w-full h-full flex items-center justify-center bg-black group/video"
                  onMouseMove={resetControlsTimer}
                  onClick={(e) => {
                    if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "VIDEO") {
                      toggleVideoPlay();
                      resetControlsTimer();
                    }
                  }}
                >
                  <video
                    ref={videoRef}
                    src={url}
                    autoPlay
                    playsInline
                    preload="auto"
                    crossOrigin="anonymous"
                    onPlay={() => { setVideoPlaying(true); resetControlsTimer(); }}
                    onPause={() => { setVideoPlaying(false); setControlsVisible(true); }}
                    onTimeUpdate={onVideoTimeUpdate}
                    onLoadedMetadata={() => { if (videoRef.current) setVideoDuration(videoRef.current.duration); }}
                    onSeeking={() => setBuffering(true)}
                    onSeeked={() => setBuffering(false)}
                    onWaiting={() => setBuffering(true)}
                    onPlaying={() => setBuffering(false)}
                    className="max-w-full max-h-full object-contain"
                  />

                  {/* Big center play/pause button */}
                  {!videoPlaying && !buffering && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleVideoPlay(); }}
                      className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/25 transition-all animate-spring-in cursor-pointer border border-white/10"
                    >
                      <svg className="w-7 h-7 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </button>
                  )}

                  {/* Buffering spinner */}
                  {buffering && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                        <svg className="animate-spin h-6 w-6 text-white" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={3} className="opacity-20" />
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-80" />
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* ─── Bottom Controls Bar ─── */}
                  <div
                    className={`absolute bottom-0 left-0 right-0 preview-controls-bar px-3 sm:px-4 pb-3 pt-16 transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
                  >
                    {/* Seek bar */}
                    <div className="relative w-full mb-2.5 group/seek">
                      {/* Buffered progress */}
                      <div className="absolute top-1/2 -translate-y-1/2 left-0 h-1 rounded-full bg-white/[0.12]" style={{ width: "100%" }} />
                      <div className="absolute top-1/2 -translate-y-1/2 left-0 h-1 rounded-full bg-white/20 transition-all" style={{ width: `${videoDuration > 0 ? (videoBuffered / videoDuration) * 100 : 0}%` }} />
                      <div className="absolute top-1/2 -translate-y-1/2 left-0 h-1 rounded-full bg-brand-400 transition-all" style={{ width: `${videoDuration > 0 ? (videoTime / videoDuration) * 100 : 0}%` }} />
                      <input
                        type="range"
                        min={0}
                        max={videoDuration || 100}
                        step={0.1}
                        value={videoTime}
                        onChange={handleVideoSeek}
                        onMouseMove={handleSeekTooltip}
                        onMouseLeave={() => setSeekTooltip(null)}
                        className="range-native absolute inset-0 w-full h-4 z-10"
                      />
                      {/* Seek time tooltip */}
                      {seekTooltip && (
                        <div
                          className="absolute -top-8 bg-black/80 text-white text-[10px] font-mono font-bold px-2 py-1 rounded-md pointer-events-none"
                          style={{ left: `${seekTooltip.x}px`, transform: "translateX(-50%)" }}
                        >
                          {seekTooltip.time}
                        </div>
                      )}
                    </div>

                    {/* Controls row */}
                    <div className="flex items-center gap-2 sm:gap-3 select-none">
                      {/* Play/Pause */}
                      <button onClick={(e) => { e.stopPropagation(); toggleVideoPlay(); }} className="w-9 h-9 rounded-full hover:bg-white/10 text-white flex items-center justify-center transition-all cursor-pointer active:scale-90" title={videoPlaying ? "Pause (K)" : "Play (K)"}>
                        {videoPlaying ? (
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                        ) : (
                          <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        )}
                      </button>

                      {/* Skip -10s */}
                      <button onClick={(e) => { e.stopPropagation(); if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10); }} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex flex-col items-center justify-center transition-all cursor-pointer text-[7px] font-bold" title="Rewind 10s (←)">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" /></svg>
                      </button>

                      {/* Skip +10s */}
                      <button onClick={(e) => { e.stopPropagation(); if (videoRef.current) videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 10); }} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex flex-col items-center justify-center transition-all cursor-pointer text-[7px] font-bold" title="Forward 10s (→)">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" /></svg>
                      </button>

                      {/* Time display */}
                      <span className="text-[11px] text-white/60 font-mono tabular-nums select-none">
                        {formatTime(videoTime)} / {formatTime(videoDuration)}
                      </span>

                      <div className="flex-1" />

                      {/* Volume */}
                      <div className="hidden sm:flex items-center gap-1.5 group/vol">
                        <button onClick={(e) => { e.stopPropagation(); setVideoMuted((m) => !m); }} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer" title="Mute (M)">
                          {videoMuted || videoVolume === 0 ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                          )}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={videoMuted ? 0 : videoVolume}
                          onChange={(e) => { e.stopPropagation(); setVideoVolume(parseFloat(e.target.value)); if (videoMuted) setVideoMuted(false); }}
                          onClick={(e) => e.stopPropagation()}
                          className="range-native range-volume w-16 opacity-0 group-hover/vol:opacity-100 transition-opacity duration-200"
                        />
                      </div>

                      {/* Speed */}
                      <div className="relative">
                        <button onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(!showSpeedMenu); }} className="h-7 px-2 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-[11px] font-bold text-white/70 hover:text-white transition-all cursor-pointer" title="Playback Speed">
                          {playbackSpeed}x
                        </button>
                        {showSpeedMenu && (
                          <div className="absolute bottom-full right-0 mb-2 bg-[#1a1a1e] border border-white/10 rounded-xl py-1.5 shadow-2xl animate-spring-in z-50 min-w-[80px]">
                            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                              <button
                                key={speed}
                                onClick={(e) => { e.stopPropagation(); setPlaybackSpeed(speed); setShowSpeedMenu(false); }}
                                className={`w-full px-3 py-1.5 text-left text-xs font-medium transition-colors cursor-pointer ${playbackSpeed === speed ? "text-brand-400 bg-brand-500/10" : "text-white/70 hover:bg-white/[0.06] hover:text-white"}`}
                              >
                                {speed}x{speed === 1 ? " (Normal)" : ""}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* PiP */}
                      {"pictureInPictureEnabled" in document && (
                        <button onClick={(e) => { e.stopPropagation(); togglePiP(); }} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer hidden sm:flex" title="Picture-in-Picture">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="2" y="3" width="20" height="14" rx="2" /><rect x="11" y="9" width="9" height="7" rx="1" fill="currentColor" opacity="0.3" /><rect x="11" y="9" width="9" height="7" rx="1" /></svg>
                        </button>
                      )}

                      {/* Fullscreen */}
                      <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer" title="Fullscreen (F)">
                        {isFullscreen ? (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════
                  AUDIO PLAYER — PREMIUM
                  ══════════════════════════════════════════ */}
              {isAudio && (
                <div className="w-full max-w-md mx-auto p-8 select-none">
                  <div className="bg-[#111115] border border-white/[0.06] rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
                    {isDsd && dsdLoading ? (
                      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                        <svg className="animate-spin h-6 w-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                        </svg>
                        <span className="text-white/40 text-xs font-semibold">Decoding high-resolution DSD stream...</span>
                      </div>
                    ) : isDsd && dsdError ? (
                      <div className="text-center py-12 space-y-3">
                        <svg className="w-10 h-10 mx-auto text-danger/75" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-danger/80 text-xs font-semibold block">{dsdError}</span>
                      </div>
                    ) : (
                      <>
                        {/* Album art placeholder / Visualizer */}
                        <div className="relative w-32 h-32 sm:w-40 sm:h-40 mx-auto overflow-hidden rounded-2xl border border-white/[0.06] shadow-inner bg-slate-900 flex items-center justify-center">
                          <canvas 
                            ref={canvasRef} 
                            className="absolute inset-0 w-full h-full pointer-events-none" 
                          />
                          <div className={`z-10 w-16 h-16 rounded-full bg-black/45 backdrop-blur-md border border-white/10 flex items-center justify-center transition-all ${audioPlaying ? "scale-90 opacity-40 hover:opacity-100" : "scale-100"}`}>
                            <svg className="w-8 h-8 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                            </svg>
                          </div>
                        </div>

                        {/* File name */}
                        <div className="text-center">
                          <h4 className="text-white/90 text-sm font-semibold truncate px-4">{file.name}</h4>
                          <p className="text-white/30 text-[10px] uppercase tracking-wider font-medium mt-1">{formatBytes(file.size)} • {isDsdFile ? "DSD Audio" : "Audio"}</p>
                        </div>

                        <audio
                          ref={audioRef}
                          src={isDsd ? (dsdDecodedUrl || "") : (url || "")}
                          preload="auto"
                          crossOrigin="anonymous"
                          onTimeUpdate={() => { if (audioRef.current) setAudioTime(audioRef.current.currentTime); }}
                          onLoadedMetadata={() => { if (audioRef.current) setAudioDuration(audioRef.current.duration); }}
                          onEnded={() => setAudioPlaying(false)}
                          className="hidden"
                        />
                      </>
                    )}

                    {/* Seek bar */}
                    <div className="space-y-2">
                      <div className="relative h-6 flex items-center">
                        <div className="absolute left-0 right-0 h-1 rounded-full bg-white/[0.08]" />
                        <div className="absolute left-0 h-1 rounded-full bg-brand-400 transition-all duration-100" style={{ width: `${audioDuration > 0 ? (audioTime / audioDuration) * 100 : 0}%` }} />
                        <input
                          type="range"
                          min={0}
                          max={audioDuration || 100}
                          step={0.1}
                          value={audioTime}
                          onChange={(e) => { const t = parseFloat(e.target.value); if (audioRef.current) { audioRef.current.currentTime = t; } setAudioTime(t); }}
                          className="range-native absolute inset-0 w-full"
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-white/30 tabular-nums">
                        <span>{formatTime(audioTime)}</span>
                        <span>{formatTime(audioDuration)}</span>
                      </div>
                    </div>

                    {/* Controls row */}
                    <div className="flex items-center justify-center gap-4">
                      {/* Skip -15s */}
                      <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15); }} className="w-10 h-10 rounded-full bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 flex items-center justify-center transition-all cursor-pointer" title="Rewind 15s">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" /></svg>
                      </button>

                      {/* Play/Pause */}
                      <button
                        onClick={toggleAudioPlay}
                        className="w-14 h-14 rounded-full bg-brand-500 hover:bg-brand-400 text-white flex items-center justify-center shadow-lg shadow-brand-500/25 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                      >
                        {audioPlaying ? (
                          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                        ) : (
                          <svg className="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        )}
                      </button>

                      {/* Skip +15s */}
                      <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 15); }} className="w-10 h-10 rounded-full bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 flex items-center justify-center transition-all cursor-pointer" title="Forward 15s">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" /></svg>
                      </button>
                    </div>

                    {/* Secondary controls */}
                    <div className="flex items-center justify-between px-2">
                      {/* Volume */}
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={audioVolume}
                          onChange={(e) => setAudioVolume(parseFloat(e.target.value))}
                          className="range-native range-volume w-16"
                        />
                      </div>

                      {/* Speed */}
                      <button
                        onClick={() => {
                          const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
                          const idx = speeds.indexOf(audioSpeed);
                          setAudioSpeed(speeds[(idx + 1) % speeds.length]);
                        }}
                        className="h-6 px-2.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-[10px] font-bold text-white/50 hover:text-white/80 transition-all cursor-pointer"
                        title="Playback Speed"
                      >
                        {audioSpeed}x
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════
                  TEXT / CODE PREVIEW
                  ══════════════════════════════════════════ */}
              {isText && (
                <div className="w-full h-full max-w-4xl mx-auto p-3 sm:p-4 overflow-auto">
                  <div className="bg-[#0d1117] border border-white/[0.06] rounded-xl overflow-hidden min-h-full">
                    {isTextLoading ? (
                      <div className="flex items-center justify-center p-20 gap-3">
                        <svg className="animate-spin h-5 w-5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                        </svg>
                        <span className="text-white/40 text-sm">Loading document...</span>
                      </div>
                    ) : (
                      <div className="flex text-xs font-mono leading-relaxed">
                        {/* Line numbers */}
                        <div className="select-none text-right pr-3 pl-3 py-4 text-white/15 border-r border-white/[0.04] bg-white/[0.02] shrink-0 sticky left-0">
                          {(textContent || "").split("\n").map((_, i) => (
                            <div key={i} className="leading-relaxed">{i + 1}</div>
                          ))}
                        </div>
                        {/* Content */}
                        <pre className="whitespace-pre-wrap p-4 text-white/75 select-text flex-1 min-w-0 overflow-x-auto">
                          {textContent || "(Empty file)"}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════
                  PDF PREVIEW
                  ══════════════════════════════════════════ */}
              {isPdf && (
                <div className="w-full h-full max-w-5xl mx-auto p-2 sm:p-4 flex flex-col">
                  {/* Browser-style header */}
                  <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-[#141414] border border-white/[0.06] rounded-t-xl">
                    {/* Traffic lights */}
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                    </div>
                    {/* Document badge */}
                    <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-1 flex-1 min-w-0">
                      <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-[11px] font-semibold text-white/50 truncate">{file.name}</span>
                      <span className="text-[9px] font-bold text-red-400/80 bg-red-500/10 border border-red-500/15 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">PDF</span>
                    </div>
                    {/* Download shortcut */}
                    {onDownload && (
                      <button
                        onClick={onDownload}
                        className="h-7 px-3 rounded-lg bg-white/[0.06] hover:bg-brand-500/20 text-[10px] font-bold text-white/50 hover:text-brand-400 transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Save
                      </button>
                    )}
                  </div>
                  {/* Iframe */}
                  <div className="flex-1 min-h-0 bg-[#111] border-x border-b border-white/[0.06] rounded-b-xl overflow-hidden shadow-2xl">
                    <iframe
                      src={`${url}#toolbar=0&navpanes=0`}
                      className="w-full h-full border-0 bg-[#111]"
                      title={file.name}
                    />
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════
                  SPREADSHEET PREVIEW
                  ══════════════════════════════════════════ */}
              {isSheet && (
                <div className="w-full h-full max-w-5xl mx-auto p-2 sm:p-4 flex flex-col text-left">
                  {isSheetLoading ? (
                    <div className="flex-1 flex items-center justify-center gap-3">
                      <svg className="animate-spin h-5 w-5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                      </svg>
                      <span className="text-white/40 text-sm font-medium">Parsing spreadsheet data...</span>
                    </div>
                  ) : (
                    <>
                      {/* Sheet tabs */}
                      {sheetNames.length > 0 && (
                        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1 shrink-0">
                          {sheetNames.map((name, index) => (
                            <button
                              key={name}
                              onClick={() => handleSheetSwitch(index)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 ${
                                activeSheetIndex === index
                                  ? "bg-brand-500 text-white shadow-md"
                                  : "bg-white/[0.06] text-white/50 hover:text-white/80 hover:bg-white/[0.1]"
                              }`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                      
                      {/* Table */}
                      <div className="flex-1 overflow-auto rounded-xl border border-white/[0.06] bg-[#0d1117]">
                        {sheetData && sheetData.length > 0 ? (
                          <table className="w-full border-collapse text-left text-xs text-white/75">
                            <thead className="sticky top-0 z-10">
                              <tr className="bg-[#161b22] border-b border-white/[0.06] divide-x divide-white/[0.04]">
                                <th className="px-3 py-2.5 text-center text-white/30 font-bold w-10">#</th>
                                {sheetData[0].map((_, colIdx) => (
                                  <th key={colIdx} className="px-3 py-2.5 text-white/40 font-bold min-w-[125px] tracking-wide text-[10px] uppercase">
                                    {String.fromCharCode(65 + (colIdx % 26)) + (colIdx >= 26 ? Math.floor(colIdx / 26) : "")}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.03]">
                              {sheetData.map((row, rowIdx) => (
                                <tr key={rowIdx} className="hover:bg-white/[0.03] divide-x divide-white/[0.03]">
                                  <td className="px-3 py-1.5 text-center bg-[#161b22]/60 text-white/25 select-none font-bold w-10 text-[10px]">{rowIdx + 1}</td>
                                  {row.map((cell, colIdx) => (
                                    <td key={colIdx} className="px-3 py-1.5 truncate max-w-[200px] font-medium" title={String(cell)}>
                                      {String(cell ?? "")}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="flex items-center justify-center p-20 text-white/30 font-medium">
                            No data found in this sheet
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ══════════════════════════════════════════
                  DOCX PREVIEW
                  ══════════════════════════════════════════ */}
              {isDocx && (
                <div className="w-full h-full max-w-4xl mx-auto p-2 sm:p-4 flex flex-col relative">
                  {loadingDocx && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 gap-3">
                      <svg className="animate-spin h-5 w-5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                      </svg>
                      <span className="text-white/40 text-sm">Rendering document pages...</span>
                    </div>
                  )}
                  {/* Document desk header */}
                  <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-[#1a1a1a] border border-white/[0.06] rounded-t-xl">
                    <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-[11px] font-semibold text-white/50 truncate flex-1">{file.name}</span>
                    <span className="text-[9px] font-bold text-blue-400/80 bg-blue-500/10 border border-blue-500/15 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">DOCX</span>
                  </div>
                  {/* White page with shadow - simulates real paper */}
                  <div className="flex-1 overflow-auto bg-[#2a2a2e] border-x border-b border-white/[0.06] rounded-b-xl">
                    <div className="mx-auto my-6 sm:my-8 max-w-[720px] bg-white rounded-sm shadow-[0_2px_24px_rgba(0,0,0,0.35)] p-8 sm:p-12 md:p-16 text-left select-text min-h-[80%]">
                      <style dangerouslySetInnerHTML={{__html: `
                        .docx-preview-body { background: transparent !important; color: #1a1a1a !important; font-family: 'Inter', 'Georgia', serif !important; font-size: 14px !important; }
                        .docx-preview-body p { margin-bottom: 0.75rem !important; line-height: 1.75 !important; color: #333 !important; }
                        .docx-preview-body h1, .docx-preview-body h2, .docx-preview-body h3 { color: #111111 !important; font-weight: 700 !important; margin-top: 1.5rem !important; margin-bottom: 0.75rem !important; }
                        .docx-preview-body table { width: 100% !important; border-collapse: collapse !important; margin: 1rem 0 !important; }
                        .docx-preview-body td, .docx-preview-body th { border: 1px solid #ddd !important; padding: 8px !important; }
                      `}} />
                      <div ref={docxContainerRef} className="w-full h-full" />
                    </div>
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════
                  EPUB PREVIEW
                  ══════════════════════════════════════════ */}
              {isEpub && (
                <div className="w-full h-full max-w-4xl mx-auto p-2 sm:p-4 flex flex-col relative">
                  {loadingEpub && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 gap-3">
                      <svg className="animate-spin h-5 w-5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                      </svg>
                      <span className="text-white/40 text-sm">Loading book pages...</span>
                    </div>
                  )}
                  {epubError ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3">
                      <svg className="w-12 h-12 text-danger/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <p className="text-white font-semibold">{epubError}</p>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col overflow-hidden bg-[#121214] border border-white/[0.06] rounded-2xl relative shadow-2xl p-4">
                      <div ref={epubContainerRef} className="flex-1 w-full overflow-hidden text-white" />
                      
                      {/* Pagination buttons */}
                      <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 mt-3 px-4 shrink-0">
                        <button
                          onClick={() => renditionRef.current?.prev()}
                          className="px-4 py-2 text-xs font-bold text-white/70 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] rounded-xl active:scale-95 transition-all cursor-pointer"
                        >
                          Previous Page
                        </button>
                        <span className="text-[10px] text-white/30 font-bold uppercase tracking-wider select-none">
                          EPUB Ebook Reader
                        </span>
                        <button
                          onClick={() => renditionRef.current?.next()}
                          className="px-4 py-2 text-xs font-bold text-white/70 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] rounded-xl active:scale-95 transition-all cursor-pointer"
                        >
                          Next Page
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ══════════════════════════════════════════
                  UNSUPPORTED FILE TYPE
                  ══════════════════════════════════════════ */}
              {!isImage && !isVideo && !isAudio && !isText && !isPdf && !isSheet && !isDocx && !isEpub && (
                <div className="text-center p-8">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-white/[0.06] flex items-center justify-center mb-4">
                    <FileIcon fileName={file.name} className="w-8 h-8" />
                  </div>
                  <p className="text-white font-semibold">No preview available</p>
                  <p className="text-white/35 text-sm mt-1">Download to view this file.</p>
                  {onDownload && (
                    <button
                      onClick={onDownload}
                      className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 transition-colors active:scale-95"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </button>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
