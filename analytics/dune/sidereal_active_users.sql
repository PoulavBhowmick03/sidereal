-- SPDX-License-Identifier: Apache-2.0
--
-- Sidereal active users on Stellar, native Dune tables.
--
-- This query counts distinct transaction source accounts that successfully
-- touched any Sidereal contract by emitting a Soroban contract event. It is the
-- cleanest Dune-native proxy for "users" once Sidereal is on a Dune-indexed
-- Stellar network. For synthetic testnet cohorts, use
-- sidereal_cohort_uploaded_user_count.sql instead.
--
-- Dune parameters:
--   {{start_date}}  Example: 2026-07-01
--   {{end_date}}    Example: 2026-08-01

WITH sidereal_contracts(contract_name, contract_id) AS (
  VALUES
    ('underlying', 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU'),
    ('sy_wrapper', 'CCIBE7PR6YYZEIP5ISUCBGYT3ABF2UVQTJIWD6JAP5U7JX4QQCV6HXSN'),
    ('pt_token', 'CBKJJDZ6HRRPAZQQJG3TZNAWBYXOM4FODD3K4ZTTLSQPUNRIVGVEX2NP'),
    ('yt_token', 'CCNUVCKPGZHUH4AMGZQHUFQJQWC5RKNAU66FPJGGMF2ZVIESVABTSGDB'),
    ('tokenizer', 'CDUQRPYG5OKTVXMG7JWYA7FZEBLQEWUHQGCKLAKXKHWWOYRJ4SIQOTXR'),
    ('amm', 'CCAHVBXVU4VKU7WHYUJ3FH5NKOL7DPVAKA6FKPIQ6P56FUVUXLGTFWJ2')
),
sidereal_txs AS (
  SELECT DISTINCT
    tx.transaction_hash,
    tx.account AS wallet,
    tx.closed_at,
    date_trunc('day', tx.closed_at) AS day
  FROM stellar.history_contract_events events
  JOIN stellar.history_transactions tx
    ON tx.id = events.transaction_id
  JOIN sidereal_contracts contracts
    ON contracts.contract_id = events.contract_id
  WHERE events.successful
    AND events.in_successful_contract_call
    AND tx.successful
    AND tx.closed_at >= CAST('{{start_date}}' AS timestamp)
    AND tx.closed_at < CAST('{{end_date}}' AS timestamp)
),
daily AS (
  SELECT
    day,
    count(DISTINCT wallet) AS daily_active_users,
    count(DISTINCT transaction_hash) AS successful_transactions
  FROM sidereal_txs
  GROUP BY 1
),
first_seen AS (
  SELECT
    wallet,
    min(day) AS first_day
  FROM sidereal_txs
  GROUP BY 1
),
running_users AS (
  SELECT
    daily.day,
    count(DISTINCT first_seen.wallet) AS cumulative_unique_users
  FROM daily
  JOIN first_seen
    ON first_seen.first_day <= daily.day
  GROUP BY 1
)
SELECT
  daily.day,
  daily.daily_active_users,
  running_users.cumulative_unique_users,
  daily.successful_transactions
FROM daily
JOIN running_users USING (day)
ORDER BY daily.day;
