export interface QuietActionProps {
  label: string;
  onClick?: () => void;
  /** Appends an arrow and signals the link leaves the product. */
  external?: boolean;
  style?: React.CSSProperties;
}
export declare function QuietAction(props: QuietActionProps): JSX.Element;
