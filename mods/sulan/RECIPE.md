# Sulan · focused project sidebar

A native Herdr sidebar for understanding the current project quickly and asking a follow-up without leaving its terminals.

![Native preview with synthetic data](../../preview.png)

## Surface

The standard workspace keeps its terminals, Files and Changes. The Sulan toggle opens a 396px sidebar; `mod.json` requests 420px when independently docked. The sidebar contains two tabs: **速览** (brief) and **侧聊** (conversation).

The brief leads with a clear 18px conclusion, followed by a highlighted attention region when there is evidence of a decision or problem. Native `TextView.markdown` renders current progress, key conclusions and the next step in regular 13px text with 21px leading. Bold phrases and inline code carry emphasis. Background and the full older summary are disclosed only on request. There is no terminal statistics page or progress percentage.

The conversation shows the latest question and a Markdown answer, with previous turns collapsed by default. Live requests use the authenticated local Pi Agent service. Tool steps and Thinking are collapsed; partial replies and status remain readable, with Stop and Reconnect controls. A multiline composer stays outside the transcript's scroll region. A long answer must not push the input out of view.

The header **设置** button and the conversation's **模型设置** button open one dedicated full-height settings page. Sulan's summary model and Side Chat's model have separate editable fields and searchable choices from the service's `/v1/models` catalog. The list loads on first opening and has an explicit refresh action. Only 40 matching choices render at once; a bounded scroller and search keep large catalogs readable. A shared service section contains the full endpoint URL and masked API key; a fixed footer has Cancel and Save and return. It is a subpage, not a third main tab.

Use Herdr theme tokens, flat reading sections and restrained borders. Avoid arbitrary rainbow headings, per-line native text elements and nested message cards.

## Data and behavior

- `context.js` selects the active Space and collects bounded screen excerpts from up to four agents using parallel `hc read` calls. It does not execute Git, scan files or collect diffs/commit counts.
- The model prompt merges task evidence into a short result-oriented brief. It does not invent user decisions from a terminal's `blocked` status. Terminal titles alone do not prove completed validation.
- Live projects automatically synthesize a brief when Agent evidence first appears. Poll every 10 seconds, regenerate only for a changed evidence signature or summary model, and coalesce changes within a 30-second minimum interval. Cache the successful signature and target across reloads. Empty projects and the settings subpage do not trigger automatic generation. Manual Update bypasses the cooldown; Rebuild remains in More.
- Preserve the previous document, draft and disclosure state during generation. Failed requests retry automatically with 30-second to 5-minute exponential backoff. Timeout generations reject late replies while collection resumes; the native fetch itself remains uncancellable.
- `main.js` owns state and request generation guards. After context collection, `inView` queues the continuation for the owning View's 250ms callback before starting model IO or persisting results. This avoids native promises resuming in another Mod's ambient scope and leaving a request stuck. Switching tabs changes only the active surface. `view.js` builds only that surface; no hidden summary, diagram, transcript or terminal panel is materialized.
- `brief.js` prepares Markdown hierarchy once when the summary changes. The old summary parser remains compatible with existing stored six-section summaries.
- Settings are validated and saved atomically to the current Mod copy's preferences. Saved values override layout defaults; old chat-only preferences retain their model while the summary uses its installation default. Saving sends no request and affects the next request only; active requests retain a captured configuration. Cancel/Back discard uncommitted settings without clearing the conversation draft.
- Each surface has its own stable scroll id. The multiline draft lives in retained `TextareaState`, survives tab switches, and submits with Ctrl/Command+Enter or Send. Ordinary typing only invalidates the outer sidebar when the Send button changes enabled state.
- Space switches invalidate late brief replies and reconnect the selected Space's Agent job. Agent jobs can continue while another Space is visible; cached job IDs and stable request IDs prevent accidental replay. localStorage belongs to the particular Mod copy. Short RPC deadlines offer Reconnect without imposing a total duration limit on an Agent task.
- Agent sessions are persistent and separate by workspace ID, machine and canonical folder (existing local keys remain compatible). Local workspaces keep coding tools. Remote workspaces use private observer directories with an explicit HC/history/context allowlist: no local filesystem or command tools. Remote terminal addresses are qualified by machine; history from a same-named local folder is excluded. Clear starts a new SDK session while retaining the old archive.
- billion-context runs as the explicit Pi native extension in the service's own directory. Its ownership hook suppresses native automatic compaction only when the current conversation is carried; Pi's original behavior is the fallback. Built-in bili delegation is disabled.
- Inline bili debounces writes for 500ms and does not flush when the host exits immediately. `context-persistence.js` uses the documented replica API to confirm each turn's state, then deletes only its temporary checkpoint. A failed confirmation is a warning on the completed result, never a reason to replay coding actions. Stop during this final confirmation waits for the completed turn.

## Implementation

- `layouts/sulan.json` is a personal adaptation of Herdr's default workspace with a `panel-body` Sulan child.
- `main.js` defaults to sidebar mode. The same Mod with `role: "tabs"` delegates the workspace tab bar to `workspace.js`, adapted under Herdr's Apache-2.0 license.
- `view.js` uses GPUI `Button`, `TextView`, `Textarea` and a scroll area with an adjacent `Scrollbar`. All callbacks use their own `cx`; retained text state is created in init or an event.
- `settings-view.js` renders the settings subpage; `model-settings.js` resolves defaults, migrates prior preferences and validates model/service fields. The masked native `InputState` handles are created lazily in the opening event and are not recreated during render.
- `models.js` performs an authenticated GET of the catalog, preserves proxy prefixes, follows cursor pagination and deduplicates IDs. A 20-second UI deadline, source comparison and request generation prevent late or previous-service results from overwriting the list. Fetch failure keeps manual input available; fetching never changes selected model IDs or sends terminal context.
- `chat.js` parses replies and retains compact UI history, request IDs and tool metadata. `llm.js` generates summaries through Anthropic/OpenAI-compatible endpoints. Default: `http://127.0.0.1:3425/v1/messages`, `auto/deepseek-v4.1-flash`.
- `agent-client.js` sends authenticated start/poll/stop/reset RPCs to the loopback service. One 500ms timer observes active jobs; retained text state and stable document IDs preserve editing behavior.
- `agent/server.js`, `service.js` and `runtime.js` own HTTP authentication, request journals and Pi SDK sessions. `history-tools.js` and `session-history.js` read registered windows and bounded Pi JSONL history. File cursors are byte offsets; large transcripts are streamed instead of loaded wholesale.
- `demo.js` contains synthetic concise content. Do not publish captured real terminal transcripts as preview data.
- `scripts/install-layout.js` copies native UI modules and licenses, refuses existing names and rewrites asset paths for custom names. It reads the service's private connection file and writes credentials only to a private personal layout. The Node service stays in the npm-installed repository.

## Verification

Run `npm ci`, `npm run check`, `npm test` and `herdr-app check mods/sulan`. Use an isolated home/core/display for native checks. Check summary, chat and settings at 396px and 300px, long answers, keyboard activation, loading/failure/retry, rich text and draft preservation. Change both models and verify they restore after restart. Use a local synthetic catalog to search and select different models from a large list.

For Agent verification, use the real SDK and billion-context with a deterministic local SSE model fixture. Observe a tool call, restart the native window while the task is running, then restart the service and continue the same workspace session. Check cancellation, job-journal recovery without replay, workspace separation, compression/decompression and source history paging. These checks do not establish month-long session quality or a fixed token-saving ratio.

The regression host counts actual View calls and element descriptions. Its counts demonstrate eliminated hidden work, not a measured end-to-end frame time. Preserve the active-only rendering test when adding features.
