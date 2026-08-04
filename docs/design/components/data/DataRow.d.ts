export interface DataRowProps {
  label: string;
  value: string;
  /** Where the fact came from, e.g. "ROOM PAGE". */
  source?: string;
  /** How old it is, e.g. "2 DAYS AGO". Derive from a real number, never a string. */
  fresh?: string;
  unverified?: boolean;
}
export declare function DataRow(props: DataRowProps): JSX.Element;
