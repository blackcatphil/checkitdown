const React = window.React;

/* A single room. Filtering DIMS, never removes — a room that vanishes reads as
   "we don't have it" instead of "it doesn't match". */
function RoomPin({ label, matching = true, selected = false, onClick, onDoubleClick }) {
  return React.createElement('div', {
    onClick, onDoubleClick,
    style: {
      minWidth: 44, minHeight: 44, padding: '10px 12px', borderRadius: 3,
      display: 'flex', alignItems: 'center', cursor: 'pointer',
      opacity: matching ? 1 : 0.2,
      background: selected ? '#5E3A93' : 'rgba(20,23,27,.92)',
      border: '1px solid ' + (selected ? '#A98CE8' : 'rgba(242,244,246,.16)'),
      font: "500 12px/1 Archivo,sans-serif", color: '#F2F4F6', whiteSpace: 'nowrap'
    }
  }, label);
}
module.exports = { RoomPin };
