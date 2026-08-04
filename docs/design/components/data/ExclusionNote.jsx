const React = window.React;

/* Names the room excluded from a ranking and why. Never a count
   ("1 room excluded" is a hedge; naming it is a correction prompt). */
function ExclusionNote({ text, onCorrect }) {
  return React.createElement('div', {
    style: {
      padding: '12px 14px', background: 'rgba(242,244,246,.04)', borderLeft: '2px solid rgba(242,244,246,.28)',
      display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap'
    }
  },
    React.createElement('span', { style: { font: "500 12.5px/1.45 Archivo,sans-serif", color: 'rgba(242,244,246,.82)' } }, text),
    React.createElement('span', {
      onClick: onCorrect,
      style: { font: "500 11px/1 Archivo,sans-serif", color: 'rgba(242,244,246,.72)', borderBottom: '1px solid rgba(242,244,246,.3)', cursor: 'pointer' }
    }, 'Report a correction')
  );
}
module.exports = { ExclusionNote };
