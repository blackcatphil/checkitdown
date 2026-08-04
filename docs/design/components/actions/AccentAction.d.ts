export interface AccentActionProps {
  /** Mono, uppercase, letter-spaced. Name the outcome: ADD TO COMPARE, ADD TO CALENDAR. */
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export declare function AccentAction(props: AccentActionProps): JSX.Element;
