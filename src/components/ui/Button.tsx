import React, { useRef, useCallback } from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "glass" | "icon";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children?: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  onClick,
  ...props
}: ButtonProps) {
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Ripple effect
      const btn = btnRef.current;
      if (btn) {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const ripple = document.createElement("span");
        ripple.style.cssText = `
          position: absolute;
          left: ${x}px;
          top: ${y}px;
          width: 0;
          height: 0;
          border-radius: 50%;
          background: currentColor;
          transform: translate(-50%, -50%);
          pointer-events: none;
          animation: ripple-spread 0.5s ease-out forwards;
        `;
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 500);
      }
      onClick?.(e);
    },
    [onClick]
  );

  const base =
    "relative inline-flex items-center justify-center font-extrabold rounded-full transition-all duration-250 ease-out cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.96] overflow-hidden";

  const variants: Record<string, string> = {
    primary:
      "bg-brand-500 text-white hover:bg-brand-600 active:brightness-95 border border-transparent shadow-sm hover:shadow-md transition-shadow",
    secondary:
      "bg-surface-200 text-surface-900 dark:bg-surface-300/20 dark:text-surface-900 hover:bg-surface-300 dark:hover:bg-surface-300/35 border border-transparent",
    ghost:
      "bg-transparent text-surface-800 dark:text-surface-700 hover:bg-surface-200/50 dark:hover:bg-surface-200/10 active:bg-surface-300/30",
    danger:
      "bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 hover:border-danger/30 active:bg-danger/30",
    glass:
      "bg-surface-100/30 text-surface-900 border border-surface-300/30 dark:border-surface-300/10 backdrop-blur-md hover:bg-surface-200/50 hover:border-surface-400/40 active:bg-surface-350/40",
    icon:
      "bg-transparent text-surface-600 dark:text-surface-500 hover:bg-surface-200/65 dark:hover:bg-surface-200/15 hover:text-surface-900 dark:hover:text-surface-900 rounded-full p-0 border border-transparent",
  };

  const sizes: Record<string, string> = {
    sm: "text-xs px-3.5 py-2.5 gap-1.5",
    md: "text-sm px-5 py-3 gap-2",
    lg: "text-base px-7 py-4 gap-2.5",
  };

  // Icon variant overrides size to fixed square
  const sizeClass = variant === "icon" ? "w-10 h-10" : sizes[size];

  return (
    <button
      ref={btnRef}
      className={`${base} ${variants[variant]} ${sizeClass} ${className}`}
      disabled={disabled || loading}
      onClick={handleClick}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
