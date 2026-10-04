import type { SVGProps } from 'react';

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export const SearchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const UserIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

export const BookmarkIcon = (props: SVGProps<SVGSVGElement> & { filled?: boolean }) => {
  const { filled, ...rest } = props;
  return (
    <svg {...base} {...rest} fill={filled ? 'currentColor' : 'none'}>
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  );
};

export const ExternalIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} width={14} height={14} {...props}>
    <path d="M14 4h6v6M20 4 10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </svg>
);
