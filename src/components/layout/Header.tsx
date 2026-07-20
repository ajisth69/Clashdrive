import { useState, useRef, useEffect } from "react";
import { Input } from "../ui/Input";
import type { UserProfile, SavedAccount } from "../../types";
import type { Theme } from "../../hooks/useTheme";
import { APP_VERSION } from "../../config/telegram";

interface HeaderProps {
  driveTitle: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onLogout: () => void;
  userProfile: UserProfile | null;
  accounts: SavedAccount[];
  activeAccountId: string | null;
  onSwitchAccount: (userId: string) => void;
  onRemoveAccount: (userId: string) => void;
  onAddAccount: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onMenuClick?: () => void;
  onOpenReceiveShare?: () => void;
  fileSharingEnabled?: boolean;
  onToggleFileSharing?: () => void;
  onJoinUpdateChannel?: () => void | Promise<void>;
  joiningChannel?: boolean;
  onClearCache?: () => void | Promise<void>;
  onOpenSettingsModal?: () => void;
}

export function Header({
  driveTitle,
  searchQuery,
  onSearchChange,
  onLogout,
  userProfile,
  accounts,
  activeAccountId,
  onSwitchAccount,
  onRemoveAccount,
  onAddAccount,
  theme,
  setTheme,
  onMenuClick,
  onOpenReceiveShare,
  fileSharingEnabled = false,
  onToggleFileSharing,
  onJoinUpdateChannel,
  joiningChannel = false,
  onClearCache,
  onOpenSettingsModal,
}: HeaderProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);

  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Search input keyboard shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setShowThemeMenu(false);
      }
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fallback initial
  const initials = userProfile?.firstName
    ? userProfile.firstName.charAt(0).toUpperCase()
    : "U";

  const displayName = userProfile
    ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(" ")
    : "Telegram User";

  return (
    <header className="sticky top-0 z-40 glass border-b border-md-outline-variant/30">
      <div className="flex items-center justify-between px-4 lg:px-6 h-16 gap-3 sm:gap-4">
        {/* Hamburger Menu — M3 48dp touch target */}
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="lg:hidden w-12 h-12 rounded-full bg-transparent hover:bg-md-surface-container-high text-md-on-surface-variant flex items-center justify-center transition-all cursor-pointer active:scale-90 shrink-0"
            title="Open Menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0 select-none">
          <svg className="w-9 h-9" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="header-logo-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#24A1DE" />
                <stop offset="100%" stopColor="#4F46E5" />
              </linearGradient>
              <linearGradient id="header-logo-cloud" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#E0E7FF" stopOpacity="0.85" />
              </linearGradient>
            </defs>
            <circle cx="64" cy="64" r="60" fill="url(#header-logo-bg)" />
            <circle cx="64" cy="64" r="56" fill="none" stroke="#FFFFFF" strokeOpacity="0.15" strokeWidth="2.5" />
            <path d="M42 80c-5.52 0-10-4.48-10-10 0-4.88 3.5-8.94 8.2-9.82C41.4 51.78 49.38 46 58.5 46c8.07 0 15.22 4.45 18 11.02 1.34-.63 2.85-.98 4.45-.98 5.52 0 10 4.48 10 10s-4.48 10-10 10H42z" fill="url(#header-logo-cloud)" />
            <path d="M51 68l24-15.5L46.5 61l.5 9.5 4-2.5z" fill="#24A1DE" />
            <path d="M75 52.5L46.5 61l15.5 5.5 13-14z" fill="#38BDF8" />
          </svg>
          <div>
            <h1 className="text-sm font-bold gradient-text leading-tight flex items-center gap-1.5">
              Clash Drive
            </h1>
            <p className="text-[10px] text-md-on-surface-variant leading-tight font-medium">
              {driveTitle === "Clash Drive" || driveTitle === "TG Cloud Drive" ? "Telegram Cloud Storage" : driveTitle}
            </p>
          </div>
        </div>

        {/* Search bar — M3 search bar: rounded-[28px] */}
        <div className="flex-1 max-w-lg hidden md:block relative">
          <Input
            ref={searchRef}
            placeholder="Search files and folders..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="!bg-md-surface-container !border-md-outline-variant/50 !py-2.5 !rounded-[28px] text-sm pr-16"
            icon={
              <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            }
          />
          {!searchQuery && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pointer-events-none select-none text-[9px] font-semibold text-md-on-surface-variant bg-md-surface-container-high px-1.5 py-0.5 rounded-md border border-md-outline-variant/30">
              <span>Ctrl</span>
              <span>K</span>
            </div>
          )}
          {searchQuery && (
            <button
              onClick={() => {
                onSearchChange("");
                searchRef.current?.focus();
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-md-surface-container-highest hover:bg-md-outline-variant text-md-on-surface-variant flex items-center justify-center active:scale-90 transition-all cursor-pointer"
              title="Clear Search"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Settings Gear — M3 icon button: 48dp, rounded-full */}
          <div className="relative" ref={settingsMenuRef}>
            <button
              onClick={() => {
                if (onOpenSettingsModal) {
                  onOpenSettingsModal();
                } else {
                  setShowSettingsMenu(!showSettingsMenu);
                }
              }}
              className="w-10 h-10 rounded-full hover:bg-md-surface-container-high text-md-on-surface-variant flex items-center justify-center transition-all cursor-pointer active:scale-95"
              title="Settings & Profile"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {showSettingsMenu && (
              <div className="absolute right-0 top-12 z-50 bg-md-surface-container rounded-[16px] p-4 w-72 animate-scale-in border border-md-outline-variant/20 space-y-3.5 select-none" style={{ boxShadow: 'var(--md-elevation-2)' }}>
                <div className="flex items-center justify-between border-b border-md-outline-variant/20 pb-2">
                  <h3 className="text-xs font-bold text-md-on-surface uppercase tracking-wider">Drive Settings</h3>
                  <span className="text-[10px] font-bold bg-md-primary-container text-md-on-primary-container px-2 py-0.5 rounded-full">
                    v{APP_VERSION}
                  </span>
                </div>

                {/* Enable File Sharing Toggle — M3 switch */}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-md-on-surface leading-tight">File Sharing</p>
                    <p className="text-[10px] text-md-on-surface-variant font-medium mt-0.5">Auto-invite @clashdrivebot</p>
                  </div>
                  {onToggleFileSharing && (
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
                  )}
                </div>

                {/* Join Updates Button */}
                {onJoinUpdateChannel && (
                  <button
                    onClick={() => {
                      onJoinUpdateChannel();
                      setShowSettingsMenu(false);
                    }}
                    disabled={joiningChannel}
                    className={`w-full flex items-center justify-between gap-2 p-3 rounded-xl text-xs font-semibold border border-md-primary/20 bg-md-primary-container/30 hover:bg-md-primary-container/50 text-md-primary transition-all cursor-pointer ${
                      joiningChannel ? "opacity-60 cursor-not-allowed" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {joiningChannel ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
                      ) : (
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                      )}
                      <span>{joiningChannel ? "Joining..." : "Join Updates"}</span>
                    </div>
                    <span className="text-[9.5px] font-mono text-md-primary bg-md-primary-container px-1.5 py-0.5 rounded-md">
                      @clashgramclient
                    </span>
                  </button>
                )}

                {/* Clear Cache & Reset Button */}
                {onClearCache && (
                  <button
                    onClick={() => {
                      onClearCache();
                      setShowSettingsMenu(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 p-3 rounded-xl text-xs font-semibold border border-md-error/20 bg-md-error-container/30 hover:bg-md-error-container/50 text-md-error transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>Clear Cache</span>
                    </div>
                    <span className="text-[9.5px] font-medium text-md-error bg-md-error-container px-1.5 py-0.5 rounded-md">
                      Logout All
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Theme Switcher */}
          <div className="relative" ref={themeMenuRef}>
            <button
              onClick={() => setShowThemeMenu(!showThemeMenu)}
              className="w-10 h-10 rounded-full hover:bg-md-surface-container-high text-md-on-surface-variant flex items-center justify-center transition-all cursor-pointer active:scale-95"
              title="Switch Theme"
            >
              {theme === "light" && (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
              )}
              {theme === "dark" && (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
              {theme === "system" && (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 3v18" />
                  <path d="M12 3a9 9 0 110 18 9 9 0 010-18z" />
                  <path d="M12 3a9 9 0 010 18v-18z" fill="currentColor" />
                </svg>
              )}
            </button>

            {showThemeMenu && (
              <div className="absolute right-0 top-12 z-50 bg-md-surface-container rounded-[12px] p-1.5 w-[140px] animate-scale-in border border-md-outline-variant/20 flex flex-col gap-0.5 select-none" style={{ boxShadow: 'var(--md-elevation-2)' }}>
                {([
                  { id: "light", label: "Light", icon: (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                    </svg>
                  )},
                  { id: "dark", label: "Dark", icon: (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  )},
                  { id: "system", label: "System", icon: (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 3v18" />
                      <path d="M12 3a9 9 0 110 18 9 9 0 010-18z" />
                      <path d="M12 3a9 9 0 010 18v-18z" fill="currentColor" />
                    </svg>
                  )},
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTheme(t.id);
                      setShowThemeMenu(false);
                    }}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer min-h-[40px] ${
                      theme === t.id
                        ? "bg-md-secondary-container text-md-on-secondary-container font-semibold"
                        : "text-md-on-surface hover:bg-md-surface-container-high"
                    }`}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User Profile / Account Switcher */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-2 p-1 rounded-full hover:bg-md-surface-container-high transition-all cursor-pointer"
            >
              {userProfile?.avatarUrl ? (
                <img
                  src={userProfile.avatarUrl}
                  alt={displayName}
                  className="w-8 h-8 rounded-full object-cover ring-2 ring-md-primary/20"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-md-primary-container text-md-on-primary-container font-bold text-xs flex items-center justify-center">
                  {initials}
                </div>
              )}
            </button>

            {showDropdown && (
              <div className="absolute right-0 top-12 z-50 bg-md-surface-container rounded-[16px] p-3 w-64 animate-scale-in border border-md-outline-variant/20 space-y-3 select-none" style={{ boxShadow: 'var(--md-elevation-2)' }}>
                <div className="px-2 py-1 border-b border-md-outline-variant/20 pb-2">
                  <p className="text-xs font-bold text-md-on-surface truncate">{displayName}</p>
                  <p className="text-[10px] text-md-on-surface-variant font-medium truncate mt-0.5">
                    @{userProfile?.username || "telegram_user"}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-[9.5px] uppercase font-bold tracking-widest text-md-on-surface-variant px-2">
                    Accounts
                  </p>
                  {accounts.map((acc) => (
                    <div
                      key={acc.userId}
                      className={`flex items-center justify-between p-2 rounded-xl transition-all ${
                        acc.userId === activeAccountId
                          ? "bg-md-secondary-container text-md-on-secondary-container font-semibold"
                          : "hover:bg-md-surface-container-high text-md-on-surface"
                      }`}
                    >
                      <button
                        onClick={() => {
                          onSwitchAccount(acc.userId);
                          setShowDropdown(false);
                        }}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="w-6 h-6 rounded-lg bg-md-primary-container text-md-on-primary-container font-bold text-[10px] flex items-center justify-center shrink-0">
                          {acc.idName ? acc.idName.charAt(0).toUpperCase() : "U"}
                        </div>
                        <span className="text-xs truncate">{acc.idName || acc.username}</span>
                      </button>
                      {accounts.length > 1 && (
                        <button
                          onClick={() => onRemoveAccount(acc.userId)}
                          className="p-1 text-md-on-surface-variant hover:text-md-error rounded-lg transition-colors cursor-pointer"
                          title="Remove Account"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      onAddAccount();
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-md-surface-container-high text-md-on-surface text-xs font-semibold hover:bg-md-surface-container-highest transition-colors flex items-center justify-center gap-1.5 cursor-pointer mt-1"
                  >
                    + Add Account
                  </button>
                </div>

                <div className="pt-2 border-t border-md-outline-variant/20">
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      onLogout();
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-md-error-container text-md-on-error-container text-xs font-bold hover:brightness-95 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
