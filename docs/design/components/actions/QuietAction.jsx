const React = window.React;

/* Secondary action: an underlined text run, not a button. Used for
   "Report a correction", "Clear set", external links. Never colour-filled.

   The 44px hit area lives on the WRAPPER and the rule lives on an inner
   span. Putting both on one element centres the text in a 44px box while
   the border still paints on the box edge, detaching the rule from the
   words by ~16px. */
function QuietAction({ label, onClick, external = false, style = {} }) {
  const [hover, setHover] = React.useState(false);
  return React.createElement('span', {
    onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex', alignItems: 'center', minHeight: 44,
      cursor: 'pointer', ...style
    }
  }, React.createElement('span', {
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 6,
      font: "500 12px/1 Archivo,sans-serif",
      color: hover ? '#F2F4F6' : 'rgba(242,244,246,.72)',
      paddingBottom: 3,
      borderBottom: '1px solid ' + (hover ? 'rgba(242,244,246,.28)' : 'rgba(242,244,246,.24)')
    }
  }, label, external ? React.createElement('span', { style: { font: "500 11px/1 'IBM Plex Mono',monospace" } }, '\u2197') : null));
}
module.exports = { QuietAction };
