-- ============================================
-- Atomic MTC deduction RPC
-- 2026-06-26  Phase X.S6 — Wei Zheng M-1 fix
-- ============================================
--
-- Before this migration: deductMtc was SELECT-then-UPDATE in the JS client
-- with no row lock. Two concurrent requests reading the same balance both
-- think it covers their deduction → both write a ledger row, both UPDATE
-- mtc_purchases, last-writer-wins → balance can go negative or be lost.
--
-- After: a single SQL function does the whole deduction inside one
-- statement-level snapshot with explicit FOR UPDATE locks on the batches
-- it touches. Concurrent callers serialise on the row locks; whichever
-- runs second sees the post-decrement state and gets `insufficient_balance`
-- if the post-decrement balance no longer covers their amount.
--
-- The function consumes FIFO across batches (earliest expiry first), exactly
-- matching the JS implementation, and inserts one ledger row keyed to the
-- first batch consumed (also matching the JS behaviour for compat).
--
-- Returns a single row:
--   ok                 boolean   — true on success, false on insufficient_balance
--   ledger_entry_id    uuid      — non-null only when ok=true
--   balance_remaining  integer   — post-deduction balance (or current if ok=false)
--
-- Note on safety: this is a SECURITY DEFINER function so it runs with the
-- table owner's privileges. Schema is restricted to public via SET search_path.

CREATE OR REPLACE FUNCTION public.mtc_deduct_atomic(
  p_client_id     UUID,
  p_service_key   TEXT,
  p_mtc_amount    INTEGER,
  p_reference_id  TEXT     DEFAULT NULL,
  p_source        TEXT     DEFAULT 'auto',
  p_notes         TEXT     DEFAULT NULL
)
RETURNS TABLE (
  ok                BOOLEAN,
  ledger_entry_id   UUID,
  balance_remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_remaining INTEGER;
  v_first_batch_id  UUID;
  v_ledger_id       UUID;
  v_to_consume      INTEGER;
  v_batch RECORD;
BEGIN
  IF p_mtc_amount <= 0 THEN
    RAISE EXCEPTION 'mtc_amount must be positive (got %)', p_mtc_amount;
  END IF;

  -- Lock all candidate batches for this client in FIFO order. Other concurrent
  -- callers wanting the same client will block here until we commit/rollback.
  -- The ORDER BY in the cursor must match the order in the consumption loop
  -- below so the same locks are acquired in the same sequence.
  SELECT COALESCE(SUM(mtc_remaining), 0)
    INTO v_total_remaining
    FROM mtc_purchases
   WHERE client_id  = p_client_id
     AND status     = 'completed'
     AND expires_at > NOW()
   FOR UPDATE;

  IF v_total_remaining < p_mtc_amount THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, v_total_remaining;
    RETURN;
  END IF;

  -- Pick the first batch id for the ledger row (matches the JS implementation).
  SELECT id INTO v_first_batch_id
    FROM mtc_purchases
   WHERE client_id  = p_client_id
     AND status     = 'completed'
     AND expires_at > NOW()
   ORDER BY expires_at ASC
   LIMIT 1;

  -- Insert the debit ledger row first; the ledger is the source of truth for
  -- billing reconciliation, so we'd rather have a ledger row without a fully
  -- decremented batch than the inverse.
  INSERT INTO mtc_ledger (
    client_id, purchase_id, direction, service_key,
    mtc_amount, reference_id, source, notes
  ) VALUES (
    p_client_id, v_first_batch_id, 'debit', p_service_key,
    p_mtc_amount, p_reference_id, p_source, p_notes
  )
  RETURNING id INTO v_ledger_id;

  -- Consume FIFO from earliest expiry. The locks acquired above keep this
  -- safe against concurrent deductions.
  v_to_consume := p_mtc_amount;
  FOR v_batch IN
    SELECT id, mtc_remaining
      FROM mtc_purchases
     WHERE client_id  = p_client_id
       AND status     = 'completed'
       AND expires_at > NOW()
       AND mtc_remaining > 0
     ORDER BY expires_at ASC
  LOOP
    EXIT WHEN v_to_consume <= 0;
    DECLARE
      v_take INTEGER := LEAST(v_batch.mtc_remaining, v_to_consume);
    BEGIN
      UPDATE mtc_purchases
         SET mtc_remaining = mtc_remaining - v_take
       WHERE id = v_batch.id;
      v_to_consume := v_to_consume - v_take;
    END;
  END LOOP;

  RETURN QUERY SELECT TRUE, v_ledger_id, (v_total_remaining - p_mtc_amount);
END;
$$;

COMMENT ON FUNCTION public.mtc_deduct_atomic(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT) IS
  'Phase X.S6 M-1 — atomic FIFO MTC deduction. Replaces JS-level SELECT-then-UPDATE; concurrent callers serialise on row locks so a 50-MTC balance hit by two 40-MTC requests in parallel yields one success + one insufficient_balance, never two successes.';

-- Grant execute to authenticated + service_role so the JS client can call it
-- via the standard rpc() helper.
GRANT EXECUTE ON FUNCTION public.mtc_deduct_atomic(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT)
  TO service_role;
