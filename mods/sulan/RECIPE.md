# Sulan sidebar

A native Herdr sidebar for catching up on the active project while keeping its terminals visible. The panel shows a TL;DR, structured summary, progress diagram, terminal activity and a separate project conversation.

![Native Herdr sidebar with synthetic demonstration data](../../preview.png)

## What you see

- A 396px right panel in the supplied personal layout; standalone Mod docking requests 420px. It follows `theme()` and uses a rounded frame with a 1px border.
- A 36px title strip: Sulan title, project/branch and update status. Below it, a TL;DR and the tabs **速览 / 侧聊 / 终端**, plus refresh, rebuild and demo/live controls.
- **速览** contains compact sections for goal, changes, conclusions, current state, next steps and terminology. State markers are ✓ done, ◐ in progress, ✗ failed/blocked, ? needs an answer and ○ pending.
- The progress region displays a segmented bar and native GPUI nodes grouped into layers from a simple Mermaid flowchart. This is a small flowchart subset, not a general Mermaid renderer.
- **终端** lists the active Space's agents, child terminals, Git branch, files and commits. **侧聊** contains a question field, model/effort controls and recent exchanges with collapsible Thinking.

## How it behaves

- The workspace tab bar has a **速览** toggle next to Files and Changes. Clicking an active panel button closes the panel; another opens its stack child. The tab bar remembers the selection per Space in its own localStorage.
- The content selects the active Space and its terminal folder. It loads that key's saved summary and chat, collects Git facts and bounded terminal screen excerpts, and checks again every 6 seconds while visible. Local repositories also use `watchFolder`.
- **Refresh** and **Rebuild** request an AI summary. Rebuild clears the previous summary first. Timer and folder updates collect facts without triggering model requests. A model failure falls back to the deterministic snapshot.
- Agent cards focus their pane/tab. Child terminals without a pane use `terminal.peek`. Demo mode uses synthetic fixtures and does not navigate real terminals.
- Side chat sends the summary, bounded snapshot and recent exchanges to the configured model endpoint. It has no tools. Failed questions can be retried or edited; clearing requires a second click.
- Keys while the panel has focus: `r` refresh, `b` rebuild, `c` chat, `d` demo/live, `1/2/3` summary/terminals/chat, Escape leaves input focus.

## Built from

- `layouts/sulan.json`: the standard workspace structure with `spaces`, `agents`, active terminal panes, Files and Changes. The `tabs` block uses `sulan` with `role: "tabs"`; `panel-body` includes `sulan` with `role: "sidebar"`, selected initially.
- `mods/sulan/main.js`: `View` with default sidebar role and a workspace-tab-bar role. The shipped layout does not use the older page/nav roles still present in the source.
- `context.js`: Space/agent selection, read-only Git commands and `hc read` screen tails. `summary.js` parses the six-section format; `diagram.js` creates GPUI flow layers and retains the Sulan ASCII helpers. `chat.js` constructs prompts and separates Thinking; `llm.js` calls Anthropic/OpenAI-compatible endpoints.
- `mod.json`: `{ "place": "right", "size": 420, "focusable": true }`.
- APIs: `spaces`, `panes`, `focused`, `agents`, `terminals`, `exec`, `hc`, `run`, `openOverlay`, `theme`, `layout`, `settings`, `props`, `shared`, `setShared`, `nextCommand`, `watchFolder`.
- Program access: Git reads on the Space's machine; `hc read` for terminal excerpts. File access is to the selected repository through Git and watching. AI requests send the collected context to `props.endpoint`, default `http://127.0.0.1:3425/v1/messages`. Model/key settings are personal props, not repository credentials.

## Watch out

- Duplicate shipped layouts before modifying their structure. The installer creates a separate personal layout and refuses existing names. Some Herdr releases do not auto-dock new Mods into shipped layouts; a split pane remains available.
- Terminal excerpts are bounded screen tails, not complete conversation history. The initial snapshot waits for collection; only a saved summary is available immediately.
- localStorage belongs to each Mod copy. Separate sidebar/split copies do not share summary or chat history. Saved keys have no retention limit yet.
- A cached AI summary can remain older than the latest terminal/Git view until manual refresh. The gateway must provide its own request deadline; native fetch is not cancelled by an application watchdog.
- Effort is sent for non-default OpenAI-compatible requests. Anthropic effort is not currently transmitted.
- Use each callback's own `cx`. Spinners use native `frames`, not script redraw timers. QuickJS receives a fallback when `Intl.Segmenter` is missing.
- Source attribution and licenses are in the repository's `THIRD-PARTY-NOTICES.md`; include them when redistributing.

## Done when

- `herdr-app check mods/sulan` and `npm test` pass.
- In an isolated Herdr home, the personal layout shows terminals beside the right sidebar; 速览 / Files / Changes switch the right panel.
- The active Space's summary, terminals and Git facts appear, and demo mode remains distinguishable from live context.
- With a configured model gateway, refresh, chat, retry, Thinking, copy and clear work in the actual app. Initial-load checks and screenshots alone do not prove this last item.
