import type { ComponentChildren } from 'preact';

/**
 * Inline stroke icons, so the page needs no icon font, CDN or extra permission and stays
 * free of network requests. Decorative only: every control carries its own text label.
 */
type Props = { size?: number };

function Svg({ size = 18, children }: Props & { children: ComponentChildren }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={1.8}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const FolderIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export const ClockIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const ArchiveIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
  </Svg>
);

export const GearIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);

export const SearchIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const PlusIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const MoreIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" />
  </Svg>
);

export const PlayIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
  </Svg>
);

export const ParkIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3" />
  </Svg>
);

export const PencilIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
  </Svg>
);

export const TrashIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Svg>
);

export const UnlinkIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1M4 4l16 16" />
  </Svg>
);

export const UploadIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
  </Svg>
);

export const DownloadIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
  </Svg>
);

export const HistoryIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 8v4l3 2" />
  </Svg>
);

export const CloudIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z" />
  </Svg>
);

export const EyeIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const CloseIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const GridIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Svg>
);

export const ListIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);

export const PaletteIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.6-.3-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" />
    <circle cx="7.5" cy="11" r="1" fill="currentColor" />
    <circle cx="10" cy="7" r="1" fill="currentColor" />
    <circle cx="15" cy="7.5" r="1" fill="currentColor" />
  </Svg>
);

export const ChevronIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
