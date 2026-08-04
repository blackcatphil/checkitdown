const React = window.React;

/* label / value spec pair, with optional source + freshness. House rules, comps,
   amenities and practical basics are all this shape. */
function DataRow({ label, value, source, fresh, unverified = false }) {
  return React.createElement('div', {
    style: {
      display: 'grid', gridTemplateColumns: 'minmax(0,190px) minmax(0,1fr) minmax(0,220px)',
      gap: 20, padding: '15px 2px', borderBottom: '1px solid rgba(242,244,246,.09)', alignItems: 'baseline'
    }
  },
    React.createElement('span', { style: { font: "600 11px/1.3 'IBM Plex Mono',monospace", letterSpacing: '.13em', color: 'rgba(242,244,246,.58)' } }, label),
    React.createElement('span', {
      style: {
        font: "400 13.5px/1.5 Archivo,sans-serif", color: unverified ? 'rgba(242,244,246,.58)' : '#F2F4F6',
        borderBottom: unverified ? '1px dotted rgba(242,244,246,.34)' : 'none'
      }
    }, unverified ? '~' + value : value),
    React.createElement('span', { style: { font: "500 11px/1.4 'IBM Plex Mono',monospace", letterSpacing: '.1em', color: 'rgba(242,244,246,.58)' } },
      [source, fresh].filter(Boolean).join(' \u00b7 '))
  );
}
module.exports = { DataRow };
