# Local design preview

Run `npm run dev:client` and open <http://127.0.0.1:5173/dev/lounge>.

The preview uses the production hub, lobby, profile, settings, friends, board, and hand components with sample data. Use the bottom switcher to compare screens; **Test invite** displays the recipient's notification. Game controls are for visual inspection, not a multiplayer simulation. Profile and settings edits only affect this preview's memory.

No authentication or backend is required. The preview does not use account APIs, create rooms, or consume a pending sign-in intent. Vite's `import.meta.env.DEV` guard excludes its module and sample records from the production client bundle.

The real app is at `/play` and still uses the existing `/api` and `/ws` proxies to port 3000.

The collapsed **Preview** menu at the top switches between Hub, Lobby and Game. Enable **Concept terrain & ocean** to compare the simpler atlas on the same island; disable it to return to current production art. **Show sample awards** puts both award badges on sample profiles for inspection. These are visual fixtures, not a live rules simulation.

**Players** seats five or six at the sample table, as Big Table will, so the lobby, the player rail, the trade panel, the robber's lists and the results can be checked without a server. The fifth seat has a long name and holds Largest Army, the sixth a short one, Juniper is away, and your card shows a live turn timer. The extra seats join after setup, because the rules still deal four at most. **Open offer, mixed answers** fills the trade panel with proposals, a refusal and a wait, and **Results screen** opens the results with the same number of players.

Add `?board=big-table`, `?board=isles3` or `?board=isles4` to deal the sample game on a Big Table island or an Outer Isles board for three or four players instead of the Classic island. The boards are dealt by hand in `sample-boards.ts`, as the map docs describe them; the Outer Isles ones carry sample ships in several colours and the pirate, and `&pirate=q,r` moves the pirate to the hex at q,r, such as `&pirate=2,-3` beside a crowded harbour on `isles4`. The engine has no Open Sea rules yet, so the pieces are placed directly and dice events there still follow Classic rules. **Players** is offered on the boards that seat four, so not on `isles3`.

The game preview uses the shared GameTools menu: History and Connection remain visible, while help, game rules, sound, fullscreen and leaving are grouped under Menu. Preview history and ping values are sample data. Lobby leaving uses the same confirmation sheet as real rooms.

Open <http://127.0.0.1:5173/dev/results> to inspect the game-over screen immediately
(`?players=5` or `?players=6` for a Big Table's results).
It uses sample standings and the real results/lobby components. Return to lobby
shows the sample room; Previous results reopens the screen. No live match is created.
