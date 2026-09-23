const paths = {
  image: 'M3 3h18v18H3zM3 18l6-8 5 6 3-4 4 6M16 7h1',
  container: 'M3 3h18v18H3zM7 7h10v10H7z',
  heading: 'M6 4v16M18 4v16M6 12h12',
  paragraph: 'M4 5h16M4 10h16M4 15h16M4 20h9',
  span: 'M7 15V7h4.5a2.25 2.25 0 0 1 0 4.5H7M5 19h14',
  button: 'M3 6h18v9H3zM13 13.5l6.5 3-3 1.1-1.1 3z',
  section: 'M3 3h18v18H3zM3 8h18M3 16h18',
  grid: 'M3 3h18v18H3zM12 3v18M3 12h18',
  row: 'M3 4h18v16H3zM9 4v16M15 4v16',
  stack: 'M4 3h16v18H4zM4 9h16M4 15h16',
  back: 'm14 6-6 6 6 6M8 12h12',
  page: 'M6 3h8l4 4v14H6zM14 3v5h4',
  layer: 'M4 6h16v12H4z',
  video: 'M3 4h18v16H3zM10 9v6l5-3z',
  embed: 'm8 7-5 5 5 5M16 7l5 5-5 5',
  list: 'M4 6h1M4 12h1M4 18h1M9 6h11M9 12h11M9 18h11',
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
  chevron: 'm9 6 6 6-6 6',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v5M12 8h.01',
  up: 'm6 11 6-6 6 6M12 5v14',
  down: 'm6 13 6 6 6-6M12 19V5',
  undo: 'M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 4 5 5-5 5M20 9H10a6 6 0 0 0 0 12h3',
  token: 'm12 3 8 4.5v9L12 21l-8-4.5v-9z',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
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
