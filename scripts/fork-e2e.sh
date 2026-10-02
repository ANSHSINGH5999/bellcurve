#!/usr/bin/env bash
# Full BellCurve lifecycle against *mainnet state* on a local validator, at zero cost:
# real DBC + DAMM v2 programs, real NVDAx mint (mint authority patched locally so we can mint test NVDAx),
# real DBC, DAMM v2 and DLMM TokenBadges for NVDAx. Then: launch -> first buy -> buy -> sell -> claim -> fill -> migrate to DAMM v2.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=$(mktemp -d)
NVDAX=Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh
ids=$(node -e "
const s=require('@meteora-ag/dynamic-bonding-curve-sdk'),{PublicKey}=require('@solana/web3.js'),m=new PublicKey('$NVDAX')
console.log(s.deriveTokenBadgeAddress(m).toBase58(),
  PublicKey.findProgramAddressSync([Buffer.from('token_badge'),m.toBuffer()],s.DAMM_V2_PROGRAM_ID)[0].toBase58(),
  s.deriveDbcPoolAuthority().toBase58(), s.DAMM_V2_MIGRATION_FEE_ADDRESS[6].toBase58(),
  require('@meteora-ag/dlmm').deriveTokenBadge(m, new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'))[0].toBase58(),
  require('@solana/web3.js').Keypair.fromSecretKey(Uint8Array.from(require(process.env.HOME+'/.config/solana/id.json'))).publicKey.toBuffer().toString('hex'))")
read -r DBC_BADGE DAMM_BADGE POOL_AUTH DAMM_CONFIG DLMM_BADGE ME_HEX <<<"$ids"
solana account $NVDAX -um --output json --output-file "$DIR/mint.json" >/dev/null
python3 - "$DIR/mint.json" "$ME_HEX" <<'PY'
import json,base64,sys
f,me=sys.argv[1:]; j=json.load(open(f)); d=bytearray(base64.b64decode(j['account']['data'][0]))
d[4:36]=bytes.fromhex(me); j['account']['data'][0]=base64.b64encode(d).decode(); json.dump(j,open(f,'w'))
PY
solana-test-validator --reset --quiet -l "$DIR/ledger" -um \
  --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN \
  --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
  --clone-upgradeable-program LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone-upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --clone "$DBC_BADGE" --clone "$DAMM_BADGE" --clone "$POOL_AUTH" --clone "$DAMM_CONFIG" --clone "$DLMM_BADGE" \
  --account $NVDAX "$DIR/mint.json" >"$DIR/validator.log" 2>&1 &
VAL=$!
trap 'kill $VAL 2>/dev/null' EXIT
until solana cluster-version -ul >/dev/null 2>&1; do sleep 1; done
tsx scripts/fork-e2e.ts
if [ -n "${KEEP:-}" ]; then echo "validator kept running (KEEP=1)"; wait $VAL; fi
