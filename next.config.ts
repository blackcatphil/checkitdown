import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* THE PHONE HAS TO REACH THE DEV SERVER, AND BY DEFAULT IT CANNOT.
     Next 16 serves dev-only chunks to the hostname the server was started on
     and 403s every other origin. `next dev` prints a LAN URL
     (http://192.168.x.x:3000) that looks like an invitation, but loading it
     from a phone returns a 200 for the page and 403s for the client bundle:
     the map never boots, the canvas stays empty, and there is no error state
     to notice. Measured before this was added — `__cid_map=false`, zero tile
     requests — which is the exact shape of a false negative in a flicker A/B.
     Somebody would have reported "no flicker" against a blank canvas.

     Private ranges only, and only `next dev` reads this key — a production
     build ignores it entirely, so this widens nothing that ships. */
  allowedDevOrigins: [
    /* ⚠️ 127.0.0.1 IS NOT `localhost` TO THIS CHECK, AND THAT COST A RED MAIN.
       `next dev` initialises on `localhost`, so the loopback IP is a different
       origin and gets the same 403 on `/_next/static/chunks/*` that the comment
       above describes for a phone. The page still returns 200 and the server
       HTML is complete — links are present and clickable — so it looks like a
       working page that simply does not respond.

       Every CI probe that reads RENDERED OUTPUT passed against it (test:mixed,
       test:auth, test:mobile). `test:events` is the first suite that depends on
       the client actually MOUNTING, and it failed 18 assertions at once: every
       GREEN half zero, every RED half passing for the wrong reason.

       The evidence was on screen a day earlier and was dismissed. The
       fail-closed probe recorded `403 /_next/static/chunks/…` on this same
       loopback host and a comment there called it "unrelated dev-server noise",
       then scoped the assertion around it. It was not noise; it was this. */
    '127.0.0.1',
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*',
    '*.local',
  ],
};

export default nextConfig;
