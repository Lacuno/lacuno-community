const paths = {
  back: 'm14 6-6 6 6 6M8 12h12',
  page: 'M6 3h8l4 4v14H6zM14 3v5h4',
  layer: 'M4 6h16v12H4z',
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
