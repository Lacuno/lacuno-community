const paths = {
  image: 'M3 3h18v18H3zM3 18l6-8 5 6 3-4 4 6M16 7h1',
  section: 'M3 3h18v18H3zM3 8h18M3 16h18',
  grid: 'M3 3h18v18H3zM12 3v18M3 12h18',
  row: 'M3 4h18v16H3zM9 4v16M15 4v16',
  stack: 'M4 3h16v18H4zM4 9h16M4 15h16',
  back: 'm14 6-6 6 6 6M8 12h12',
  page: 'M6 3h8l4 4v14H6zM14 3v5h4',
  layer: 'M4 6h16v12H4z',
  layers: 'm3 7 9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4',
  expand: 'm5 6 6 6-6 6m8-12 6 6-6 6',
  collapse: 'm11 6-6 6 6 6m8-12-6 6 6 6',
  text: 'M5 5h14M12 5v14M9 19h6',
  component: 'm12 3 9 9-9 9-9-9z',
  desktop: 'M3 4h18v13H3zM12 17v4M8 21h8',
  tablet: 'M5 2h14v20H5zM11 18h2',
  mobile: 'M8 2h8v20H8zM11 18h2',
  reload: 'M20 7V3l-4 4M20 7a9 9 0 1 0 1 7M20 7h-5',
  plus: 'M12 5v14M5 12h14',
  reset: 'M4 10a8 8 0 1 1 1 7M4 10V4M4 10h6',
  bolt: 'm13 2-8 12h6l-1 8 9-13h-6z',
  chevron: 'm9 6 6 6-6 6',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v5M12 8h.01',
  up: 'm6 11 6-6 6 6M12 5v14',
  down: 'm6 13 6 6 6-6M12 19V5',
} as const

export function EditorIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className="editor-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
