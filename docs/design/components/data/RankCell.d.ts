export interface RankCellProps {
  rank: number;
  /** True only for rank 1 of the ACTIVE sort — never for a category winner elsewhere. */
  isLeader?: boolean;
  /** The figure behind this sort is unverified, so the row cannot hold a position. */
  unrankable?: boolean;
}
export declare function RankCell(props: RankCellProps): JSX.Element;
