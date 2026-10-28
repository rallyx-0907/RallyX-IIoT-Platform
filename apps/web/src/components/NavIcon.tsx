const paths: Record<string, string> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  assets: 'M4 4h16v16H4z M4 10h16 M10 4v16',
  live: 'M2 12h4l3-7 5 14 3-7h5',
  history: 'M12 8v5l3 2 M4 5v5h5 M4 10a8 8 0 1 1 0 5',
  alarms: 'M12 3 2 21h20L12 3z M12 9v5 M12 17v1',
  connections: 'M8 8 5 5 2 8l3 3 M16 16l3 3 3-3-3-3 M7 17 17 7 M4 20l3-3 M17 7l3-3',
  devices: 'M5 4h14v16H5z M9 8h6 M9 12h6 M10 16h4',
  templates: 'M7 3h13v14 M4 7h12v14H4z M7 11h6 M7 15h6',
  configuration: 'M3 6h18 M3 12h18 M3 18h18 M7 3v6 M16 9v6 M10 15v6',
  rules: 'M4 5h4v4H4z M4 15h4v4H4z M14 5h6 M14 17h6 M8 7h3v10H8',
  system: 'M3 4h18v13H3z M8 21h8 M12 17v4 M7 8h10 M7 12h6',
};

export function NavIcon({ page }: { page: string }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[page] || paths.overview} /></svg>;
}
