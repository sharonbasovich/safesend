// SafeSend demo driver — drives the already-running Chrome (CDP :29229) against
// the local Anvil stack and injects on-screen captions. Local mock money only.
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const APP = "http://localhost:5173/?demo=1";
const LOOKALIKE = "0x7099deadbeefcafe1234567890abcdef012379c8";
const ATTACKER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const PACE = Number(process.env.PACE ?? 1); // >1 slows everything down
const CAST = `${process.env.HOME}/.foundry/bin/cast`;

const t0 = Date.now();
const scenes = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * PACE));
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1);

const browser = await chromium.connectOverCDP("http://localhost:29229");
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().startsWith("http://localhost:5173"));
if (!page) page = await ctx.newPage();
await page.goto(APP, { waitUntil: "networkidle" });
await page.bringToFront();

// ---------- overlay helpers ----------
await page.evaluate(() => {
  const css = document.createElement("style");
  css.textContent = `
  #dm-cap{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);max-width:88vw;
    background:rgba(9,9,11,.92);color:#f4f4f5;border:1px solid #3f3f46;border-radius:14px;
    padding:16px 26px;font:600 26px/1.35 "DejaVu Sans",system-ui,sans-serif;text-align:center;
    z-index:99999;box-shadow:0 10px 40px rgba(0,0,0,.6);opacity:0;transition:opacity .35s}
  #dm-cap b{color:#fbbf24}
  #dm-cap code{font-family:"DejaVu Sans Mono",monospace;font-size:22px;color:#a5b4fc}
  #dm-card{position:fixed;inset:0;background:#09090b;color:#fafafa;z-index:100000;display:flex;
    flex-direction:column;align-items:center;justify-content:center;gap:22px;text-align:center;
    font-family:"DejaVu Sans",system-ui,sans-serif;opacity:0;transition:opacity .5s;padding:60px;pointer-events:none}
  #dm-card.on{pointer-events:auto}
  #dm-cap{pointer-events:none}
  #dm-card h1{font-size:64px;margin:0;letter-spacing:-1px}
  #dm-card h2{font-size:30px;margin:0;color:#a1a1aa;font-weight:400;max-width:1200px}
  #dm-card p{font-size:22px;color:#71717a;margin:0}
  #dm-cur{position:fixed;width:34px;height:34px;border-radius:50%;border:3px solid #fbbf24;
    background:rgba(251,191,36,.25);z-index:100001;pointer-events:none;transform:translate(-50%,-50%);
    transition:left .45s ease,top .45s ease;left:50vw;top:50vh;opacity:0}
  #dm-cur.click{animation:dmpulse .35s ease}
  @keyframes dmpulse{0%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(.6)}100%{transform:translate(-50%,-50%) scale(1)}}
  #dm-badge{position:fixed;top:14px;right:16px;z-index:99998;background:rgba(9,9,11,.85);
    border:1px solid #3f3f46;border-radius:10px;padding:8px 14px;color:#a1a1aa;
    font:500 15px "DejaVu Sans Mono",monospace}
  #dm-term{position:fixed;right:20px;top:220px;width:500px;z-index:99998;background:#0b0f14;
    border:1px solid #334155;border-radius:12px;padding:16px 18px;color:#cbd5e1;white-space:pre-wrap;
    font:500 16px/1.45 "DejaVu Sans Mono",monospace;box-shadow:0 10px 40px rgba(0,0,0,.6);
    opacity:0;transition:opacity .35s;pointer-events:none}
  #dm-term .p{color:#64748b}#dm-term .c{color:#e2e8f0}#dm-term .e{color:#f87171;font-weight:700}#dm-term .ok{color:#34d399;font-weight:700}
  body{zoom:1.35}
  html{overflow:hidden}
  .fixed.bottom-4.right-4.w-96{bottom:auto;top:44px;right:12px}
  `;
  document.head.appendChild(css);
  for (const id of ["dm-cap", "dm-card", "dm-cur", "dm-badge", "dm-term"]) {
    const d = document.createElement("div");
    d.id = id;
    document.documentElement.appendChild(d);
  }
  document.getElementById("dm-badge").textContent = "local Anvil · chain 31337 · mock mUSDT · synthetic addresses";
});

const RPC = "http://127.0.0.1:8545";
const SAFESEND = JSON.parse(
  (await import("node:fs")).readFileSync(new URL("../web/src/deployments/31337.json", import.meta.url), "utf8")
).safeSend;
// Runs a real impersonated cast call and returns the (decoded) revert name or tx hash.
function castAs(from, sig, ...args) {
  const run = (c) => execSync(c, { stdio: ["ignore", "pipe", "pipe"] }).toString();
  run(`${CAST} rpc --rpc-url ${RPC} anvil_impersonateAccount ${from}`);
  run(`${CAST} rpc --rpc-url ${RPC} anvil_setBalance ${from} 0xde0b6b3a7640000`);
  let out;
  try {
    out = run(`${CAST} send --rpc-url ${RPC} --unlocked --from ${from} ${SAFESEND} "${sig}" ${args.join(" ")} --json`);
    out = { ok: true, text: `tx ${JSON.parse(out).transactionHash.slice(0, 18)}… mined` };
  } catch (e) {
    const err = (e.stderr?.toString() ?? "") + (e.stdout?.toString() ?? "");
    const sel = err.match(/custom error (0x[0-9a-f]{8})/i)?.[1];
    const names = { "0xc19f17a9": "NotApproved()", "0xb2c3aa6b": "NotSender()", "0x0f2e5b6c": "Locked()" };
    out = { ok: false, text: `revert ${names[sel] ?? sel ?? err.trim().split("\n").pop()}` };
  } finally {
    run(`${CAST} rpc --rpc-url ${RPC} anvil_stopImpersonatingAccount ${from}`);
  }
  return out;
}
async function term(lines) {
  await page.evaluate((h) => {
    const t = document.getElementById("dm-term");
    t.innerHTML = h;
    t.style.opacity = h ? "1" : "0";
  }, lines);
}

async function cap(html) {
  await page.evaluate((h) => {
    const c = document.getElementById("dm-cap");
    c.style.opacity = "0";
    setTimeout(() => {
      c.innerHTML = h;
      c.style.opacity = h ? "1" : "0";
    }, 250);
  }, html);
}
async function card(h1, h2, p, ms) {
  scenes.push({ t: stamp(), scene: `CARD: ${h1}` });
  await page.evaluate(
    ([a, b, c]) => {
      const d = document.getElementById("dm-card");
      d.innerHTML = `<h1>${a}</h1><h2>${b}</h2>${c ? `<p>${c}</p>` : ""}`;
      d.style.opacity = "1";
      d.classList.add("on");
    },
    [h1, h2, p]
  );
  await sleep(ms);
}
async function uncard() {
  await page.evaluate(() => {
    const d = document.getElementById("dm-card");
    d.style.opacity = "0";
    d.classList.remove("on");
  });
  await sleep(600);
}
async function scene(name, caption) {
  scenes.push({ t: stamp(), scene: name });
  console.log(`[${stamp()}s] ${name}`);
  await cap(caption);
}
async function moveTo(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box for " + locator);
  await page.evaluate(
    ([x, y]) => {
      const c = document.getElementById("dm-cur");
      c.style.opacity = "1";
      c.style.left = x + "px";
      c.style.top = y + "px";
    },
    [box.x + box.width / 2, box.y + box.height / 2]
  );
  await sleep(600);
}
async function click(locator) {
  await moveTo(locator);
  await page.evaluate(() => {
    const c = document.getElementById("dm-cur");
    c.classList.remove("click");
    void c.offsetWidth;
    c.classList.add("click");
  });
  await locator.click();
  await sleep(500);
}
async function hideCursor() {
  await page.evaluate(() => (document.getElementById("dm-cur").style.opacity = "0"));
}
async function pickAccount(id) {
  const sel = page.locator("header select");
  await moveTo(sel);
  await sel.selectOption(id);
  await sleep(900);
}
async function nav(label) {
  await click(page.locator("nav button", { hasText: label }));
  await sleep(900);
}
async function typeInto(locator, text) {
  await click(locator);
  await locator.fill("");
  await locator.pressSequentially(text, { delay: 18 * PACE });
}
function timeTravel(seconds) {
  execSync(`${CAST} rpc --rpc-url http://127.0.0.1:8545 anvil_increaseTime ${seconds}`, { stdio: "ignore" });
  execSync(`${CAST} rpc --rpc-url http://127.0.0.1:8545 evm_mine`, { stdio: "ignore" });
}
async function shot(name) {
  await page.screenshot({ path: `${process.env.SHOTS ?? "docs/demo-v2/screenshots"}/${name}.png` });
}

// ---------- script ----------
await card(
  "SafeSend",
  "A poison-aware payment router. Lookalike recipients are quarantined on-chain and need the sender's explicit approval.",
  "Local Anvil demo · synthetic addresses · mock mUSDT · no real funds",
  5200
);

// 1. threat
await uncard();
await scene("1 threat: attacker console", "<b>The threat.</b> An attacker fabricates <code>0x7099…79c8</code> — same first/last 4 hex as Terry, the victim's verified payee — and plants it in the victim's history.");
await pickAccount("attacker");
await nav("Attacker");
await sleep(1800);
await click(page.getByRole("button", { name: /1\. Poison history/ }));
await sleep(2200);
await click(page.getByRole("button", { name: /2\. Dust victim/ }));
await sleep(2600);
await shot("01-attacker-console");

await scene("1b threat: victim history", "As the victim, History now shows the lookalike right next to Terry. Copy the wrong one and a raw transfer is gone forever.");
await pickAccount("victim");
await nav("History");
await sleep(3800);
await shot("02-history-poisoned");

// 2. flagged send
await scene("2 flagged send", "<b>Flagged send.</b> Pasting the lookalike into SafeSend: the router compares fingerprints and warns <b>LOOKALIKE</b> before anything moves.");
await nav("Send");
await typeInto(page.getByPlaceholder(/0x/), LOOKALIKE);
await sleep(2600);
await shot("03-send-lookalike-warning");
await cap("Sending anyway does <b>not</b> pay the lookalike: 1,000 mUSDT is escrowed for <b>24 hours</b> and flagged on-chain (<code>LookalikeFlagged</code>).");
await click(page.getByRole("button", { name: /Send anyway/ }));
await sleep(3200);

// 3. sender review
await scene("3 sender review", "<b>Sender review.</b> The quarantined card shows the <b>full 42-character address</b>, the 24h lock, and two choices: approve, or cancel & refund.");
await nav("Pending");
await sleep(4200);
await shot("04-pending-sender-full-address");
await cap("Nothing happens automatically. Until the sender approves <i>this</i> escrow on-chain, the recipient cannot claim — even after the lock expires.");
await sleep(3800);

// 4. blocked unapproved claim
await scene("4 recipient view locked", "<b>Recipient view.</b> The lookalike sees the same red QUARANTINED card. Claim is locked.");
await pickAccount("lookalike");
await nav("Pending");
await sleep(3200);
await shot("05-recipient-locked");
await scene("4b time travel", "Fast-forward 24 hours on Anvil (<code>anvil_increaseTime 86400</code>). The lock has expired…");
timeTravel(86401);
await sleep(4600);
await cap("<b>Blocked.</b> Unlocked but <b>not approved</b>: the button stays disabled — “Claim — needs sender approval”.");
await sleep(3000);
const escrowId = (await page.locator("text=/escrow #\\d+/").first().textContent()).match(/\d+/)[0];
await cap("And the contract agrees. Forcing a raw <code>claim()</code> from the recipient on-chain (impersonated on Anvil)…");
await term(`<span class="p">$</span> <span class="c">cast send --from 0x7099…79c8 SafeSend "claim(uint256)" ${escrowId}</span>\n<span class="p">…</span>`);
await sleep(1800);
const r1 = castAs(LOOKALIKE, "claim(uint256)", escrowId);
await term(`<span class="p">$</span> <span class="c">cast send --from 0x7099…79c8 SafeSend "claim(uint256)" ${escrowId}</span>\n<span class="${r1.ok ? "ok" : "e"}">✖ ${r1.text}</span>`);
await sleep(3200);
await shot("06-recipient-unlocked-blocked");
await cap("Approval is <b>sender-only</b>. Anyone else calling <code>approveLookalike()</code> — here, the attacker — is rejected too.");
const r2 = castAs(ATTACKER, "approveLookalike(uint256)", escrowId);
await term(`<span class="p">$</span> <span class="c">cast send --from 0x7099…79c8 SafeSend "claim(uint256)" ${escrowId}</span>\n<span class="${r1.ok ? "ok" : "e"}">✖ ${r1.text}</span>\n\n<span class="p">$</span> <span class="c">cast send --from 0x3C44…93BC SafeSend "approveLookalike(uint256)" ${escrowId}</span>\n<span class="${r2.ok ? "ok" : "e"}">✖ ${r2.text}</span>`);
await sleep(4200);
await shot("06b-nonsender-approve-rejected");
await term("");

// 5. explicit approval
await scene("5 explicit approval", "<b>Explicit approval.</b> Back as the sender. After checking every character of the address out-of-band, the sender approves this one escrow.");
await pickAccount("victim");
await nav("Pending");
await sleep(2600);
await click(page.getByRole("button", { name: /Approve escrow/ }));
await sleep(2600);
await shot("07-sender-approved");
await cap("Approval is per-transfer and sender-only (<code>NotSender</code> for anyone else). The sender can <b>still cancel & refund</b> until the claim happens.");
await sleep(4200);

// 6. post-unlock claim
await scene("6 post-unlock claim", "<b>Post-unlock claim.</b> Approved <i>and</i> unlocked — only now does the recipient get an enabled Claim button.");
await pickAccount("lookalike");
await nav("Pending");
await sleep(2800);
await shot("08-recipient-claimable");
await click(page.getByRole("button", { name: /Claim \(becomes verified payee\)/ }));
await sleep(3400);
await shot("09-recipient-claimed");

// 7. consequence
await scene("7 future trust", "<b>The consequence.</b> A successful approved claim <b>verifies</b> that exact address for the sender.");
await pickAccount("victim");
await nav("Payees");
await sleep(3600);
await shot("10-payees-verified");
await cap("Future sends to it are <b>instant</b> — no escrow, no second look. Approve only an address you have confirmed out-of-band.");
await nav("Send");
await typeInto(page.getByPlaceholder(/0x/), LOOKALIKE);
await sleep(3400);
await shot("11-send-now-verified-instant");
await hideCursor();
await sleep(800);

await card(
  "SafeSend",
  "Verified → instant. Unknown → escrow. Lookalike → 24h quarantine + on-chain flag, sender approval required, cancellable until claimed.",
  "Unaudited prototype · runs on local Anvil · github.com/sharonbasovich/safesend",
  5500
);

writeFileSync(process.env.SCENES ?? "docs/demo-v2/scenes.json", JSON.stringify(scenes, null, 2));
console.log(`total ${stamp()}s`);
process.exit(0);
