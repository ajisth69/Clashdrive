import { useState, useRef, useEffect } from "react";
import type { DriveFile } from "../../types";
import { formatBytes } from "../../lib/manifest";

interface PreviewModalProps {
  file: DriveFile;
  url: string | null;
  onClose: () => void;
}

export function PreviewModal({ file, url, onClose }: PreviewModalProps) {
  const [closing, setClosing] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [rotation, setRotation] = useState(0);
  
  // Custom Audio player states
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  // Text preview states
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);

  // Excel / Spreadsheet preview states
  const [sheetData, setSheetData] = useState<any[][] | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [workbookRef, setWorkbookRef] = useState<any>(null);

  // Word docx preview states
  const [loadingDocx, setLoadingDocx] = useState(false);
  const docxContainerRef = useRef<HTMLDivElement | null>(null);

  const handleClose = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setClosing(true);
    setTimeout(onClose, 300);
  };

  const ext = file.name.split(".").pop()?.toLowerCase();
  const mimeType = file.mimeType || "";
  
  const isImage =
    mimeType.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext || "");
  const isVideo =
    mimeType.startsWith("video/") ||
    ["mp4", "webm", "ogg", "mov"].includes(ext || "");
  const isAudio =
    mimeType.startsWith("audio/") ||
    ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext || "");
  const isText = 
    ["txt", "md", "json", "js", "ts", "py", "rs", "go", "html", "css", "xml"].includes(ext || "");
  const isPdf =
    mimeType === "application/pdf" ||
    (ext || "") === "pdf";
  const isDocx = (ext || "") === "docx";
  const isSheet = ["xlsx", "xls", "csv"].includes(ext || "");

  // Escape key close listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // Text preview loader
  useEffect(() => {
    if (isText && url) {
      setLoadingText(true);
      fetch(url)
        .then((r) => r.text())
        .then((txt) => {
          setTextContent(txt.slice(0, 50000)); // Load up to 50KB safely
          setLoadingText(false);
        })
        .catch((e) => {
          console.error("Text fetch error:", e);
          setLoadingText(false);
        });
    }
  }, [isText, url]);

  // Dynamic script helper
  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  }

  // Excel / CSV spreadsheet loader
  useEffect(() => {
    if (isSheet && url) {
      setLoadingSheet(true);
      loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js")
        .then(() => fetch(url))
        .then((r) => r.arrayBuffer())
        .then((buffer) => {
          const XLSX = (window as any).XLSX;
          const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
          setWorkbookRef(workbook);
          setSheetNames(workbook.SheetNames);
          
          // Render first sheet by default
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
          setSheetData(jsonData as any[][]);
          setLoadingSheet(false);
        })
        .catch((e) => {
          console.error("Spreadsheet load/parse error:", e);
          setLoadingSheet(false);
        });
    }
  }, [isSheet, url]);

  const handleSheetSwitch = (index: number) => {
    if (!workbookRef) return;
    setActiveSheetIndex(index);
    const XLSX = (window as any).XLSX;
    const sheetName = workbookRef.SheetNames[index];
    const worksheet = workbookRef.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    setSheetData(jsonData as any[][]);
  };

  // Word (.docx) loader
  useEffect(() => {
    if (isDocx && url && docxContainerRef.current) {
      setLoadingDocx(true);
      loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js")
        .then(() => loadScript("https://cdn.jsdelivr.net/npm/docx-preview@0.1.15/dist/docx-preview.min.js"))
        .then(() => fetch(url))
        .then((r) => r.blob())
        .then((blob) => {
          const docx = (window as any).docx;
          if (docxContainerRef.current) {
            docxContainerRef.current.innerHTML = ""; // Clear
            docx.renderAsync(blob, docxContainerRef.current, null, {
              className: "docx-preview-body",
              inWrapper: false,
              ignoreWidth: true,
              ignoreHeight: true
            })
              .then(() => setLoadingDocx(false))
              .catch((err: any) => {
                console.error("Docx renderAsync failed:", err);
                setLoadingDocx(false);
              });
          }
        })
        .catch((e) => {
          console.error("Docx load/render error:", e);
          setLoadingDocx(false);
        });
    }
  }, [isDocx, url, docxContainerRef.current]);

  // Audio Playback Controls
  const toggleAudioPlay = () => {
    if (!audioRef.current) return;
    if (audioPlaying) {
      audioRef.current.pause();
      setAudioPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setAudioPlaying(true);
    }
  };

  const handleAudioTimeUpdate = () => {
    if (!audioRef.current) return;
    setAudioTime(audioRef.current.currentTime);
  };

  const handleAudioLoadedMetadata = () => {
    if (!audioRef.current) return;
    setAudioDuration(audioRef.current.duration);
  };

  const handleAudioSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setAudioTime(time);
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 transition-all duration-300 ${closing ? "opacity-0" : "opacity-100"}`}>
      {/* Safari-compatible backdrop filter overlay */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-md" 
        style={{ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
        onClick={handleClose} 
      />

      <div className={`relative w-full max-w-6xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2.5rem)] bg-surface-50 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ${closing ? "scale-95 translate-y-4" : "scale-100 translate-y-0"}`}>
        <div className="relative z-20 shrink-0 p-3 sm:p-4 border-b border-surface-200 bg-surface-100 flex items-center gap-3">
          <button
            onClick={handleClose}
            className="w-10 h-10 shrink-0 rounded-full bg-surface-300 text-surface-900 flex items-center justify-center hover:bg-surface-400 transition-colors"
            title="Back"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-surface-900 truncate">{file.name}</h3>
            <p className="text-xs text-surface-600 mt-1">Streaming preview - {formatBytes(file.size)}</p>
          </div>

          <button
            onClick={handleClose}
            className="w-10 h-10 shrink-0 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/75 transition-colors"
            title="Close"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="relative bg-black flex-1 min-h-0 flex items-center justify-center overflow-auto">
          {!url ? (
            <div className="w-full max-w-md p-8 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-800 flex items-center justify-center animate-pulse">
                <svg className="w-7 h-7 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <p className="text-white font-medium">Opening stream...</p>
            </div>
          ) : (
            <div className="w-full min-h-0 flex items-center justify-center p-2 sm:p-4 relative">
              {isImage && (
                <div className="relative max-w-full max-h-[calc(100dvh-8rem)] flex items-center justify-center group/img">
                  <img
                    src={url}
                    alt={file.name}
                    loading="eager"
                    decoding="async"
                    className="max-w-full max-h-[calc(100dvh-8rem)] object-contain rounded-lg shadow-xl transition-transform duration-300"
                    style={{ transform: `rotate(${rotation}deg)` }}
                  />
                  {/* Floating rotate button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRotation((r) => (r + 90) % 360);
                    }}
                    className="absolute right-4 top-4 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 active:scale-95 text-white flex items-center justify-center transition-all opacity-0 group-hover/img:opacity-100 shadow-lg pointer-events-auto"
                    title="Rotate Image 90°"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3m0 0l3 3m-3-3v8" />
                    </svg>
                  </button>
                </div>
              )}
              
              {isVideo && (
                <div className="relative w-full max-w-4xl flex items-center justify-center">
                  <video
                    src={url}
                    controls
                    autoPlay
                    playsInline
                    preload="auto"
                    crossOrigin="anonymous"
                    onSeeking={() => setBuffering(true)}
                    onSeeked={() => setBuffering(false)}
                    onWaiting={() => setBuffering(true)}
                    onPlaying={() => setBuffering(false)}
                    className="w-auto max-w-full max-h-[calc(100dvh-9rem)] rounded-lg bg-black"
                  />
                  {/* seeking/buffering loading spinner overlay */}
                  {buffering && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg pointer-events-none">
                      <div className="w-14 h-14 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
                        <svg className="animate-spin h-8 w-8 text-accent-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <circle cx="12" cy="12" r="10" strokeWidth={3} className="opacity-25" />
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {isAudio && (
                <div className="w-full max-w-xl p-8 bg-surface-900/40 border border-surface-800/60 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col items-center">
                  {/* Dynamic visualizer representation */}
                  <div className="w-32 h-32 rounded-full bg-gradient-to-tr from-accent-500 to-indigo-500 flex items-center justify-center mb-6 shadow-lg shadow-accent-500/10">
                    <svg className={`w-16 h-16 text-white ${audioPlaying ? "animate-pulse" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-2v13M9 19c0 1.105-1.79 2-4 2s-4-.895-4-2 1.79-2 4-2 4 .895 4 2zM9 10l12-2" />
                    </svg>
                  </div>

                  <h4 className="text-white font-medium text-center truncate w-full px-4 mb-1">{file.name}</h4>
                  <p className="text-surface-400 text-xs mb-6">TG Audio Recording</p>

                  <audio
                    ref={audioRef}
                    src={url}
                    preload="auto"
                    crossOrigin="anonymous"
                    onTimeUpdate={handleAudioTimeUpdate}
                    onLoadedMetadata={handleAudioLoadedMetadata}
                    onEnded={() => setAudioPlaying(false)}
                    className="hidden"
                  />

                  {/* Slider controls */}
                  <div className="w-full flex items-center gap-3 mb-6">
                    <span className="text-xs text-surface-400 w-10 text-right">{formatTime(audioTime)}</span>
                    <input
                      type="range"
                      min={0}
                      max={audioDuration || 100}
                      value={audioTime}
                      onChange={handleAudioSeek}
                      className="flex-1 h-1.5 rounded-lg bg-surface-800 accent-accent-400 cursor-pointer overflow-hidden"
                    />
                    <span className="text-xs text-surface-400 w-10 text-left">{formatTime(audioDuration)}</span>
                  </div>

                  {/* Playback Controls */}
                  <button
                    onClick={toggleAudioPlay}
                    className="w-16 h-16 rounded-full bg-accent-500 hover:bg-accent-600 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-accent-500/20 transition-all"
                  >
                    {audioPlaying ? (
                      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                    ) : (
                      <svg className="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              )}

              {isText && (
                <div className="w-full max-w-4xl max-h-[calc(100dvh-10rem)] p-4 bg-surface-900 border border-surface-850 rounded-xl overflow-auto text-left font-mono text-xs text-surface-200">
                  {loadingText ? (
                    <div className="flex items-center justify-center p-20 gap-3">
                      <svg className="animate-spin h-5 w-5 text-accent-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                      </svg>
                      <span className="text-surface-400">Loading document...</span>
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap leading-relaxed select-text">{textContent || "(Empty file)"}</pre>
                  )}
                </div>
              )}

              {isPdf && (
                <div className="w-full max-w-5xl h-[calc(100dvh-10rem)] bg-surface-900 border border-surface-850 rounded-xl overflow-hidden shadow-2xl relative">
                  <iframe
                    src={`${url}#toolbar=0&navpanes=0`}
                    className="w-full h-full border-0 rounded-xl bg-surface-900"
                    title={file.name}
                  />
                </div>
              )}

              {isSheet && (
                <div className="w-full max-w-5xl h-[calc(100dvh-10rem)] p-4 bg-surface-900 border border-surface-850 rounded-xl overflow-hidden flex flex-col shadow-2xl relative text-left">
                  {loadingSheet ? (
                    <div className="flex-1 flex items-center justify-center gap-3">
                      <svg className="animate-spin h-5 w-5 text-accent-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                      </svg>
                      <span className="text-surface-400">Parsing spreadsheet data...</span>
                    </div>
                  ) : (
                    <>
                      {/* Multiple workbook sheet tabs */}
                      {sheetNames.length > 1 && (
                        <div className="flex items-center gap-2 mb-3 overflow-x-auto border-b border-surface-800 pb-2">
                          {sheetNames.map((name, index) => (
                            <button
                              key={name}
                              onClick={() => handleSheetSwitch(index)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                activeSheetIndex === index
                                  ? "bg-accent-500 text-white shadow-md shadow-accent-500/10"
                                  : "bg-surface-800 text-surface-400 hover:text-white"
                              }`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                      
                      {/* Glassmorphic Spreadsheet Table Grid */}
                      <div className="flex-1 overflow-auto rounded-lg border border-surface-800/80 bg-surface-950/60 scrollbar-thin">
                        {sheetData && sheetData.length > 0 ? (
                          <table className="w-full border-collapse text-left text-xs text-surface-200">
                            <thead>
                              <tr className="bg-surface-900 border-b border-surface-850 divide-x divide-surface-850 select-none">
                                <th className="px-3 py-2 text-center text-surface-500 font-semibold w-10">#</th>
                                {sheetData[0].map((_, colIdx) => (
                                  <th key={colIdx} className="px-3 py-2 text-surface-400 font-medium min-w-[120px]">
                                    {String.fromCharCode(65 + (colIdx % 26)) + (colIdx >= 26 ? Math.floor(colIdx / 26) : "")}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-850/30">
                              {sheetData.map((row, rowIdx) => (
                                <tr key={rowIdx} className="hover:bg-surface-900/30 divide-x divide-surface-850/20">
                                  <td className="px-3 py-1.5 text-center bg-surface-900/40 text-surface-500 select-none font-semibold w-10">{rowIdx + 1}</td>
                                  {row.map((cell, colIdx) => (
                                    <td key={colIdx} className="px-3 py-1.5 truncate max-w-[200px]" title={String(cell)}>
                                      {String(cell ?? "")}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="flex items-center justify-center p-20 text-surface-400">
                            No spreadsheet data found in this sheet
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {isDocx && (
                <div className="w-full max-w-4xl h-[calc(100dvh-10rem)] p-4 bg-surface-900 border border-surface-850 rounded-xl flex flex-col shadow-2xl relative">
                  {loadingDocx && (
                    <div className="absolute inset-0 flex items-center justify-center bg-surface-900/80 z-10 gap-3">
                      <svg className="animate-spin h-5 w-5 text-accent-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                      </svg>
                      <span className="text-surface-400">Rendering document pages...</span>
                    </div>
                  )}
                  
                  {/* Styled docx renderer paper window */}
                  <div className="flex-1 overflow-auto rounded-lg bg-[#ffffff] border border-surface-850 p-6 md:p-12 text-left select-text scrollbar-thin">
                    <style dangerouslySetInnerHTML={{__html: `
                      .docx-preview-body { background: transparent !important; color: #333333 !important; font-family: 'Inter', sans-serif !important; }
                      .docx-preview-body p { margin-bottom: 0.75rem !important; line-height: 1.6 !important; }
                      .docx-preview-body h1, .docx-preview-body h2, .docx-preview-body h3 { color: #111111 !important; font-weight: 700 !important; margin-top: 1.5rem !important; margin-bottom: 0.75rem !important; }
                      .docx-preview-body table { width: 100% !important; border-collapse: collapse !important; margin: 1rem 0 !important; }
                      .docx-preview-body td, .docx-preview-body th { border: 1px solid #ddd !important; padding: 8px !important; }
                    `}} />
                    <div ref={docxContainerRef} className="w-full h-full" />
                  </div>
                </div>
              )}

              {!isImage && !isVideo && !isAudio && !isText && !isPdf && !isSheet && !isDocx && (
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-800 flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-white font-medium">No preview available</p>
                  <p className="text-surface-400 text-sm mt-1">Please download the file to view it.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
