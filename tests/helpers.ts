import { Store } from '../apps/server/src/store.js';
export function readyLobby(store: Store, roomId: string) {
  for (const p of store.snapshot(roomId).players)
    store.lobby({ ...p, room_id: roomId }, `ready-${p.id}`, store.snapshot(roomId).revision, true);
  return store.snapshot(roomId).revision;
}
