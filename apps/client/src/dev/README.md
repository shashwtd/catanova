# Local design preview

Run `npm run dev:client` and open <http://127.0.0.1:5173/dev/lounge>.

The preview uses the production hub, lobby, profile, settings, friends, board, and hand components with sample data. Use the bottom switcher to compare screens; **Test invite** displays the recipient's notification. Game controls are for visual inspection, not a multiplayer simulation. Profile and settings edits only affect this preview's memory.

No authentication or backend is required. The preview does not use account APIs, create rooms, or consume a pending sign-in intent. Vite's `import.meta.env.DEV` guard excludes its module and sample records from the production client bundle.

The real app is at `/play` and still uses the existing `/api` and `/ws` proxies to port 3000.
