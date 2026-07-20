import React, { useEffect, useState, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  noPadding?: boolean;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  size = "md",
  noPadding = false,
  children,
}: ModalProps) {
  const [closing, setClosing] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    if (open) {
      document.addEventListener("keydown", handleEsc);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) focusable[0].focus();
  }, [open]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 220);
  };

  if (!open && !closing) return null;

  const sizeClasses: Record<string, string> = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-2xl",
    "2xl": "max-w-3xl",
    "3xl": "max-w-4xl",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* M3 Scrim: 32% opacity */}
      <div
        className={`absolute inset-0 bg-md-inverse-surface/32 ${closing ? "animate-backdrop-exit" : "animate-backdrop-enter"}`}
        style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
        onClick={handleClose}
      />
      {/* M3 Dialog: 28px radius, surface-container-high bg */}
      <div
        ref={modalRef}
        className={`relative bg-md-surface-container-high rounded-[28px] ${noPadding ? "p-0 overflow-hidden" : "p-6 overflow-y-auto scrollbar-thin"} w-full ${sizeClasses[size]} mx-auto border border-md-outline-variant/20 max-h-[90vh] ${closing ? "animate-spring-out" : "animate-spring-in"}`}
        style={{ boxShadow: "var(--md-elevation-3)" }}
      >
        {title && (
          <div className="flex items-center justify-between mb-5 select-none">
            <h3 className="text-lg font-semibold text-md-on-surface tracking-tight">{title}</h3>
            <button
              onClick={handleClose}
              className="text-md-on-surface-variant hover:text-md-on-surface transition-all p-2 rounded-full hover:bg-md-surface-container-highest cursor-pointer active:scale-90"
              title="Close Modal"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}
        <div className={title && !noPadding ? "space-y-4" : ""}>
          {children}
        </div>
      </div>
    </div>
  );
}
