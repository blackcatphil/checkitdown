const React = window.React;

/* An unverified figure: tilde'd, dotted rule, neutral grey. NEVER ochre or gold —
   a warning colour would read as a casino accent and imply a severity we don't mean. */
function UnverifiedFlag({ value }) {
  return React.createElement('span', {
    style: {
      font: "500 13px/1 'IBM Plex Mono',monospace", fontVariantNumeric: 'tabular-nums',
      color: 'rgba(242,244,246,.58)', borderBottom: '1px dotted rgba(242,244,246,.34)', paddingBottom: 2
    }
  }, '~' + value);
}
module.exports = { UnverifiedFlag };
