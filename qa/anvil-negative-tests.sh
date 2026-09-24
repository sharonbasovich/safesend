#!/usr/bin/env bash
# SafeSend QA — contract-level checks against a live local Anvil (chain 31337).
# Requires: anvil running, `make deploy-local && make seed` done, foundry in PATH.
set -uo pipefail
export PATH=$HOME/.foundry/bin:$PATH
RPC=http://127.0.0.1:8545
DEP="$(dirname "$0")/../web/src/deployments/31337.json"
ROUTER=$(python3 -c "import json;print(json.load(open('$DEP'))['safeSend'])")
TOKEN=$(python3 -c "import json;print(json.load(open('$DEP'))['mockUSDT'])")

VICTIM=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
VICTIM_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
TERRY=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
ATTACKER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
ATTACKER_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
LOOKALIKE=0x7099deadbeefcafe1234567890abcdef012379c8
AMT=1000000000   # 1,000 mUSDT (6 dp)

PASS=0; FAIL=0
ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }
sel()  { cast sig "$1"; }   # error selector

impersonate() { cast rpc --rpc-url $RPC anvil_impersonateAccount "$1" >/dev/null; cast rpc --rpc-url $RPC anvil_setBalance "$1" 0xde0b6b3a7640000 >/dev/null; }
stop_imp()    { cast rpc --rpc-url $RPC anvil_stopImpersonatingAccount "$1" >/dev/null; }
warp()        { cast rpc --rpc-url $RPC evm_increaseTime "$1" >/dev/null; cast rpc --rpc-url $RPC evm_mine >/dev/null; }
bal()         { cast call --rpc-url $RPC $TOKEN "balanceOf(address)(uint256)" "$1" | awk '{print $1}'; }
transfer()    { cast call --rpc-url $RPC $ROUTER "transfers(uint256)(address,address,address,uint128,uint64,uint8,uint8)" "$1" | sed 's/ \[.*\]$//'; }

# expect_revert <selector-name> -- <cast send args…>
expect_revert() {
  local name=$1; shift; shift
  local out; out=$(cast send --rpc-url $RPC "$@" 2>&1)
  local s; s=$(sel "$name()")
  if echo "$out" | grep -qi "$name\|${s}"; then ok "reverted with $name"; else bad "expected $name; got: $(echo "$out" | head -3)"; fi
}

echo "router=$ROUTER token=$TOKEN"
echo; echo "== 0. preconditions"
V=$(cast call --rpc-url $RPC $ROUTER "verified(address,address)(bool)" $VICTIM $TERRY)
[ "$V" = "true" ] && ok "Terry is verified for victim" || bad "Terry not verified"
L=$(cast call --rpc-url $RPC $ROUTER "isLookalike(address,address)(bool)" $VICTIM $LOOKALIKE)
[ "$L" = "true" ] && ok "isLookalike(victim, $LOOKALIKE) == true" || bad "lookalike not detected"

echo; echo "== 1. flagged send → LookalikeFlagged, 24h lock"
ID=$(cast call --rpc-url $RPC $ROUTER "nextId()(uint256)")
B0=$(bal $VICTIM)
TX=$(cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "send(address,address,uint128)" $TOKEN $LOOKALIKE $AMT --json)
LOGS=$(echo "$TX" | python3 -c "import json,sys;r=json.load(sys.stdin);print(' '.join(l['topics'][0] for l in r['logs']))")
FLAG_SIG=$(cast keccak "LookalikeFlagged(uint256,address,address,uint32)")
echo "$LOGS" | grep -qi "$FLAG_SIG" && ok "LookalikeFlagged emitted for escrow #$ID" || bad "no LookalikeFlagged"
T=$(transfer $ID); echo "$T" | sed 's/^/    /'
UNLOCK=$(echo "$T" | sed -n 5p); NOW=$(cast block --rpc-url $RPC latest -f timestamp)
[ $((UNLOCK-NOW)) -ge 86300 ] && ok "unlockAt ≈ now+24h ($((UNLOCK-NOW))s)" || bad "unlock delta $((UNLOCK-NOW))"
[ "$(echo "$T" | sed -n 7p)" = "1" ] && ok "reason == LookalikeOfVerified" || bad "reason"
[ $((B0-$(bal $VICTIM))) -eq $AMT ] && ok "1,000 mUSDT pulled from victim into escrow" || bad "balance delta"

echo; echo "== 2. claim before unlock → Locked (recipient, impersonated)"
impersonate $LOOKALIKE
expect_revert Locked -- --unlocked --from $LOOKALIKE $ROUTER "claim(uint256)" $ID
echo; echo "== 3. time-travel past 24h; unapproved claim → NotApproved"
warp 86401
NOW=$(cast block --rpc-url $RPC latest -f timestamp); [ "$NOW" -ge "$UNLOCK" ] && ok "chain time past unlockAt" || bad "warp"
expect_revert NotApproved -- --unlocked --from $LOOKALIKE $ROUTER "claim(uint256)" $ID
[ "$(cast call --rpc-url $RPC $ROUTER "verified(address,address)(bool)" $VICTIM $LOOKALIKE)" = "false" ] && ok "lookalike NOT verified after blocked claim" || bad "lookalike got verified"
echo; echo "== 4. approveLookalike by non-sender → NotSender"
expect_revert NotSender -- --unlocked --from $LOOKALIKE $ROUTER "approveLookalike(uint256)" $ID   # recipient self-approve
stop_imp $LOOKALIKE
expect_revert NotSender -- --private-key $ATTACKER_KEY $ROUTER "approveLookalike(uint256)" $ID    # third party
[ "$(cast call --rpc-url $RPC $ROUTER "lookalikeApproved(uint256)(bool)" $ID)" = "false" ] && ok "lookalikeApproved still false" || bad "approved flag flipped"
echo; echo "== 5. non-recipient claim → NotRecipient; third-party cancel → NotSender"
expect_revert NotRecipient -- --private-key $ATTACKER_KEY $ROUTER "claim(uint256)" $ID
expect_revert NotSender    -- --private-key $ATTACKER_KEY $ROUTER "cancel(uint256)" $ID

echo; echo "== 6. sender cancel after unlock (unapproved) → full refund"
B1=$(bal $VICTIM)
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "cancel(uint256)" $ID >/dev/null && ok "cancel tx ok"
[ $(( $(bal $VICTIM) - B1 )) -eq $AMT ] && ok "victim refunded 1,000 mUSDT" || bad "refund"
[ "$(transfer $ID | sed -n 6p)" = "2" ] && ok "status == Cancelled" || bad "status"
impersonate $LOOKALIKE
expect_revert NotPending -- --unlocked --from $LOOKALIKE $ROUTER "claim(uint256)" $ID
stop_imp $LOOKALIKE

echo; echo "== 7. second flagged escrow: approve → cancel still works (refund)"
ID2=$(cast call --rpc-url $RPC $ROUTER "nextId()(uint256)")
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "send(address,address,uint128)" $TOKEN $LOOKALIKE $AMT >/dev/null
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "approveLookalike(uint256)" $ID2 --json | python3 -c "import json,sys;r=json.load(sys.stdin);print('    approve status',r['status'],'logs',len(r['logs']))"
[ "$(cast call --rpc-url $RPC $ROUTER "lookalikeApproved(uint256)(bool)" $ID2)" = "true" ] && ok "escrow #$ID2 approved" || bad "approve"
echo "  -- approved but still locked: claim → Locked"
impersonate $LOOKALIKE
expect_revert Locked -- --unlocked --from $LOOKALIKE $ROUTER "claim(uint256)" $ID2
stop_imp $LOOKALIKE
B2=$(bal $VICTIM)
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "cancel(uint256)" $ID2 >/dev/null
[ $(( $(bal $VICTIM) - B2 )) -eq $AMT ] && ok "cancel after approval refunds sender" || bad "refund after approval"

echo; echo "== 8. third flagged escrow: approve + 24h → claim succeeds → lookalike becomes VERIFIED (future sends instant)"
ID3=$(cast call --rpc-url $RPC $ROUTER "nextId()(uint256)")
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "send(address,address,uint128)" $TOKEN $LOOKALIKE $AMT >/dev/null
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "approveLookalike(uint256)" $ID3 >/dev/null
warp 86401
impersonate $LOOKALIKE
LB=$(bal $LOOKALIKE)
TX=$(cast send --rpc-url $RPC --unlocked --from $LOOKALIKE $ROUTER "claim(uint256)" $ID3 --json)
stop_imp $LOOKALIKE
PV_SIG=$(cast keccak "PayeeVerified(address,address)")
echo "$TX" | python3 -c "import json,sys;r=json.load(sys.stdin);print(' '.join(l['topics'][0] for l in r['logs']))" | grep -qi "$PV_SIG" && ok "PayeeVerified emitted on claim" || bad "no PayeeVerified"
[ $(( $(bal $LOOKALIKE) - LB )) -eq $AMT ] && ok "lookalike received 1,000 mUSDT" || bad "payout"
[ "$(cast call --rpc-url $RPC $ROUTER "verified(address,address)(bool)" $VICTIM $LOOKALIKE)" = "true" ] && ok "verified(victim, lookalike) == true  ← future-trust consequence" || bad "not verified"
ID4=$(cast call --rpc-url $RPC $ROUTER "nextId()(uint256)")
LB=$(bal $LOOKALIKE)
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "send(address,address,uint128)" $TOKEN $LOOKALIKE 5000000 >/dev/null
[ "$(cast call --rpc-url $RPC $ROUTER "nextId()(uint256)")" = "$ID4" ] && [ $(( $(bal $LOOKALIKE) - LB )) -eq 5000000 ] && ok "subsequent send to lookalike is INSTANT (no escrow)" || bad "subsequent send not instant"
FP=$(cast call --rpc-url $RPC $ROUTER "fingerprint(address)(uint32)" $TERRY | awk '{print $1}')
echo "  fpCount(victim, fp(Terry)=$FP) = $(cast call --rpc-url $RPC $ROUTER "fpCount(address,uint32)(uint16)" $VICTIM $FP)  (Terry + lookalike now both verified with the same fingerprint)"

echo; echo "== 9. edge: UnknownPayee escrow created BEFORE a colliding payee is added → claim needs no approval"
X=0x3c440000000000000000000000000000abcd93bc   # collides with Attacker 0x3C44…93BC
IDX=$(cast call --rpc-url $RPC $ROUTER "nextId()(uint256)")
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "send(address,address,uint128)" $TOKEN $ATTACKER 1000000 >/dev/null
[ "$(transfer $IDX | sed -n 7p)" = "0" ] && ok "escrow #$IDX reason=UnknownPayee (attacker not yet a lookalike)" || bad "reason"
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "addPayee(address)" $X >/dev/null
[ "$(cast call --rpc-url $RPC $ROUTER "isLookalike(address,address)(bool)" $VICTIM $ATTACKER)" = "true" ] && ok "attacker is now a lookalike of a verified payee" || bad "isLookalike"
warp 61
OUT=$(cast send --rpc-url $RPC --private-key $ATTACKER_KEY $ROUTER "claim(uint256)" $IDX 2>&1)
echo "$OUT" | grep -q "status.*1 (success)" && echo "  NOTE: claim by now-lookalike attacker succeeded WITHOUT approval (reason is fixed at send time) — see report" || echo "  claim failed: $(echo "$OUT" | head -2)"
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "removePayee(address)" $X >/dev/null

echo; echo "== 10. ETH path sanity: flagged ETH escrow cancel refunds"
IDE=$(cast call --rpc-url $RPC $ROUTER "nextId()(uint256)")
L2=0x7099aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa79c8
E0=$(cast balance --rpc-url $RPC $VICTIM)
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "send(address,address,uint128)" 0x0000000000000000000000000000000000000000 $L2 1000000000000000000 --value 1ether >/dev/null
[ "$(transfer $IDE | sed -n 7p)" = "1" ] && ok "ETH send to fresh lookalike flagged" || bad "eth flag"
cast send --rpc-url $RPC --private-key $VICTIM_KEY $ROUTER "cancel(uint256)" $IDE >/dev/null
E1=$(cast balance --rpc-url $RPC $VICTIM)
python3 -c "import sys; d=$E0-$E1; sys.exit(0 if d < 10**16 else 1)" && ok "ETH refunded (net cost = gas only)" || bad "ETH refund"

echo; echo "RESULT: $PASS passed, $FAIL failed"
