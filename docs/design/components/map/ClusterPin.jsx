const React = window.React;

/* Rooms too close to separate at city zoom collapse into one pin carrying its count.
   THREE states, because dimming alone cannot survive aggregation. */
function ClusterPin({ total, matching, onClick }) {
  const all = matching === total, none = matching === 0;
  const label = all ? String(total) : matching + '/' + total;
  return React.createElement('div', {
    onClick,
    style: {
      minWidth: 44, height: 44, padding: '0 12px', borderRadius: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      background: all ? '#8A66C9' : (none ? 'rgba(242,244,246,.1)' : 'transparent'),
      border: all ? 'none' : '1.5px solid ' + (none ? 'rgba(242,244,246,.26)' : '#A98CE8'),
      font: "600 13px/1 'IBM Plex Mono',monospace", fontVariantNumeric: 'tabular-nums',
      color: none ? 'rgba(242,244,246,.5)' : '#F2F4F6'
    }
  }, label);
}
module.exports = { ClusterPin };
