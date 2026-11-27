import type { ReactNode } from 'react'

const S = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const Icon = {
  arrow: () => <S><path d="M4 12h15m-6-6 6 6-6 6" /></S>,
  diagonal: () => <S><path d="M6 18 18 6M8 6h10v10" /></S>,
  left: () => <S><path d="m15 5-7 7 7 7" /></S>,
  right: () => <S><path d="m9 5 7 7-7 7" /></S>,
  plans: () => (
    <S>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </S>
  ),
  link: () => (
    <S>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.1 1.1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1" />
    </S>
  ),
  aperture: () => (
    <S>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m14.3 3.8-4.6 8M20.2 10.6h-9.1M17.6 18.3l-4.5-7.9M9.7 20.2l4.6-8M3.8 13.4h9.1M6.4 5.7l4.5 7.9" />
    </S>
  ),
  expand: () => <S><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></S>,
  help: () => (
    <S>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4" />
      <circle cx="12" cy="16.6" r=".6" fill="currentColor" />
    </S>
  ),
  close: () => <S><path d="M6 6l12 12M18 6 6 18" /></S>,
  orbit: () => (
    <S>
      <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M9.5 20v-5h5v5" />
    </S>
  ),
  walk: () => (
    <S>
      <circle cx="13" cy="4.6" r="1.7" />
      <path d="m9.5 21 2.2-6.2 2.6 2.2V21M14.3 17l-.6-5.4M8 12.6l2.4-3.8 3.7.2 2.6 3.2M10.4 8.8 9 14" />
    </S>
  ),
  dollhouse: () => (
    <S>
      <path d="M3.5 10.5 12 4l8.5 6.5" />
      <path d="M5.5 10v9.5h13V10" />
      <path d="M12 10v9.5M5.5 14.5h13" />
    </S>
  ),
  plan: () => (
    <S>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
      <path d="M11 4.5v6H3.5M11 14v5.5M15 10.5h5.5M11 10.5h1.5" />
    </S>
  ),
  palette: () => (
    <S>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.6-.7 1.6-1.5 0-1.2-1.1-1.5-1.1-2.6 0-.9.7-1.6 1.6-1.6h2.2a4.2 4.2 0 0 0 4.2-4.2c0-3.9-3.8-7.1-8.5-7.1Z" />
      <circle cx="7.8" cy="11.2" r="1" fill="currentColor" />
      <circle cx="10.4" cy="7.6" r="1" fill="currentColor" />
      <circle cx="14.8" cy="7.8" r="1" fill="currentColor" />
    </S>
  ),
  sun: () => (
    <S>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    </S>
  ),
  pencil: () => (
    <S>
      <path d="M4 20h4L19.3 8.7a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 7.5 3 3" />
    </S>
  ),
  copy: () => (
    <S>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </S>
  ),
  bed: () => <S><path d="M3.5 18.5v-11M3.5 14h17v4.5M20.5 14v-2.5a3 3 0 0 0-3-3h-6V14M7.5 11.5a1.5 1.5 0 1 0 0-.01" /></S>,
  bath: () => <S><path d="M4 12h16v2.5a4.5 4.5 0 0 1-4.5 4.5h-7A4.5 4.5 0 0 1 4 14.5zM6.5 12V6.2a1.7 1.7 0 0 1 3.2-.8M7 19l-1 1.5M17 19l1 1.5" /></S>,
  area: () => <S><path d="M4 4h16v16H4z" /><path d="M4 9h3M4 14h3M9 4v3M14 4v3" /></S>,
}
