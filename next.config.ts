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
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*',
    '*.local',
  ],
};

export default nextConfig;
