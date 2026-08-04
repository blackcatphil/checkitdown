export interface ExclusionNoteProps {
  /** Names the room and the reason, and re-words per active sort. */
  text: string;
  onCorrect?: () => void;
}
export declare function ExclusionNote(props: ExclusionNoteProps): JSX.Element;
