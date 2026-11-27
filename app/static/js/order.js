/* Staff "New Order" wizard — vanilla JS, drives step rendering + basket state. */

const STEP_LABELS = ["Location", "Table", "Allergies", "Member", "Items", "Payment", "Pay", "Review"];

const state = {
  step: 0,
  location: null,
  table: null,
  allergyStatus: false,
  allergens: [],
  member: null,
  basket: [],
  paymentMethod: null,
  amountReceived: "",
  paymentConfirmed: false,
  builder: null, // { mode: 'drink'|'sandwich', ... temp selections }
};

let MENU = null;
let itemKeyCounter = 1;

const stepContainer = document.getElementById("step-container");
const basketContainer = document.getElementById("basket-container");
const progressContainer = document.getElementById("wizard-progress");

const POINTS_PER_POUND = window.POINTS_PER_POUND || 1;
const POINT_VALUE = window.POINT_VALUE || 0.1;

// Same rules as the server (app/utils.py) — the server has the final say.
function pointsNeeded(total) {
  return Math.ceil(Math.round(total * 100) / Math.round(POINT_VALUE * 100) - 1e-9);
}
function pointsEarned(total) {
  return Math.floor(total * POINTS_PER_POUND + 1e-9);
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(n) {
  return "£" + (Math.round(n * 100) / 100).toFixed(2);
}

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function goToStep(n) {
  state.step = n;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

fetch(window.MENU_API_URL)
  .then((r) => r.json())
  .then((data) => {
    MENU = data;
    render();
  });

function render() {
  renderProgress();
  renderBasket();
  switch (state.step) {
    case 0: return renderLocationStep();
    case 1: return renderTableStep();
    case 2: return renderAllergyStep();
    case 3: return renderMemberStep();
    case 4: return renderItemsStep();
    case 5: return renderPaymentMethodStep();
    case 6: return renderPaymentDetailStep();
    case 7: return renderSummaryStep();
    case 8: return renderConfirmationStep();
  }
}

function renderProgress() {
  progressContainer.innerHTML = "";
  const total = Math.min(state.step, 7);
  for (let i = 0; i < STEP_LABELS.length; i++) {
    const dot = document.createElement("div");
    dot.className = "step-dot" + (i < state.step ? " done" : i === state.step ? " current" : "");
    progressContainer.appendChild(dot);
  }
}

// ---------------------------------------------------------------------------
// Basket (persists across steps)
// ---------------------------------------------------------------------------

function basketTotal() {
  return state.basket.reduce((sum, item) => sum + item.total, 0);
}

function renderBasket() {
  const total = basketTotal();
  let itemsHtml = "";
  if (state.basket.length === 0) {
    itemsHtml = `<div class="basket-empty">No items added yet</div>`;
  } else {
    itemsHtml = state.basket
      .map(
        (item) => `
      <div class="basket-item">
        <div class="row">
          <div>
            <div class="name">${item.name}${item.quantity > 1 ? " × " + item.quantity : ""}</div>
            ${item.options.length ? `<div class="opts">${item.options.map((o) => o.name).join(", ")}</div>` : ""}
          </div>
          <div class="price">${money(item.total)}</div>
        </div>
        <button class="remove" onclick="removeItem('${item.key}')">Remove</button>
      </div>`
      )
      .join("");
  }

  basketContainer.innerHTML = `
    <h3>Your Order So Far</h3>
    ${state.location ? `<div class="meta-line">📍 ${state.location.name}${state.table ? " · Table " + state.table : ""}</div>` : ""}
    ${state.member ? `<div class="meta-line">👤 ${escapeHtml(state.member.member_number)} — ${escapeHtml(state.member.name)} · ${state.member.points} pts</div>` : ""}
    ${state.allergyStatus ? `<div class="meta-line">⚠ ${state.allergens.join(", ") || "Allergies declared"}</div>` : ""}
    <div class="basket-items">${itemsHtml}</div>
    <div class="basket-total">
      <span>Total</span>
      <span class="amount">${money(total)}</span>
    </div>
  `;
}

function removeItem(key) {
  state.basket = state.basket.filter((i) => i.key !== key);
  render();
}

// ---------------------------------------------------------------------------
// Step 1 — Location
// ---------------------------------------------------------------------------

function renderLocationStep() {
  stepContainer.innerHTML = `
    <div class="step-label">Step 1 of 8</div>
    <h2>1. Location</h2>
    <p class="text-muted">Choose where the customer is seated.</p>
    <div class="pick-grid">
      ${MENU.locations
        .map(
          (loc) => `
        <div class="pick-card ${state.location && state.location.id === loc.id ? "selected" : ""}" onclick="selectLocation(${loc.id}, '${loc.name}')">
          ${loc.name}
        </div>`
        )
        .join("")}
    </div>
  `;
}

function selectLocation(id, name) {
  state.location = { id, name };
  goToStep(1);
}

// ---------------------------------------------------------------------------
// Step 2 — Table
// ---------------------------------------------------------------------------

function renderTableStep() {
  let cells = "";
  for (let t = 1; t <= 50; t++) {
    cells += `<div class="table-cell ${state.table === t ? "selected" : ""}" onclick="selectTable(${t})">${t}</div>`;
  }
  stepContainer.innerHTML = `
    <div class="step-label">Step 2 of 8</div>
    <h2>2. Table Number</h2>
    <p class="text-muted">${state.location.name}</p>
    <div class="table-grid">${cells}</div>
    <div class="btn-group">
      <button class="btn btn-outline" onclick="goToStep(0)">← Back</button>
    </div>
  `;
}

function selectTable(t) {
  state.table = t;
  goToStep(2);
}

// ---------------------------------------------------------------------------
// Step 3 — Allergies
// ---------------------------------------------------------------------------

function renderAllergyStep() {
  stepContainer.innerHTML = `
    <div class="step-label">Step 3 of 8</div>
    <h2>3. Any allergies?</h2>
    <div class="pick-grid" style="grid-template-columns: repeat(2, 1fr); max-width:340px;">
      <div class="pick-card ${state.allergyStatus === false ? "selected" : ""}" onclick="setAllergyStatus(false)">No</div>
      <div class="pick-card ${state.allergyStatus === true ? "selected" : ""}" onclick="setAllergyStatus(true)">Yes</div>
    </div>
    <div id="allergen-list"></div>
    <div class="btn-group" style="margin-top:20px;">
      <button class="btn btn-outline" onclick="goToStep(1)">← Back</button>
      <button class="btn btn-primary" onclick="goToStep(3)" ${state.allergyStatus === true && state.allergens.length === 0 ? "disabled" : ""}>Continue →</button>
    </div>
  `;
  renderAllergenList();
}

function setAllergyStatus(val) {
  state.allergyStatus = val;
  if (!val) state.allergens = [];
  renderAllergyStep();
}

function renderAllergenList() {
  const listDiv = document.getElementById("allergen-list");
  if (!listDiv) return;
  if (state.allergyStatus === null || state.allergyStatus === undefined) {
    listDiv.innerHTML = "";
    return;
  }
  if (state.allergyStatus === false) {
    listDiv.innerHTML = `<p style="margin-top:16px; font-weight:600;">No allergies declared</p>`;
    return;
  }
  listDiv.innerHTML = `
    <p class="text-muted" style="margin-top:16px;">Select all that apply:</p>
    <div class="allergen-grid">
      ${MENU.allergens
        .map(
          (a) => `
        <div class="allergen-chip ${state.allergens.includes(a) ? "selected" : ""}" onclick="toggleAllergen('${a}')">
          ${state.allergens.includes(a) ? "✓" : ""} ${a}
        </div>`
        )
        .join("")}
    </div>
  `;
}

function toggleAllergen(name) {
  if (state.allergens.includes(name)) {
    state.allergens = state.allergens.filter((a) => a !== name);
  } else {
    state.allergens.push(name);
  }
  renderAllergyStep();
}

// ---------------------------------------------------------------------------
// Step 4 — Member (optional)
// ---------------------------------------------------------------------------

function renderMemberStep() {
  const m = state.member;
  stepContainer.innerHTML = `
    <div class="step-label">Step 4 of 8</div>
    <h2>4. Member (optional)</h2>
    <p class="text-muted">Search by member number, name or phone, create a new member, or skip.</p>
    <div style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap;">
      <div class="field" style="flex:1; min-width:220px; max-width:340px; margin-bottom:0;">
        <input type="text" id="member-search" placeholder="e.g. #1001, name or phone" oninput="searchMembers(this.value)">
      </div>
      <button class="btn btn-accent" id="new-member-btn" onclick="toggleNewMemberForm()">+ New Member</button>
    </div>
    <div id="new-member-form"></div>
    <div id="member-results" style="margin-top:12px;"></div>
    ${m ? `<div class="chip-inline">Selected: <strong>${escapeHtml(m.member_number)}</strong> — ${escapeHtml(m.name)} · ${m.points} points <button onclick="clearMember()" style="border:none;background:none;color:var(--red);font-weight:700;">✕</button></div>` : ""}
    <div class="btn-group" style="margin-top:20px;">
      <button class="btn btn-outline" onclick="goToStep(2)">← Back</button>
      <button class="btn btn-outline" onclick="clearMember(); goToStep(4);">Skip</button>
      <button class="btn btn-primary" onclick="goToStep(4)">Continue →</button>
    </div>
  `;
}

// Results from the latest search, so a click can pick a member by id
// (avoids putting names like O'Brien inside onclick attributes).
let memberResults = [];
let memberSearchTimer = null;

function searchMembers(q) {
  clearTimeout(memberSearchTimer);
  if (!q || q.length < 1) {
    document.getElementById("member-results").innerHTML = "";
    return;
  }
  memberSearchTimer = setTimeout(() => {
    fetch(window.MEMBERS_SEARCH_URL + "?q=" + encodeURIComponent(q))
      .then((r) => r.json())
      .then((data) => {
        const box = document.getElementById("member-results");
        if (!box) return;
        memberResults = data.results;
        if (data.results.length === 0) {
          box.innerHTML = `<p class="text-muted" style="margin-top:8px;">No members found. Use <strong>+ New Member</strong> to sign them up.</p>`;
          return;
        }
        box.innerHTML = data.results
          .map(
            (m) => `<div class="pick-card" style="text-align:left; padding:12px 16px; margin-bottom:8px;" onclick="selectMemberById(${m.id})">
              <strong>${escapeHtml(m.member_number)}</strong> — ${escapeHtml(m.name)}
              <span class="text-muted" style="font-size:0.85rem;">${m.phone ? " · " + escapeHtml(m.phone) : ""} · ${m.points} pts</span>
            </div>`
          )
          .join("");
      });
  }, 250);
}

function selectMemberById(id) {
  const m = memberResults.find((r) => r.id === id);
  if (m) selectMember(m);
}

function selectMember(m) {
  state.member = m;
  renderMemberStep();
}

function clearMember() {
  state.member = null;
  if (state.paymentMethod === "Member Points") state.paymentMethod = null;
  renderMemberStep();
}

function toggleNewMemberForm() {
  const box = document.getElementById("new-member-form");
  if (box.innerHTML.trim()) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `
    <div class="card" style="background:var(--beige); box-shadow:none; margin-top:14px; max-width:520px;">
      <h3 style="margin-top:0; font-size:1rem;">New Member</h3>
      <div class="field-row">
        <div class="field"><label for="nm-first">Name</label><input type="text" id="nm-first" autocomplete="off"></div>
        <div class="field"><label for="nm-surname">Surname</label><input type="text" id="nm-surname" autocomplete="off"></div>
      </div>
      <div class="field"><label for="nm-phone">Phone Number</label><input type="tel" id="nm-phone" inputmode="tel" autocomplete="off"></div>
      <div id="nm-error" style="color:var(--red); font-size:0.88rem; margin-bottom:10px;"></div>
      <div class="btn-group">
        <button class="btn btn-outline" onclick="toggleNewMemberForm()">Cancel</button>
        <button class="btn btn-accent" id="nm-submit" onclick="createMember()">Create Member</button>
      </div>
    </div>
  `;
  document.getElementById("nm-first").focus();
}

function createMember() {
  const first = document.getElementById("nm-first").value.trim();
  const surname = document.getElementById("nm-surname").value.trim();
  const phone = document.getElementById("nm-phone").value.trim();
  const errorEl = document.getElementById("nm-error");
  const btn = document.getElementById("nm-submit");

  if (!first || !surname || !phone) {
    errorEl.textContent = "Please fill in name, surname and phone number.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Creating…";

  fetch(window.CREATE_MEMBER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ first_name: first, surname, phone }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.error) {
        errorEl.innerHTML = escapeHtml(data.error) +
          (data.existing ? ` <a href="#" onclick="useExistingMember(); return false;">Use this member</a>` : "");
        window._existingMember = data.existing || null;
        btn.disabled = false;
        btn.textContent = "Create Member";
        return;
      }
      state.member = data.member;
      renderMemberStep();
      document.getElementById("member-results").innerHTML = `
        <div class="card" style="background:var(--beige); box-shadow:none; max-width:520px; text-align:center;">
          <div class="text-muted" style="font-size:0.8rem; text-transform:uppercase; letter-spacing:0.05em;">New member number</div>
          <div class="mono" style="font-size:2rem; font-weight:700; margin:6px 0;">${escapeHtml(data.member.member_number)}</div>
          <div>${escapeHtml(data.member.name)} · ${escapeHtml(data.member.phone)}</div>
          <p class="text-muted" style="margin:8px 0 0 0; font-size:0.85rem;">Give this number to the customer. They earn points on every order.</p>
        </div>`;
    })
    .catch(() => {
      errorEl.textContent = "Something went wrong. Please try again.";
      btn.disabled = false;
      btn.textContent = "Create Member";
    });
}

function useExistingMember() {
  if (window._existingMember) selectMember(window._existingMember);
}

// ---------------------------------------------------------------------------
// Step 5 — Items (Add Drink / Add Sandwich)
// ---------------------------------------------------------------------------

function renderItemsStep() {
  if (state.builder && state.builder.mode === "drink-options") return renderDrinkOptionsBuilder();
  if (state.builder && state.builder.mode === "sandwich") return renderSandwichBuilder();

  const drinkCards = (cat, list) =>
    list
      .map(
        (d) => `
      <div class="pick-card" onclick="startDrinkOptions(${d.id}, '${d.name.replace(/'/g, "\\'")}', ${d.price})">
        ${d.name}<span class="price">${money(d.price)}</span>
      </div>`
      )
      .join("");

  stepContainer.innerHTML = `
    <div class="step-label">Step 5 of 8</div>
    <h2>5. Add a Drink</h2>
    <div class="pick-grid">
      ${drinkCards("hot", MENU.hot_drinks)}
      ${drinkCards("cold", MENU.drinks)}
    </div>
    <div class="btn-group" style="margin: 6px 0 20px 0;">
      <button class="btn btn-outline" onclick="startSandwich()">🥪 Order a Sandwich Instead</button>
    </div>
    <div class="btn-group">
      <button class="btn btn-outline" onclick="goToStep(3)">← Back</button>
      <button class="btn btn-primary" onclick="goToStep(5)" ${state.basket.length === 0 ? "disabled" : ""}>Continue to Payment →</button>
    </div>
  `;
}

function startDrinkOptions(id, name, price) {
  state.builder = { mode: "drink-options", id, name, price, selectedOptions: [] };
  renderItemsStep();
}

function renderDrinkOptionsBuilder() {
  const b = state.builder;
  const unitPrice = b.price + b.selectedOptions.reduce((s, o) => s + o.price, 0);
  stepContainer.innerHTML = `
    <div class="step-label">Step 5 of 8</div>
    <h2>${b.name}</h2>
    <p class="text-muted">Choose any options (optional).</p>
    <div class="option-grid">
      ${MENU.drink_options
        .map(
          (o) => `
        <div class="option-chip ${b.selectedOptions.find((s) => s.id === o.id) ? "selected" : ""}" onclick="toggleDrinkOption(${o.id}, '${o.name.replace(/'/g, "\\'")}', ${o.price})">
          <span>${o.name}</span>
          <span class="adj">${o.price >= 0 ? "+" : "-"}${money(Math.abs(o.price))}</span>
        </div>`
        )
        .join("")}
    </div>
    <div class="card" style="background:var(--beige); box-shadow:none;">
      <div class="flex-between"><strong>Price</strong><span class="mono" style="font-size:1.2rem;">${money(unitPrice)}</span></div>
    </div>
    <div class="btn-group" style="margin-top:20px;">
      <button class="btn btn-outline" onclick="cancelBuilder()">← Back</button>
      <button class="btn btn-accent" onclick="addDrinkToBasket()">Add to Order</button>
    </div>
  `;
}

function toggleDrinkOption(id, name, price) {
  const b = state.builder;
  const idx = b.selectedOptions.findIndex((o) => o.id === id);
  if (idx >= 0) b.selectedOptions.splice(idx, 1);
  else b.selectedOptions.push({ id, name, price });
  renderDrinkOptionsBuilder();
}

function addDrinkToBasket() {
  const b = state.builder;
  const unitPrice = b.price + b.selectedOptions.reduce((s, o) => s + o.price, 0);
  state.basket.push({
    key: "item-" + itemKeyCounter++,
    type: "drink",
    menu_item_id: b.id,
    name: b.name,
    options: b.selectedOptions.map((o) => ({ name: o.name, price: o.price })),
    option_ids: b.selectedOptions.map((o) => o.id),
    quantity: 1,
    total: unitPrice,
  });
  state.builder = null;
  renderItemsStep();
}

function startSandwich() {
  state.builder = { mode: "sandwich", filling: null, bread: null, extras: [] };
  renderItemsStep();
}

function renderSandwichBuilder() {
  const b = state.builder;
  const unitPrice =
    (b.filling ? b.filling.price : 0) + (b.bread ? b.bread.price : 0) + b.extras.reduce((s, e) => s + e.price, 0);

  stepContainer.innerHTML = `
    <div class="step-label">Step 5 of 8</div>
    <h2>Build a Sandwich</h2>

    <h3 style="font-size:1rem; margin-top:20px;">Filling</h3>
    <div class="pick-grid">
      ${MENU.fillings
        .map(
          (f) => `<div class="pick-card ${b.filling && b.filling.id === f.id ? "selected" : ""}" onclick='selectFilling(${JSON.stringify(f)})'>${f.name}<span class="price">${money(f.price)}</span></div>`
        )
        .join("")}
    </div>

    <h3 style="font-size:1rem; margin-top:20px;">Bread</h3>
    <div class="pick-grid">
      ${MENU.bread
        .map(
          (br) => `<div class="pick-card ${b.bread && b.bread.id === br.id ? "selected" : ""}" onclick='selectBread(${JSON.stringify(br)})'>${br.name}<span class="price">${money(br.price)}</span></div>`
        )
        .join("")}
    </div>

    <h3 style="font-size:1rem; margin-top:20px;">Extras</h3>
    <div class="option-grid">
      ${MENU.extras
        .map(
          (ex) => `
        <div class="option-chip ${b.extras.find((s) => s.id === ex.id) ? "selected" : ""}" onclick='toggleExtra(${JSON.stringify(ex)})'>
          <span>${ex.name}</span><span class="adj">+${money(ex.price)}</span>
        </div>`
        )
        .join("")}
    </div>

    <div class="card" style="background:var(--beige); box-shadow:none;">
      <div class="flex-between"><strong>Price</strong><span class="mono" style="font-size:1.2rem;">${money(unitPrice)}</span></div>
    </div>

    <div class="btn-group" style="margin-top:20px;">
      <button class="btn btn-outline" onclick="cancelBuilder()">← Back</button>
      <button class="btn btn-accent" onclick="addSandwichToBasket()" ${!b.filling || !b.bread ? "disabled" : ""}>Add to Order</button>
    </div>
  `;
}

function selectFilling(f) {
  state.builder.filling = f;
  renderSandwichBuilder();
}
function selectBread(br) {
  state.builder.bread = br;
  renderSandwichBuilder();
}
function toggleExtra(ex) {
  const b = state.builder;
  const idx = b.extras.findIndex((e) => e.id === ex.id);
  if (idx >= 0) b.extras.splice(idx, 1);
  else b.extras.push(ex);
  renderSandwichBuilder();
}

function addSandwichToBasket() {
  const b = state.builder;
  const unitPrice = b.filling.price + b.bread.price + b.extras.reduce((s, e) => s + e.price, 0);
  const options = [{ name: b.bread.name, price: b.bread.price }, ...b.extras.map((e) => ({ name: e.name, price: e.price }))];
  state.basket.push({
    key: "item-" + itemKeyCounter++,
    type: "sandwich",
    filling_id: b.filling.id,
    bread_id: b.bread.id,
    extra_ids: b.extras.map((e) => e.id),
    name: b.filling.name + " Sandwich",
    options,
    quantity: 1,
    total: unitPrice,
  });
  state.builder = null;
  renderItemsStep();
}

function cancelBuilder() {
  state.builder = null;
  renderItemsStep();
}

// ---------------------------------------------------------------------------
// Step 6 — Payment Method
// ---------------------------------------------------------------------------

function renderPaymentMethodStep() {
  const total = basketTotal();
  const needed = pointsNeeded(total);
  const m = state.member;
  const canUsePoints = m && m.points >= needed;
  let pointsNote;
  if (!m) pointsNote = "Select a member in step 4 to use points";
  else if (!canUsePoints) pointsNote = `Needs ${needed} pts · member has ${m.points}`;
  else pointsNote = `${needed} of ${m.points} pts`;

  stepContainer.innerHTML = `
    <div class="step-label">Step 6 of 8</div>
    <h2>Payment Method</h2>
    <div class="pay-tiles">
      <div class="pay-tile ${state.paymentMethod === "Card" ? "selected" : ""}" onclick="selectPaymentMethod('Card')">💳 Card</div>
      <div class="pay-tile ${state.paymentMethod === "Cash" ? "selected" : ""}" onclick="selectPaymentMethod('Cash')">💵 Cash</div>
      <div class="pay-tile ${state.paymentMethod === "Member Points" ? "selected" : ""}"
           ${canUsePoints ? `onclick="selectPaymentMethod('Member Points')"` : `style="opacity:0.45; cursor:not-allowed;"`}>
        ⭐ Member Points
        <div style="font-size:0.78rem; font-weight:400; margin-top:4px;">${pointsNote}</div>
      </div>
    </div>
    ${m && state.paymentMethod !== "Member Points" ? `<p class="text-muted" style="font-size:0.85rem;">Paying by card or cash earns ${escapeHtml(m.name)} <strong>${pointsEarned(total)} points</strong>.</p>` : ""}
    <div class="btn-group">
      <button class="btn btn-outline" onclick="goToStep(4)">← Back</button>
    </div>
  `;
}

function selectPaymentMethod(method) {
  state.paymentMethod = method;
  state.paymentConfirmed = false;
  state.amountReceived = "";
  goToStep(6);
}

// ---------------------------------------------------------------------------
// Step 7 — Payment Detail (Card or Cash)
// ---------------------------------------------------------------------------

function renderPaymentDetailStep() {
  const total = basketTotal();
  if (state.paymentMethod === "Member Points") {
    const m = state.member;
    const needed = pointsNeeded(total);
    stepContainer.innerHTML = `
      <div class="step-label">Step 7 of 8</div>
      <h2>Pay with Member Points</h2>
      <div class="receipt-line"><span class="k">Member</span><span>${escapeHtml(m.member_number)} — ${escapeHtml(m.name)}</span></div>
      <div class="receipt-line"><span class="k">Order total</span><span class="mono">${money(total)}</span></div>
      <div class="receipt-line"><span class="k">Points to use</span><span class="mono">${needed}</span></div>
      <div class="receipt-line"><span class="k">Current balance</span><span class="mono">${m.points}</span></div>
      <div class="receipt-line" style="font-weight:700;"><span>Balance after</span><span class="mono">${m.points - needed}</span></div>
      <p class="text-muted" style="font-size:0.82rem;">1 point = ${money(POINT_VALUE)}. Orders paid with points do not earn new points.</p>
      <div class="btn-group" style="margin-top:16px;">
        <button class="btn btn-outline" onclick="goToStep(5)">← Back</button>
        <button class="btn btn-primary" onclick="goToStep(7)" ${m.points < needed ? "disabled" : ""}>Continue to Review →</button>
      </div>
    `;
    return;
  }
  if (state.paymentMethod === "Card") {
    stepContainer.innerHTML = `
      <div class="step-label">Step 7 of 8</div>
      <h2>Card Payment</h2>
      <p class="text-muted">Order total: <strong>${money(total)}</strong></p>
      <div class="card" style="background:var(--beige); box-shadow:none;">
        <p style="margin-top:0;">Present the contactless terminal or QR code to the customer to take payment.</p>
        <p class="text-muted" style="font-size:0.82rem;">This build does not connect to a live payment provider. Use the button below to simulate a successful, clearly-labelled demo payment.</p>
        <button class="btn btn-accent btn-block" onclick="confirmCardPayment()">
          ${state.paymentConfirmed ? "✓ Payment Confirmed (Simulated)" : "Simulate Payment — Demo Mode"}
        </button>
      </div>
      <div class="btn-group" style="margin-top:16px;">
        <button class="btn btn-outline" onclick="goToStep(5)">← Back</button>
        <button class="btn btn-primary" onclick="goToStep(7)" ${!state.paymentConfirmed ? "disabled" : ""}>Continue to Review →</button>
      </div>
    `;
  } else {
    const received = parseFloat(state.amountReceived || "0") || 0;
    const change = received - total;
    stepContainer.innerHTML = `
      <div class="step-label">Step 7 of 8</div>
      <h2>Cash Payment</h2>
      <div class="receipt-line"><span class="k">Order total</span><span class="mono">${money(total)}</span></div>
      <div class="field" style="max-width:260px; margin-top:16px;">
        <label for="cash-amount">Amount Received</label>
        <input type="number" step="0.01" min="0" id="cash-amount" value="${state.amountReceived}" inputmode="decimal" oninput="updateCashAmount(this.value)" placeholder="0.00">
      </div>
      <div class="change-display">
        <div class="text-muted" style="font-size:0.8rem; text-transform:uppercase; letter-spacing:0.05em;">Change Due</div>
        <div class="amount" id="change-amount">${money(Math.abs(change))}</div>
        <p class="text-muted" id="change-warning" style="margin:6px 0 0 0; display:${change < 0 ? "block" : "none"};">Amount received is less than the total.</p>
      </div>
      <div class="btn-group" style="margin-top:20px;">
        <button class="btn btn-outline" onclick="goToStep(5)">← Back</button>
        <button class="btn btn-primary" id="continue-payment-btn" onclick="goToStep(7)" ${received < total ? "disabled" : ""}>Continue to Review →</button>
      </div>
    `;
  }
}

function confirmCardPayment() {
  state.paymentConfirmed = true;
  renderPaymentDetailStep();
}

function updateCashAmount(v) {
  // Update state + the change display in place — do NOT re-render the whole
  // step, or the input loses focus after every single keystroke/tap.
  state.amountReceived = v;
  const total = basketTotal();
  const received = parseFloat(v || "0") || 0;
  const change = received - total;

  const amountEl = document.getElementById("change-amount");
  const warningEl = document.getElementById("change-warning");
  const continueBtn = document.getElementById("continue-payment-btn");

  if (amountEl) {
    amountEl.textContent = money(Math.abs(change));
    amountEl.classList.toggle("negative", change < 0);
  }
  if (warningEl) warningEl.style.display = change < 0 ? "block" : "none";
  if (continueBtn) continueBtn.disabled = received < total;
}

// ---------------------------------------------------------------------------
// Step 8 — Summary
// ---------------------------------------------------------------------------

function renderSummaryStep() {
  const total = basketTotal();
  stepContainer.innerHTML = `
    <div class="step-label">Step 8 of 8</div>
    <h2>Order Summary</h2>

    <div class="receipt-line"><span class="k">Location</span><span>${state.location.name} <a href="#" onclick="goToStep(0); return false;" style="font-size:0.8rem; margin-left:8px;">Edit</a></span></div>
    <div class="receipt-line"><span class="k">Table</span><span>${state.table} <a href="#" onclick="goToStep(1); return false;" style="font-size:0.8rem; margin-left:8px;">Edit</a></span></div>
    <div class="receipt-line"><span class="k">Allergies</span><span>${
      state.allergyStatus ? state.allergens.join(", ") || "Declared" : "None declared"
    } <a href="#" onclick="goToStep(2); return false;" style="font-size:0.8rem; margin-left:8px;">Edit</a></span></div>
    <div class="receipt-line"><span class="k">Member</span><span>${state.member ? escapeHtml(state.member.member_number) + " — " + escapeHtml(state.member.name) : "—"} <a href="#" onclick="goToStep(3); return false;" style="font-size:0.8rem; margin-left:8px;">Edit</a></span></div>

    <h3 style="margin-top:20px;">Items <a href="#" onclick="goToStep(4); return false;" style="font-size:0.8rem; margin-left:8px;">Edit Items</a></h3>
    ${state.basket
      .map(
        (item) => `<div class="receipt-line"><span>${item.name}${item.options.length ? " — " + item.options.map((o) => o.name).join(", ") : ""}</span><span class="mono">${money(item.total)}</span></div>`
      )
      .join("")}

    <div class="receipt-line"><span class="k">Payment Method</span><span>${state.paymentMethod} <a href="#" onclick="goToStep(5); return false;" style="font-size:0.8rem; margin-left:8px;">Edit</a></span></div>
    ${state.paymentMethod === "Cash" ? `<div class="receipt-line"><span class="k">Change Due</span><span class="mono">${money(parseFloat(state.amountReceived || 0) - total)}</span></div>` : ""}
    ${state.paymentMethod === "Member Points" ? `<div class="receipt-line"><span class="k">Points Used</span><span class="mono">${pointsNeeded(total)}</span></div>` : ""}
    ${state.member && state.paymentMethod !== "Member Points" ? `<div class="receipt-line"><span class="k">Points Earned</span><span class="mono">+${pointsEarned(total)}</span></div>` : ""}

    <div class="receipt-line" style="border-top:2px solid var(--border); font-weight:700; margin-top:10px; padding-top:14px;">
      <span>Total Price</span><span class="mono" style="font-size:1.2rem;">${money(total)}</span>
    </div>

    <div id="place-order-error" style="color:var(--red); margin-top:12px; font-size:0.88rem;"></div>

    <div class="btn-group" style="margin-top:20px;">
      <button class="btn btn-outline" onclick="goToStep(6)">← Back</button>
      <button class="btn btn-accent" id="place-order-btn" onclick="placeOrder()">Place Order</button>
    </div>
  `;
}

function placeOrder() {
  const btn = document.getElementById("place-order-btn");
  btn.disabled = true;
  btn.textContent = "Placing Order…";

  const payload = {
    location_id: state.location.id,
    table_number: state.table,
    allergy_status: state.allergyStatus,
    allergens: state.allergens,
    member_id: state.member ? state.member.id : null,
    payment_method: state.paymentMethod,
    amount_received: state.paymentMethod === "Cash" ? parseFloat(state.amountReceived || 0) : undefined,
    payment_confirmed: state.paymentMethod === "Card" ? state.paymentConfirmed : true,
    items: state.basket.map((item) =>
      item.type === "drink"
        ? { type: "drink", menu_item_id: item.menu_item_id, option_ids: item.option_ids, quantity: item.quantity }
        : { type: "sandwich", filling_id: item.filling_id, bread_id: item.bread_id, extra_ids: item.extra_ids, quantity: item.quantity }
    ),
  };

  fetch(window.CREATE_ORDER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.error) {
        document.getElementById("place-order-error").textContent = data.error;
        btn.disabled = false;
        btn.textContent = "Place Order";
        return;
      }
      state.confirmedOrderNumber = data.order_number;
      state.confirmedOrderId = data.order_id;
      state.confirmedPoints = data;
      if (state.member && data.member_points !== null) state.member.points = data.member_points;
      goToStep(8);
    })
    .catch(() => {
      document.getElementById("place-order-error").textContent = "Something went wrong. Please try again.";
      btn.disabled = false;
      btn.textContent = "Place Order";
    });
}

// ---------------------------------------------------------------------------
// Step 9 — Confirmation
// ---------------------------------------------------------------------------

function renderConfirmationStep() {
  stepContainer.innerHTML = `
    <div class="empty-state">
      <div class="icon">✅</div>
      <h2>Order Placed</h2>
      <p class="text-muted">Order <strong class="mono">${state.confirmedOrderNumber}</strong> has been sent to the kitchen.</p>
      ${state.member ? `<p>⭐ ${state.confirmedPoints.points_redeemed ? `${state.confirmedPoints.points_redeemed} points used` : `+${state.confirmedPoints.points_earned} points earned`} · ${escapeHtml(state.member.name)} now has <strong>${state.confirmedPoints.member_points} points</strong></p>` : ""}
      <div class="btn-group" style="justify-content:center; margin-top:20px;">
        <a href="${window.RECEIPT_URL_TEMPLATE.replace('/0/', '/' + state.confirmedOrderId + '/')}" target="_blank" class="btn btn-accent">🖨 Print Receipt</a>
        <a href="${window.ORDERS_LIST_URL}" class="btn btn-outline">View My Orders</a>
        <button class="btn btn-accent" onclick="resetWizard()">Start New Order</button>
      </div>
    </div>
  `;
  basketContainer.innerHTML = "";
}

function resetWizard() {
  state.step = 0;
  state.location = null;
  state.table = null;
  state.allergyStatus = false;
  state.allergens = [];
  state.member = null;
  state.basket = [];
  state.paymentMethod = null;
  state.amountReceived = "";
  state.paymentConfirmed = false;
  state.builder = null;
  state.confirmedPoints = null;
  render();
}
