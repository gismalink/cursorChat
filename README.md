# cursorChat

Shared cursor presence and ephemeral cursor chat, consumed as a pinned Git submodule.

- `react/`: React hook and overlay; host injects authenticated room transport and connection health.
- `dom/`: plain DOM renderer; host injects WebSocket URL and identity loading/subscription.
- `core/`: shared preference and toggle icon, pressure policy.

Only cursor bubbles are included; persistent room/DM chat is outside this module.
Host owns authentication, access checks, transport, toggle placement and theme. No host URLs or credentials are stored here. React is an optional peer dependency; DOM consumers do not load React.

Disabling must clear peers/editor and publish `visible:false`, including pending sends. The host stores the preference per origin and supplies its toggle with `aria-pressed`, title and accessible name. Enabled defaults to true. A disabled user neither displays peers nor advertises a visible cursor. Other application presence remains independent.

Consumers initialize submodules recursively before building. Pin changes through reviewed parent Git updates. Run consumer TypeScript, DOM lifecycle tests and two-client transport checks before release. Test deployments precede production.
