interface BreadcrumbProps {
  folderName: string | null;
  onBackToRoot: () => void;
}

export function Breadcrumb({ folderName, onBackToRoot }: BreadcrumbProps) {
  return (
    <nav className="flex items-center gap-2 text-sm mb-4">
      <button
        onClick={onBackToRoot}
        className="text-md-on-surface-variant hover:text-md-primary transition-colors font-medium cursor-pointer"
      >
        My Drive
      </button>
      {folderName && (
        <>
          <svg
            className="w-4 h-4 text-md-outline"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="text-md-on-surface font-medium">{folderName}</span>
        </>
      )}
    </nav>
  );
}
