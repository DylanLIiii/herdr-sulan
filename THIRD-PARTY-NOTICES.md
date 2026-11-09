# Third-party notices

This repository is an independent Herdr sidebar integration.

- **Sulan** — https://github.com/DylanLIiii/sulan. MIT, copyright 2026 DylanLi. The summary parser, text width helpers, diagram helpers and chat reply parsing are adapted for Herdr. Sulan includes work from **catch-me-up**, MIT, copyright 2026 Oliver Wang. Both notices are preserved in `LICENSE`.
- **Herdr App** — https://github.com/herdrdev/herdr-app. Apache License 2.0. `layouts/sulan.json` adapts `defaults/layouts/main.json`; the tab-bar behavior in `mods/sulan/main.js` adapts `defaults/mods/tabs/main.js`. Changes add the Sulan panel, toggle and role handling. The Apache license is reproduced in `mods/sulan/vendor/LICENSE.herdr-app`. Herdr itself is not bundled.
- **beautiful-mermaid 1.1.3** — https://github.com/lukilabs/beautiful-mermaid. MIT, copyright 2026 Craft Docs. The bundled ASCII engine is `mods/sulan/vendor/mermaid-text.js`, inherited from Sulan; its license is reproduced in `mods/sulan/vendor/LICENSE.beautiful-mermaid`.
- The diagram helpers follow the approach attributed by Sulan to **prismantis** — https://github.com/NahumLitvin/prismantis (MIT). Acknowledged for the terminal diagram approach.

The MIT license for this project's own work does not replace the upstream licenses for the corresponding portions. Source files derived from upstream have been modified for this sidebar.
