const React = window.React;

/* Rank in a ranked table. Three states that must never be confused:
   - the true #1 for the ACTIVE sort → teal, even when the row is dimmed
   - any other ranked row → paper
   - unrankable (unverified figure) → an em dash in the unverified grey */
function RankCell({ rank, isLeader = false, unrankable = false }) {
  const color = unrankable ? 'rgba(242,244,246,.58)' : (isLeader ? '#4FBFAE' : '#F2F4F6');
  return React.createElement('span', {
    style: { font: "600 15px/1 'IBM Plex Mono',monospace", fontVariantNumeric: 'tabular-nums', color }
  }, unrankable ? '\u2014' : '#' + rank);
}
module.exports = { RankCell };
