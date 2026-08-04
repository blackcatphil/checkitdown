export interface SortableHeadProps {
  label: string;
  /** False for editorial columns — also set subhead to "EDITORIAL · NOT SORTABLE". */
  sortable?: boolean;
  active?: boolean;
  subhead?: string;
  onClick?: () => void;
}
export declare function SortableHead(props: SortableHeadProps): JSX.Element;
