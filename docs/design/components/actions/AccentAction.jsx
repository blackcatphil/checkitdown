const React = window.React;

/* The ONE filled action on a screen. Aubergine fill + a 1px lit top edge.
   If a second one appears, one of them is wrong — demote it to QuietAction. */
function AccentAction({ label, onClick, disabled = false, style = {} }) {
  const [hover, setHover] = React.useState(false);
  return React.createElement('button', {
    onClick: disabled ? undefined : onClick,
    disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      minHeight: 44, padding: '15px 22px', borderRadius: 3, border: 0,
      borderTop: '1px solid #A98CE8',
      background: disabled ? 'rgba(94,58,147,.35)' : (hover ? '#6D45A8' : '#5E3A93'),
      font: "600 11.5px/1 'IBM Plex Mono',monospace", letterSpacing: '.15em',
      color: disabled ? 'rgba(242,244,246,.5)' : '#F2F4F6',
      cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', ...style
    }
  }, label);
}
module.exports = { AccentAction };
