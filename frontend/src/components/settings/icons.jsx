import React from 'react';

const baseProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

export const UserIcon = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M20 21a8 8 0 0 0-16 0" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const GeneralIcon = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4 7h16" />
    <path d="M4 12h10" />
    <path d="M4 17h16" />
  </svg>
);

export const PaletteIcon = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M12 22a10 10 0 1 1 10-10c0 3-2 4-4 4h-1a2 2 0 0 0-2 2c0 2-1 4-3 4z" />
    <circle cx="7.5" cy="10.5" r="1" />
    <circle cx="12" cy="8" r="1" />
    <circle cx="16.5" cy="10.5" r="1" />
    <circle cx="9.5" cy="15" r="1" />
  </svg>
);

export const SlidersIcon = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4 21v-7" />
    <path d="M4 10V3" />
    <path d="M12 21v-9" />
    <path d="M12 8V3" />
    <path d="M20 21v-5" />
    <path d="M20 12V3" />
    <path d="M2 14h4" />
    <path d="M10 12h4" />
    <path d="M18 16h4" />
  </svg>
);

export const ToolsIcon = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M14.7 6.3a4 4 0 0 0-5.7 5.7L3 18l3 3 6-6a4 4 0 0 0 5.7-5.7l-2.1 2.1-2.8-2.8z" />
  </svg>
);

export const SearchIcon = (props) => (
  <svg {...baseProps} {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

export const MenuIcon = (props) => (
  <svg {...baseProps} {...props}>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </svg>
);

