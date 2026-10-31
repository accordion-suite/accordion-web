// Settings' icons, drawn like Drive's: 24 units square, in the color of the
// text around them, and hidden from screen readers, since their labels say
// what they mean.

import { Icon } from "../drive/icons.tsx";

const line = { fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

export const SettingsIcon = () => (
  <Icon>
    <path
      d="M19.42 10.37 21.89 10.51 21.89 13.49 19.42 13.63 18.40 16.10 20.04 17.94 17.94 20.04 16.10 18.40 13.63 19.42 13.49 21.89 10.51 21.89 10.37 19.42 7.90 18.40 6.06 20.04 3.96 17.94 5.60 16.10 4.58 13.63 2.11 13.49 2.11 10.51 4.58 10.37 5.60 7.90 3.96 6.06 6.06 3.96 7.90 5.60 10.37 4.58 10.51 2.11 13.49 2.11 13.63 4.58 16.10 5.60 17.94 3.96 20.04 6.06 18.40 7.90ZM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8"
      fill="currentColor"
      fill-rule="evenodd"
    />
  </Icon>
);

export const BackIcon = () => (
  <Icon>
    <path d="M19 12H5m6-6-6 6 6 6" {...line} />
  </Icon>
);

export const PersonIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="3.6" {...line} />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" {...line} />
  </Icon>
);

export const DevicesIcon = () => (
  <Icon>
    <path d="M4 16V6.5A1.5 1.5 0 0 1 5.5 5h11A1.5 1.5 0 0 1 18 6.5V8M2 19h11" {...line} />
    <rect x="15" y="10" width="6" height="10" rx="1.2" {...line} />
  </Icon>
);

export const PeopleIcon = () => (
  <Icon>
    <circle cx="9" cy="8.5" r="3.2" {...line} />
    <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M15.5 5.6a3.2 3.2 0 0 1 0 5.8M18 14a6.5 6.5 0 0 1 3.5 5.5" {...line} />
  </Icon>
);

export const HealthIcon = () => (
  <Icon>
    <path d="M3 12h4l2.2-5.5 4.6 11L16 12h5" {...line} />
  </Icon>
);

export const BackupIcon = () => (
  <Icon>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6M4 4v4.6h4.6M12 8v4.4l3 1.8" {...line} />
  </Icon>
);

export const UpdatesIcon = () => (
  <Icon>
    <path d="M20 12a8 8 0 0 1-14.2 5M4 12a8 8 0 0 1 14.2-5M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2" {...line} />
  </Icon>
);

export const NetworkIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" {...line} />
    <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5" {...line} />
  </Icon>
);

export const PaletteIcon = () => (
  <Icon>
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.7-.8 1.4-1.8-.4-1.2.4-2.2 1.6-2.2h1.8a3.7 3.7 0 0 0 3.7-3.8C20.5 7.6 16.7 3.5 12 3.5" {...line} />
    <circle cx="7.6" cy="11.4" r="1.2" fill="currentColor" />
    <circle cx="10.4" cy="7.6" r="1.2" fill="currentColor" />
    <circle cx="15" cy="8" r="1.2" fill="currentColor" />
  </Icon>
);
