# GlancePopup

The single-click card over the map: name, distance, the two or three facts that decide
whether to look further, the room's URL path, and an explicit **OPEN FULL DETAILS**
button at 44px.

**It must never be the only way to open a room.** Everything reachable by hovering or
by a popup needs a second path — mobile is deferred, not cancelled.

Owns a lane the compare tray cannot enter. Verify with `elementFromPoint` at the CTA's
and the freshness line's left edges, not by looking at a screenshot.
