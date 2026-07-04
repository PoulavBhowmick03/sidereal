-- SPDX-License-Identifier: Apache-2.0
--
-- Sidereal cohort/testnet user count from uploaded simulation events.
--
-- Upload events with:
--   DUNE_API_KEY=... DUNE_NAMESPACE=<your_namespace> \
--     node scripts/dune-upload-cohort-events.mjs artifacts/cohort-runs/<run>/events.jsonl
--
-- Then replace dune.<namespace>.sidereal_cohort_events below with your Dune
-- upload table path.
--
-- Dune parameters:
--   {{run_id}}  Example: 2026-07-04-cohort

WITH events AS (
  SELECT *
  FROM dune.<namespace>.sidereal_cohort_events
  WHERE run_id = '{{run_id}}'
    AND synthetic = true
),
daily AS (
  SELECT
    date_trunc('day', occurred_at) AS day,
    count(DISTINCT wallet) AS daily_active_synthetic_users,
    count(DISTINCT CASE WHEN tx_hash IS NOT NULL AND tx_hash <> '' THEN tx_hash END) AS landed_transactions,
    count(*) AS recorded_events
  FROM events
  WHERE successful = true
  GROUP BY 1
),
first_seen AS (
  SELECT
    wallet,
    min(date_trunc('day', occurred_at)) AS first_day
  FROM events
  WHERE successful = true
  GROUP BY 1
),
running_users AS (
  SELECT
    daily.day,
    count(DISTINCT first_seen.wallet) AS cumulative_synthetic_users
  FROM daily
  JOIN first_seen
    ON first_seen.first_day <= daily.day
  GROUP BY 1
)
SELECT
  daily.day,
  daily.daily_active_synthetic_users,
  running_users.cumulative_synthetic_users,
  daily.landed_transactions,
  daily.recorded_events
FROM daily
JOIN running_users USING (day)
ORDER BY daily.day;
