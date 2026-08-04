export interface RoomPinProps {
  label: string;
  /** False dims to 0.2 — the pin stays on the map. */
  matching?: boolean;
  selected?: boolean;
  /** Single click opens the glance popup. */
  onClick?: () => void;
  /** Double click opens the full detail card. */
  onDoubleClick?: () => void;
}
export declare function RoomPin(props: RoomPinProps): JSX.Element;
