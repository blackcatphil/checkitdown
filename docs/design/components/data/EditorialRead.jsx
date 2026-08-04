const React = window.React;

/* Editorial judgement inside a table of sourced facts. Plain text, NO colour,
   and the column head must say EDITORIAL · NOT SORTABLE. */
function EditorialRead({ value, note }) {
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, cursor: 'auto' } },
    React.createElement('span', { style: { font: "500 12.5px/1.3 Archivo,sans-serif", color: 'rgba(242,244,246,.82)' } }, value),
    note ? React.createElement('span', { style: { font: "400 11.5px/1.35 Archivo,sans-serif", color: 'rgba(242,244,246,.58)' } }, note) : null
  );
}
module.exports = { EditorialRead };
