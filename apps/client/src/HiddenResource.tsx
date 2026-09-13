import { GameIcon } from './GameIcons.js';
export function HiddenResource() {
  return (
    <GameIcon
      name="cards"
      className="hidden-resource-art"
      width="30"
      height="36"
      role="img"
      aria-label="Hidden resource"
      aria-hidden={undefined}
    />
  );
}
