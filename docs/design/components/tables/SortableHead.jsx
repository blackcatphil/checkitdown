const React = window.React;

/* Sticky table header cell. Sort controls live HERE, next to the column they sort —
   not in a toolbar above the table. */
function SortableHead({ label, sortable = true, active = false, subhead, onClick }) {
  return React.createElement('div', {
    onClick: sortable ? onClick : undefined,
    style: {
      display: 'flex', flexDirection: 'column', gap: 4, minHeight: 44,
      justifyContent: 'flex-end', paddingBottom: 10,
      cursor: sortable ? 'pointer' : 'auto'
    }
  },
    React.createElement('span', {
      style: {
        font: "600 10px/1.2 'IBM Plex Mono',monospace", letterSpacing: '.16em',
        color: active ? '#F2F4F6' : 'rgba(242,244,246,.58)'
      }
    }, label + (active ? ' \u2193' : '')),
    subhead ? React.createElement('span', {
      style: { font: "500 8.5px/1.2 'IBM Plex Mono',monospace", letterSpacing: '.14em', color: 'rgba(242,244,246,.58)' }
    }, subhead) : null
  );
}
module.exports = { SortableHead };
