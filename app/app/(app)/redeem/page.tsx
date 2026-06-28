// SPDX-License-Identifier: Apache-2.0

import { permanentRedirect } from "next/navigation";

// The redeem surface was renamed to Portfolio. Keep this thin route so existing
// /redeem links (docs, bookmarks) survive: a permanent (308) server-side
// redirect to /portfolio, matching the route rename.
export default function RedeemRedirect() {
  permanentRedirect("/portfolio");
}
