/**
 * Inline 16px line icons. Stroke is always currentColor so an icon inherits
 * whatever status/accent color its container sets — no icon carries a color.
 */

const PATHS = {
  grid: "M3 3h5v5H3zM10 3h5v5h-5zM3 10h5v5H3zM10 10h5v5h-5z",
  users: "M6.5 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM2 15v-1a4 4 0 014-4h1a4 4 0 014 4v1M12 4.2a2.2 2.2 0 010 4.3M13 10.2a3.6 3.6 0 013 3.5V15",
  file: "M4 2h6l4 4v10H4zM10 2v4h4",
  shield: "M9 2l6 2.5v4.2c0 3.6-2.4 6.4-6 7.3-3.6-.9-6-3.7-6-7.3V4.5z",
  activity: "M2 10h3l2-5 3 10 2.5-5H16",
  settings: "M9 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM9 1.5v2M9 14.5v2M2.7 5.2l1.7 1M13.6 11.8l1.7 1M2.7 12.8l1.7-1M13.6 6.2l1.7-1",
  clock: "M9 16a7 7 0 100-14 7 7 0 000 14zM9 5.5V9l2.5 1.8",
  inbox: "M2 10l2.2-6h9.6L16 10v5H2zM2 10h4l1 2h4l1-2h4",
  alert: "M9 2.5l7 12.5H2zM9 7v3.5M9 12.6v.6",
  check: "M3.5 9.5l3.5 3.5L15 5.5",
  sparkle: "M9 2.5l1.6 4.4 4.4 1.6-4.4 1.6L9 14.5l-1.6-4.4L3 8.5l4.4-1.6zM14.5 12.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z",
  bell: "M9 2.5a4.5 4.5 0 00-4.5 4.5c0 3.2-1.2 4.4-1.2 4.4h11.4S13.5 10.2 13.5 7A4.5 4.5 0 009 2.5zM7.2 14a1.9 1.9 0 003.6 0",
  sun: "M9 12a3 3 0 100-6 3 3 0 000 6zM9 1.8v1.6M9 14.6v1.6M2.4 9H4M14 9h1.6M4.3 4.3l1.1 1.1M12.6 12.6l1.1 1.1M4.3 13.7l1.1-1.1M12.6 5.4l1.1-1.1",
  moon: "M14.5 11.2A6 6 0 016.8 3.5a6 6 0 107.7 7.7z",
  chevronDown: "M4.5 7l4 4 4-4",
  sortDesc: "M4 5h10M4 9h7M4 13h4",
};

export default function Icon({ name, size = 16, className }) {
  const path = PATHS[name] || PATHS.file;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
