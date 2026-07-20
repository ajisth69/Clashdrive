import { useState, useEffect, useRef } from "react";
import type { DriveFile, DriveConfig, TopicFolder } from "../../types";
import { formatBytes } from "../../lib/manifest";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

interface ReceiveShareModalProps {
  initialHash?: string;
  workerUrl: string;
  driveConfig?: DriveConfig | null;
  topics?: TopicFolder[];
  activeFolderId?: number | null;
  onClose: () => void;
  onSuccess?: (topicId?: number | null) => void;
}

function formatTtl(seconds: number): string {
  if (seconds <= 0) return "Never";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? "s" : ""}`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} min`;
}

export function ReceiveShareModal({
  initialHash = "",
  workerUrl,
  driveConfig,
  topics = [],
  activeFolderId,
  onClose,
  onSuccess,
}: ReceiveShareModalProps) {
  const [hash, setHash] = useState(initialHash);
  const [loading, setLoading] = useState(false);
  const [sendingBotMsg, setSendingBotMsg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [sharedFile, setSharedFile] = useState<DriveFile | null>(null);
  const [senderInfo, setSenderInfo] = useState<string | null>(null);
  const [ttlRemaining, setTtlRemaining] = useState<number | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(
    activeFolderId ?? (topics.length > 0 ? topics[0].id : null)
  );

  const [isFolderDropdownOpen, setIsFolderDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialHash) {
      handleFetchFile(initialHash);
    }
  }, [initialHash]);

  useEffect(() => {
    if (activeFolderId) {
      setSelectedTopicId(activeFolderId);
    } else if (topics.length > 0 && selectedTopicId === null) {
      setSelectedTopicId(topics[0].id);
    }
  }, [activeFolderId, topics]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsFolderDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFetchFile = async (targetHash: string) => {
    const cleanHash = targetHash.trim();
    if (!cleanHash) {
      setError("Please enter a valid share token hash or link.");
      return;
    }

    const effectiveWorkerUrl = workerUrl?.trim() || "https://clashdrive.clashgram.workers.dev";
    setLoading(true);
    setError(null);
    setSharedFile(null);
    setSuccessMsg(null);

    try {
      const cleanUrl = effectiveWorkerUrl.replace(/\/$/, "");
      const res = await fetch(`${cleanUrl}/api/share?hash=${cleanHash}`);
      const result = await res.json();

      if (result.ok && result.data && result.data.file) {
        setSharedFile(result.data.file);
        setSenderInfo(result.data.sender || "ClashDrive User");
        setTtlRemaining(result.ttlRemaining ?? -1);
      } else {
        setError(result.error || "Share token not found or expired.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to fetch shared file data.");
    } fontally: () => {
      setLoading(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const match = text.match(/share=([a-f0-9]{12}(?:\.[A-Za-z0-9_-]+)?)/i) || text.match(/([a-f0-9]{12}(?:\.[A-Za-z0-9_-]+)?)/i);
      const extractedHash = match ? match[1] : text.trim();
      if (extractedHash) {
        setHash(extractedHash);
        handleFetchFile(extractedHash);
      }
    } catch {
      setError("Clipboard read permission denied.");
    }
  };

  const handleSendViaBot = async () => {
    const effectiveWorkerUrl = workerUrl?.trim() || "https://clashdrive.clashgram.workers.dev";
    if (!hash || !effectiveWorkerUrl || !driveConfig?.chatId) {
      setError("Active Drive chat configuration is required to send via bot.");
      return;
    }

    setSendingBotMsg(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const cleanUrl = effectiveWorkerUrl.replace(/\/$/, "");
      const res = await fetch(`${cleanUrl}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hash: hash.trim(),
          targetChatId: driveConfig.chatId,
          topicId: selectedTopicId,
        }),
      });

      const result = await res.json();
      if (result.ok) {
        const folderName = topics.find((t) => t.id === selectedTopicId)?.title || "your folder";
        setSuccessMsg(`File saved & forwarded to "${folderName}" via @clashdrivebot!`);
        if (onSuccess) {
          onSuccess(selectedTopicId);
        }
      } else {
        setError(result.error || "Failed to send file via Telegram Bot.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to send request to file sharing service.");
    } finally {
      setSendingBotMsg(false);
    }
  };

  const selectedTopicFolder = topics.find((t) => t.id === selectedTopicId) || topics[0];

  return (
    <Modal open={true} onClose={onClose} title="Redeem Shared File">
      <div className="space-y-5 select-none">
        {/* Input Hash Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-md-on-surface-variant">
              Share Token Hash or Link
            </label>
            <button
              onClick={handlePasteFromClipboard}
              className="text-[11px] text-md-primary font-semibold hover:underline cursor-pointer flex items-center gap-1.5"
            >
              📋 Paste
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <input
              type="text"
              value={hash}
              onChange={(e) => setHash(e.target.value)}
              placeholder="Paste 12-character token hash or link..."
              className="flex-grow px-4 py-3 rounded-xl bg-md-surface-container-lowest border border-md-outline-variant text-xs font-mono text-md-on-surface placeholder:text-md-outline focus:outline-none focus:border-md-primary"
            />
            <Button
              variant="primary"
              onClick={() => handleFetchFile(hash)}
              disabled={loading || !hash.trim()}
              loading={loading}
              className="shrink-0 justify-center"
            >
              Fetch
            </Button>
          </div>
        </div>

        {/* Error / Success Messages */}
        {error && (
          <div className="p-3.5 rounded-2xl bg-md-error-container text-xs text-md-on-error-container font-medium flex items-center gap-2.5 animate-slide-down">
            <span>⚠️</span> {error}
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-2xl bg-success-container text-xs text-on-success-container font-medium flex items-center gap-2.5 animate-slide-down">
            <span>✅</span> {successMsg}
          </div>
        )}

        {/* Shared File Details Card */}
        {sharedFile && (
          <div className="space-y-4 animate-scale-in">
            <div className="p-4 rounded-2xl bg-md-surface-container border border-md-outline-variant/30 space-y-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-md-on-surface truncate" title={sharedFile.name}>
                    {sharedFile.name}
                  </h3>
                  <p className="text-xs text-md-on-surface-variant mt-1 font-medium flex items-center gap-1.5 flex-wrap">
                    <span>Size: <strong className="text-md-on-surface">{formatBytes(sharedFile.size)}</strong></span>
                    <span>• Shared by: <strong className="text-md-primary">{senderInfo}</strong></span>
                  </p>
                </div>
                <span className="px-2.5 py-1 text-[10px] font-mono font-semibold uppercase bg-md-primary-container text-md-on-primary-container rounded-xl shrink-0">
                  {sharedFile.name.split(".").pop() || "file"}
                </span>
              </div>

              {ttlRemaining !== null && ttlRemaining !== -1 && (
                <div className="pt-2.5 border-t border-md-outline-variant/20 flex items-center justify-between text-xs text-md-on-surface-variant">
                  <span>Expiration Status:</span>
                  <span className="font-semibold font-mono text-warning bg-warning-container px-2.5 py-0.5 rounded-md">
                    {ttlRemaining > 0 ? `Expires in ${formatTtl(ttlRemaining)}` : "Expires Soon"}
                  </span>
                </div>
              )}
            </div>

            {/* Folder Dropdown Selector */}
            {topics.length > 0 && (
              <div className="space-y-2 relative" ref={dropdownRef}>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-md-on-surface-variant">
                  Save to Destination Folder
                </label>
                
                <button
                  type="button"
                  onClick={() => setIsFolderDropdownOpen(!isFolderDropdownOpen)}
                  className="w-full px-4 py-3 rounded-xl bg-md-surface-container-lowest border border-md-outline-variant hover:border-md-primary text-xs font-semibold text-md-on-surface flex items-center justify-between transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-base">📁</span>
                    <span className="truncate text-md-on-surface font-semibold">
                      {selectedTopicFolder ? selectedTopicFolder.title : "Select Folder"}
                    </span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-md-on-surface-variant transition-transform duration-200 ${
                      isFolderDropdownOpen ? "rotate-180 text-md-primary" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isFolderDropdownOpen && (
                  <div className="absolute left-0 right-0 bottom-full mb-2 z-50 bg-md-surface-container border border-md-outline-variant/30 rounded-[16px] p-1.5 space-y-1 max-h-48 overflow-y-auto scrollbar-thin animate-scale-in" style={{ boxShadow: 'var(--md-elevation-2)' }}>
                    {topics.map((t) => {
                      const isSelected = t.id === selectedTopicId;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setSelectedTopicId(t.id);
                            setIsFolderDropdownOpen(false);
                          }}
                          className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between cursor-pointer ${
                            isSelected
                              ? "bg-md-secondary-container text-md-on-secondary-container"
                              : "text-md-on-surface hover:bg-md-surface-container-high"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <span className="text-base">📁</span>
                            <span className="truncate">{t.title}</span>
                          </div>
                          {isSelected && <span className="text-xs">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <Button
              variant="primary"
              onClick={handleSendViaBot}
              disabled={sendingBotMsg}
              loading={sendingBotMsg}
              className="w-full justify-center"
              size="lg"
            >
              Save to Folder via Bot
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
