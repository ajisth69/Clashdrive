import { useState } from "react";
import { Modal } from "../ui/Modal";
import { APP_VERSION } from "../../config/telegram";
import { formatBytes } from "../../lib/manifest";
import type { UserProfile, SavedAccount, DriveFile } from "../../types";
import type { Theme } from "../../hooks/useTheme";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  userProfile: UserProfile | null;
  accounts: SavedAccount[];
  activeAccountId: string | null;
  allFiles: DriveFile[];
  onAddAccount: () => void;
  onSwitchAccount: (userId: string) => void;
  onRemoveAccount: (userId: string) => void;
  onLogout: () => void;
  onClearCache?: () => void | Promise<void>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  fileSharingEnabled?: boolean;
  onToggleFileSharing?: () => void;
  onJoinUpdateChannel?: () => void | Promise<void>;
  joiningChannel?: boolean;
}

export function SettingsModal({
  open,
  onClose,
  userProfile,
  accounts,
  allFiles,
  onAddAccount,
  onLogout,
  onClearCache,
  theme,
  setTheme,
  fileSharingEnabled = false,
  onToggleFileSharing,
  onJoinUpdateChannel,
  joiningChannel = false,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"profile" | "display">("profile");

  if (!open) return null;

  const totalFiles = allFiles.length;
  const imageCount = allFiles.filter((f) => {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    return f.mimeType?.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
  }).length;
  
  const videoCount = allFiles.filter((f) => {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    return f.mimeType?.startsWith("video/") || ["mp4", "webm", "mkv", "mov", "avi"].includes(ext);
  }).length;

  const totalStorage = allFiles.reduce((acc, f) => acc + (f.size || 0), 0);

  const displayName = userProfile
    ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(" ")
    : "Telegram User";

  const usernameText = userProfile?.username ? `@${userProfile.username}` : "—";
  const telegramIdText = userProfile?.id ? userProfile.id.toString() : "—";
  const phoneText = userProfile?.phone || "Hidden / Private";
  const accountTypeText = userProfile?.isPremium ? "Premium User" : "Standard User";

  const initials = userProfile?.firstName
    ? userProfile.firstName.charAt(0).toUpperCase()
    : "U";

  return (
    <Modal open={open} onClose={onClose} size="2xl" noPadding>
      <div className="flex flex-col md:flex-row md:min-h-[500px] max-h-[85vh] bg-md-surface-container-low overflow-hidden select-none">
        {/* Left Sidebar Navigation */}
        <div className="w-full md:w-60 shrink-0 bg-md-surface-container border-b md:border-b-0 md:border-r border-md-outline-variant/20 p-4 sm:p-5 flex flex-row md:flex-col justify-between items-center md:items-stretch gap-3">
          <div className="flex md:flex-col items-center md:items-stretch justify-between w-full md:w-auto gap-3 md:space-y-6">
            {/* Modal Header */}
            <div className="flex items-center gap-2.5 px-1 md:px-2">
              <div className="w-8 h-8 rounded-full bg-md-primary-container text-md-on-primary-container flex items-center justify-center shrink-0">
                <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-md-on-surface">Settings</h3>
            </div>

            {/* Navigation Options — M3 Nav Rail */}
            <div className="flex md:flex-col gap-1.5 md:space-y-1">
              <button
                onClick={() => setActiveTab("profile")}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full text-xs font-semibold transition-all cursor-pointer min-h-[40px] ${
                  activeTab === "profile"
                    ? "bg-md-secondary-container text-md-on-secondary-container"
                    : "text-md-on-surface-variant hover:bg-md-surface-container-high"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Profile
              </button>

              <button
                onClick={() => setActiveTab("display")}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full text-xs font-semibold transition-all cursor-pointer min-h-[40px] ${
                  activeTab === "display"
                    ? "bg-md-secondary-container text-md-on-secondary-container"
                    : "text-md-on-surface-variant hover:bg-md-surface-container-high"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
                Display
              </button>
            </div>
          </div>

          <div className="hidden md:block pt-4 border-t border-md-outline-variant/20 text-[10px] font-semibold text-md-on-surface-variant text-center">
            ClashDrive v{APP_VERSION}
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 p-6 md:p-7 overflow-y-auto flex flex-col justify-between scrollbar-thin relative">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-md-on-surface-variant hover:text-md-on-surface transition-all p-2 rounded-full hover:bg-md-surface-container-highest cursor-pointer active:scale-90 z-10"
            title="Close Settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {activeTab === "profile" ? (
            <div className="space-y-6 pr-6">
              <div>
                <h2 className="text-lg font-bold text-md-on-surface tracking-tight">Profile</h2>
                <p className="text-xs text-md-on-surface-variant font-medium mt-0.5">
                  Your active cloud session information.
                </p>
              </div>

              {/* User Avatar & Name Card */}
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-md-surface-container border border-md-outline-variant/20">
                {(userProfile?.photoUrl || userProfile?.avatarUrl) ? (
                  <img
                    src={(userProfile.photoUrl || userProfile.avatarUrl)!}
                    alt={displayName}
                    className="w-14 h-14 rounded-2xl object-cover ring-2 ring-md-primary/20"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-md-primary-container text-md-on-primary-container font-bold text-xl flex items-center justify-center">
                    {initials}
                  </div>
                )}
                <div>
                  <h3 className="text-base font-bold text-md-on-surface flex items-center gap-2">
                    {displayName}
                    <span className="w-2.5 h-2.5 rounded-full bg-success shadow-sm" title="Active Now" />
                  </h3>
                  <p className="text-xs text-md-on-surface-variant font-semibold mt-0.5">{usernameText}</p>
                  <span className="inline-block text-[9.5px] font-semibold text-success mt-1">
                    Active Session
                  </span>
                </div>
              </div>

              {/* Stat Cards */}
              <div className="space-y-2">
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-md-on-surface-variant">
                  CLOUD LIBRARY
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-2xl bg-md-surface-container border border-md-outline-variant/20 flex flex-col justify-between">
                    <svg className="w-4 h-4 text-md-on-surface-variant mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                    <div>
                      <p className="text-base font-bold text-md-on-surface">{totalFiles}</p>
                      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-md-on-surface-variant">FILES</p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-md-surface-container border border-md-outline-variant/20 flex flex-col justify-between">
                    <svg className="w-4 h-4 text-success mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <div>
                      <p className="text-base font-bold text-md-on-surface">{imageCount}</p>
                      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-md-on-surface-variant">IMAGES</p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-md-surface-container border border-md-outline-variant/20 flex flex-col justify-between">
                    <svg className="w-4 h-4 text-md-tertiary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <div>
                      <p className="text-base font-bold text-md-on-surface">{videoCount}</p>
                      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-md-on-surface-variant">VIDEOS</p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-md-surface-container border border-md-outline-variant/20 flex flex-col justify-between">
                    <svg className="w-4 h-4 text-md-primary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                    </svg>
                    <div>
                      <p className="text-base font-bold text-md-on-surface">{formatBytes(totalStorage)}</p>
                      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-md-on-surface-variant">STORAGE</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Detailed Profile Table */}
              <div className="space-y-2.5 pt-1 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-md-outline-variant/20">
                  <span className="font-semibold text-md-on-surface-variant">Phone</span>
                  <span className="font-mono font-semibold text-md-on-surface">{phoneText}</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-md-outline-variant/20">
                  <span className="font-semibold text-md-on-surface-variant">Username</span>
                  <span className="font-mono font-semibold text-md-primary">{usernameText}</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-md-outline-variant/20">
                  <span className="font-semibold text-md-on-surface-variant">Telegram ID</span>
                  <span className="font-mono font-semibold text-md-on-surface">{telegramIdText}</span>
                </div>

                <div className="flex items-center justify-between py-1.5 border-b border-md-outline-variant/20">
                  <span className="font-semibold text-md-on-surface-variant">Account Type</span>
                  <span className="font-semibold text-md-on-surface">{accountTypeText}</span>
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <span className="font-semibold text-md-on-surface-variant">Linked on ClashDrive</span>
                  <span className="font-mono font-semibold text-md-on-surface">
                    {new Date().toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Bottom Action Bar */}
              <div className="flex items-center gap-3 pt-4 border-t border-md-outline-variant/20">
                <button
                  onClick={() => {
                    onClose();
                    onAddAccount();
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-full bg-md-surface-container-high hover:bg-md-surface-container-highest text-md-on-surface text-xs font-semibold border border-md-outline-variant/20 transition-all cursor-pointer active:scale-95 min-h-[40px]"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
                  </svg>
                  Add Account ({accounts.length}/3)
                </button>

                <button
                  onClick={() => {
                    onClose();
                    if (onClearCache) {
                      onClearCache();
                    } else {
                      onLogout();
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-full bg-md-error-container text-md-on-error-container hover:brightness-95 text-xs font-semibold transition-all cursor-pointer active:scale-95 min-h-[40px]"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                  </svg>
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            /* Display Tab Content */
            <div className="space-y-6 pr-6">
              <div>
                <h2 className="text-lg font-bold text-md-on-surface tracking-tight">Display</h2>
                <p className="text-xs text-md-on-surface-variant font-medium mt-0.5">
                  Customize application theme and appearance preferences.
                </p>
              </div>

              {/* Theme Preference */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-md-on-surface-variant">
                  THEME PREFERENCE
                </h4>

                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: "light", label: "Light", icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" },
                    { id: "dark", label: "Dark", icon: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" },
                    { id: "system", label: "System", icon: "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setTheme(item.id as Theme)}
                      className={`p-4 rounded-2xl flex flex-col items-center gap-2.5 border transition-all cursor-pointer ${
                        theme === item.id
                          ? "bg-md-secondary-container text-md-on-secondary-container border-transparent font-semibold"
                          : "bg-md-surface-container border-md-outline-variant/20 text-md-on-surface hover:bg-md-surface-container-high"
                      }`}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                      </svg>
                      <span className="text-xs">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Extra Preferences */}
              <div className="space-y-3 pt-4 border-t border-md-outline-variant/20">
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-md-on-surface-variant">
                  NETWORK & SHARING
                </h4>

                {/* Join Updates Channel */}
                {onJoinUpdateChannel && (
                  <button
                    onClick={onJoinUpdateChannel}
                    disabled={joiningChannel}
                    className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-md-surface-container border border-md-outline-variant/20 hover:border-md-primary/30 text-md-on-surface text-xs font-semibold transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <svg className="w-4.5 h-4.5 text-md-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                      <span className="truncate">Join Updates Channel</span>
                    </div>
                    <span className="text-[10px] font-mono text-md-primary bg-md-primary-container px-2 py-0.5 rounded-md shrink-0">
                      @clashgramclient
                    </span>
                  </button>
                )}

                {/* File Sharing Toggle — M3 switch: 52x32dp */}
                {onToggleFileSharing && (
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-md-surface-container border border-md-outline-variant/20">
                    <div>
                      <p className="text-xs font-bold text-md-on-surface">File Sharing Mode</p>
                      <p className="text-[10px] text-md-on-surface-variant font-medium mt-0.5">Auto-invite worker bot for instant links</p>
                    </div>
                    <button
                      onClick={onToggleFileSharing}
                      className={`w-[52px] h-[32px] rounded-full transition-colors relative cursor-pointer shrink-0 border-2 ${
                        fileSharingEnabled 
                          ? "bg-md-primary border-md-primary" 
                          : "bg-md-surface-container-highest border-md-outline"
                      }`}
                    >
                      <div
                        className={`rounded-full bg-white transition-all absolute top-1/2 -translate-y-1/2 ${
                          fileSharingEnabled 
                            ? "w-6 h-6 left-[24px]" 
                            : "w-4 h-4 left-[6px]"
                        }`}
                        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
                      />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
