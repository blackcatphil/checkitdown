export interface ClusterPinProps {
  total: number;
  /** How many of the clustered rooms pass the active filter. */
  matching: number;
  onClick?: () => void;
}
export declare function ClusterPin(props: ClusterPinProps): JSX.Element;
