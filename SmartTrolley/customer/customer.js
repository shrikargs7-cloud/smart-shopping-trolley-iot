// =========================================================================
// SMART TROLLEY - CUSTOMER DASHBOARD
// Configured to match ESP32: Database.set(aClient, "/scan_history/", ...)
// =========================================================================

const CONFIG = {
    apiKey: "AIzaSyBdId6Lqg-zc5o0dTzrArcgS0-6lC5VFD8",
    dbUrl: "https://inventory-fa492-default-rtdb.firebaseio.com",
    email: "shrikargs7@gmail.com",
    pass: "Shri@1234",
    geminiKey: window.GEMINI_API_KEY || ""
};

let idToken = null;
let allProducts = {};
let cart = {}; // { [uid]: { uid, name, price, quantity, maxStock } }
let lastSeenScan = null; // Store stringified scan object to detect change
let shoppingBudget = Number(localStorage.getItem("trolley_budget") || 500);
let alertedMilestones = { 50: false, 90: false, 100: false };
let speechEnabled = true;
let isRecognizing = false;
let speechRecognizer = null;
let lastRecipeCheckCartHash = "";

const $ = id => document.getElementById(id);

function setStatus(text, ok) {
    const dot = $("statusDot");
    const label = $("statusText");
    if (label) label.textContent = text;
    if (dot) {
        dot.className = ok 
            ? "w-2.5 h-2.5 rounded-full bg-emerald-400" 
            : "w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse";
    }
}

// -------------------------------------------------------------------------
// 1. Authenticate with Firebase via REST
// -------------------------------------------------------------------------
async function authenticate() {
    setStatus("Authenticating...", false);
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CONFIG.apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: CONFIG.email,
                    password: CONFIG.pass,
                    returnSecureToken: true
                }),
                signal: controller.signal
            }
        );
        clearTimeout(timeoutId);

        const data = await res.json();
        if (data.idToken) {
            idToken = data.idToken;
            setStatus("Firebase Connected", true);
            console.log("✅ Authenticated with Firebase!");
            return true;
        } else {
            const errCode = data.error?.message || "Auth Error";
            setStatus(`Auth: ${errCode}`, false);
            console.error("Auth error:", data);
            return false;
        }
    } catch (err) {
        setStatus("Retrying connection...", false);
        console.error("Authentication fetch failed:", err);
        setTimeout(authenticate, 3000);
        return false;
    }
}

// -------------------------------------------------------------------------
// 2. Fetch all products from Firebase
// -------------------------------------------------------------------------
async function loadProducts() {
    if (!idToken) return;
    try {
        const res = await fetch(`${CONFIG.dbUrl}/products.json?auth=${idToken}`);
        const data = await res.json();
        if (data && typeof data === "object") {
            allProducts = {};
            Object.entries(data).forEach(([key, val]) => {
                if (val && typeof val === "object") {
                    const cleanKey = key.replace(/[\s:-]/g, '').toUpperCase();
                    allProducts[cleanKey] = val;
                }
            });
            console.log("📦 Products catalog loaded:", Object.keys(allProducts));
        }
    } catch (err) {
        console.error("Failed to load products:", err);
    }
}

// -------------------------------------------------------------------------
// 3. Poll /scan_history (Handles BOTH single object AND list of pushes)
// -------------------------------------------------------------------------
async function pollScanHistory() {
    if (!idToken) return;

    try {
        const res = await fetch(`${CONFIG.dbUrl}/scan_history.json?auth=${idToken}`);
        const data = await res.json();

        if (!data || typeof data !== "object") return;

        // Check format:
        // Format A: Direct single object (when ESP32 writes: Database.set to "/scan_history/")
        // e.g. { uid: "43CE7728", name: "Milk", price: 30, ... }
        let currentScan = null;
        let scanId = "";

        if (data.uid) {
            currentScan = data;
            // Use JSON representation as the fingerprint
            scanId = `${data.uid}_${data.name || ''}_${data.price || ''}`;
        } else {
            // Format B: Collection of pushed scans
            // e.g. { "-P4l...": { uid: "43CE7728", ... } }
            const entries = Object.entries(data);
            if (entries.length > 0) {
                const [key, scanObj] = entries[entries.length - 1];
                currentScan = scanObj;
                scanId = key;
            }
        }

        if (!currentScan || !currentScan.uid) return;

        // First poll: Just memorize current state so we don't scan on page load
        if (lastSeenScan === null) {
            lastSeenScan = scanId;
            console.log("Anchor scan initialized:", scanId);
            return;
        }

        // If the scan has changed
        if (scanId !== lastSeenScan) {
            lastSeenScan = scanId;
            console.log("⚡ NEW SCAN DETECTED FROM ESP32:", currentScan);
            addItemToCart(currentScan.uid, currentScan.name, currentScan.price);
        }

    } catch (err) {
        console.error("Poll scan history error:", err);
    }
}

// -------------------------------------------------------------------------
// 4. Cart Management Logic
// -------------------------------------------------------------------------
function addItemToCart(rawUid, fallbackName, fallbackPrice) {
    const uid = String(rawUid || "").replace(/[\s:-]/g, "").toUpperCase();
    if (!uid) return;

    const product = allProducts[uid];
    const name = product?.name || fallbackName || `Item (${uid})`;
    const price = Number(product?.price ?? fallbackPrice ?? 0);
    const stock = Number(product?.stock_quantity ?? product?.stock ?? 99);

    if (cart[uid]) {
        if (cart[uid].quantity >= stock) {
            alert(`Cannot add more "${name}". Only ${stock} units available in stock!`);
            return;
        }
        cart[uid].quantity += 1;
    } else {
        cart[uid] = {
            uid,
            name,
            price,
            quantity: 1,
            maxStock: stock
        };
    }

    renderCart();
}

function changeQuantity(uid, delta) {
    if (!cart[uid]) return;

    const nextQty = cart[uid].quantity + delta;
    if (nextQty <= 0) {
        delete cart[uid];
    } else if (nextQty > cart[uid].maxStock) {
        alert(`Only ${cart[uid].maxStock} units available in store!`);
        return;
    } else {
        cart[uid].quantity = nextQty;
    }
    renderCart();
}

function removeItem(uid) {
    if (cart[uid]) {
        delete cart[uid];
        renderCart();
    }
}

function clearCart() {
    cart = {};
    renderCart();
}

// -------------------------------------------------------------------------
// 5. Render UI & Budget Tracker (50%, 90%, 100% Alerts)
// -------------------------------------------------------------------------
function updateBudgetTracker(subtotal) {
    const budgetSpentEl = $("budgetSpent");
    const budgetLimitDisplay = $("budgetLimitDisplay");
    const progressBar = $("budgetProgressBar");
    const alertMsg = $("budgetAlertMsg");

    if (budgetSpentEl) budgetSpentEl.textContent = `₹${subtotal.toFixed(2)}`;
    if (budgetLimitDisplay) budgetLimitDisplay.textContent = `₹${shoppingBudget.toFixed(0)}`;

    if (progressBar) {
        const percentage = Math.min(100, (subtotal / shoppingBudget) * 100);
        progressBar.style.width = `${percentage}%`;

        // 1. Overbudget Threshold (>= 100%)
        if (subtotal >= shoppingBudget) {
            progressBar.className = "bg-rose-600 h-2.5 rounded-full transition-all duration-500 animate-pulse";
            if (alertMsg) {
                alertMsg.className = "text-[11px] mt-2 font-bold text-rose-600 flex items-center space-x-1";
                alertMsg.innerHTML = `<i class="fas fa-triangle-exclamation"></i><span>🚨 Budget Exceeded by ₹${(subtotal - shoppingBudget).toFixed(2)}!</span>`;
            }
            if (!alertedMilestones[100]) {
                speakText(`Alert: You have exceeded your shopping budget by ₹${(subtotal - shoppingBudget).toFixed(0)}.`);
                alertedMilestones[100] = true;
            }
        } 
        // 2. High Budget Warning Threshold (>= 90%)
        else if (percentage >= 90) {
            progressBar.className = "bg-amber-500 h-2.5 rounded-full transition-all duration-500";
            if (alertMsg) {
                alertMsg.className = "text-[11px] mt-2 font-bold text-amber-600 flex items-center space-x-1";
                alertMsg.innerHTML = `<i class="fas fa-circle-exclamation"></i><span>⚠️ Warning: You've reached ${percentage.toFixed(0)}% of your ₹${shoppingBudget.toFixed(0)} budget! Only ₹${(shoppingBudget - subtotal).toFixed(2)} left.</span>`;
            }
            if (!alertedMilestones[90]) {
                speakText(`Warning: You have reached 90% of your ₹${shoppingBudget.toFixed(0)} budget.`);
                alertedMilestones[90] = true;
            }
            alertedMilestones[100] = false;
        } 
        // 3. Mid-Point Budget Notice Threshold (>= 50%)
        else if (percentage >= 50) {
            progressBar.className = "bg-blue-600 h-2.5 rounded-full transition-all duration-500";
            if (alertMsg) {
                alertMsg.className = "text-[11px] mt-2 font-semibold text-blue-700 flex items-center space-x-1";
                alertMsg.innerHTML = `<i class="fas fa-info-circle"></i><span>Notice: You've reached 50% of your budget (₹${subtotal.toFixed(2)} spent).</span>`;
            }
            if (!alertedMilestones[50]) {
                speakText(`Notice: You have reached 50% of your shopping budget.`);
                alertedMilestones[50] = true;
            }
            alertedMilestones[90] = false;
            alertedMilestones[100] = false;
        } 
        // 4. Normal Threshold (< 50%)
        else {
            progressBar.className = "bg-indigo-600 h-2.5 rounded-full transition-all duration-500";
            if (alertMsg) {
                alertMsg.className = "text-[11px] mt-2 font-medium text-slate-500";
                alertMsg.textContent = `Remaining budget: ₹${(shoppingBudget - subtotal).toFixed(2)}`;
            }
            alertedMilestones[50] = false;
            alertedMilestones[90] = false;
            alertedMilestones[100] = false;
        }
    }
}

function openBudgetModal() {
    const modal = $("budgetModal");
    const input = $("customBudgetInput");
    if (input) input.value = shoppingBudget;
    if (modal) modal.showModal();
}

function closeBudgetModal() {
    const modal = $("budgetModal");
    if (modal) modal.close();
}

function selectPresetBudget(amount) {
    setShoppingBudget(amount);
    closeBudgetModal();
}

function setShoppingBudget(amount) {
    const val = Number(amount);
    if (Number.isFinite(val) && val > 0) {
        shoppingBudget = val;
        localStorage.setItem("trolley_budget", shoppingBudget);
        sessionStorage.setItem("budget_prompted", "true");
        alertedMilestones = { 50: false, 90: false, 100: false };
        renderCart();
    } else {
        alert("Please enter a valid positive budget amount.");
    }
}

function renderCart() {
    const items = Object.values(cart);
    const totalCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Update budget tracker
    updateBudgetTracker(subtotal);

    // Trigger AI Smart Recipe check
    checkRecipeRecommendation();

    // Update summary counts
    if ($("badgeCount")) $("badgeCount").textContent = `${totalCount} item${totalCount === 1 ? '' : 's'}`;
    if ($("summaryTotalItems")) $("summaryTotalItems").textContent = totalCount;
    if ($("summarySubtotal")) $("summarySubtotal").textContent = `₹${subtotal.toFixed(2)}`;
    if ($("summaryTaxes")) $("summaryTaxes").textContent = `₹${(subtotal * 0.05).toFixed(2)}`;
    if ($("summaryPayable")) $("summaryPayable").textContent = `₹${subtotal.toFixed(2)}`;
    if ($("payCheckoutBtn")) $("payCheckoutBtn").disabled = (items.length === 0);

    const emptyView = $("emptyCartView");
    const listView = $("cartItemsList");

    if (items.length === 0) {
        if (emptyView) emptyView.classList.remove("hidden");
        if (listView) {
            listView.classList.add("hidden");
            listView.innerHTML = "";
        }
        return;
    }

    if (emptyView) emptyView.classList.add("hidden");
    if (listView) {
        listView.classList.remove("hidden");
        listView.innerHTML = items.map(item => `
            <div class="slide-in bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-4">
                <div class="flex items-center space-x-3 flex-1 min-w-0">
                    <div class="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-xl shrink-0">
                        🏷️
                    </div>
                    <div class="min-w-0">
                        <h4 class="font-bold text-slate-800 text-sm truncate">${escapeHTML(item.name)}</h4>
                        <p class="text-xs text-slate-400 font-mono mt-0.5">
                            <span class="bg-slate-200/80 text-slate-700 px-1.5 py-0.5 rounded">${item.uid}</span>
                            &bull; ₹${item.price.toFixed(2)} each
                        </p>
                    </div>
                </div>

                <div class="flex items-center gap-4 shrink-0">
                    <div class="flex items-center border border-slate-200 bg-white rounded-lg shadow-sm">
                        <button onclick="changeQuantity('${item.uid}', -1)" class="w-8 h-8 flex items-center justify-center hover:bg-slate-100 font-bold text-slate-600 rounded-l-lg transition">-</button>
                        <span class="w-8 text-center text-sm font-bold">${item.quantity}</span>
                        <button onclick="changeQuantity('${item.uid}', 1)" class="w-8 h-8 flex items-center justify-center hover:bg-slate-100 font-bold text-slate-600 rounded-r-lg transition">+</button>
                    </div>

                    <div class="text-right w-24">
                        <div class="font-extrabold text-slate-900 text-base">₹${(item.price * item.quantity).toFixed(2)}</div>
                        <button onclick="removeItem('${item.uid}')" class="text-[11px] text-rose-500 hover:text-rose-700 hover:underline">Remove</button>
                    </div>
                </div>
            </div>
        `).join("");
    }
}

// -------------------------------------------------------------------------
// 6. Checkout & Stock Deduction
// -------------------------------------------------------------------------
async function processCheckout() {
    const items = Object.values(cart);
    if (!items.length) return;

    const btn = $("payCheckoutBtn");
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Deducting Stock...`;

    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const receiptId = "REC-" + Math.floor(100000 + Math.random() * 900000);

    try {
        for (const item of items) {
            const getRes = await fetch(`${CONFIG.dbUrl}/products/${item.uid}.json?auth=${idToken}`);
            const prod = await getRes.json();

            if (prod) {
                const stockField = prod.stock_quantity !== undefined ? "stock_quantity" : "stock";
                const currentStock = Number(prod[stockField] || 0);
                const updatedStock = Math.max(0, currentStock - item.quantity);

                await fetch(`${CONFIG.dbUrl}/products/${item.uid}/${stockField}.json?auth=${idToken}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updatedStock)
                });
            }
        }

        await fetch(`${CONFIG.dbUrl}/transactions.json?auth=${idToken}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                receipt_id: receiptId,
                trolley_id: "TRL-01",
                total_amount: subtotal,
                total_items: items.reduce((sum, item) => sum + item.quantity, 0),
                timestamp: Date.now(),
                items: cart
            })
        });

        $("receiptNumber").textContent = `#${receiptId}`;
        $("receiptDate").textContent = new Date().toLocaleString("en-IN");
        $("receiptAmount").textContent = `₹${subtotal.toFixed(2)}`;
        $("receiptModal").showModal();

        cart = {};
        renderCart();
        loadProducts();

    } catch (err) {
        console.error("Checkout failed:", err);
        alert("Checkout failed: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-lock text-sm mr-2"></i>Pay & Self-Checkout`;
    }
}

function escapeHTML(str) {
    return String(str || "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

// -------------------------------------------------------------------------
// 7. Gemini AI In-Store Product & Rack Navigator
// -------------------------------------------------------------------------
async function askGeminiAssistant(userQuestion) {
    const messagesContainer = $("aiChatMessages");
    if (!messagesContainer || !userQuestion.trim()) return;

    // Append User message
    const userDiv = document.createElement("div");
    userDiv.className = "flex items-start justify-end space-x-2";
    userDiv.innerHTML = `
        <div class="bg-blue-600 text-white p-2.5 rounded-2xl rounded-tr-none shadow-sm max-w-[80%] leading-relaxed">
            ${escapeHTML(userQuestion)}
        </div>
    `;
    messagesContainer.appendChild(userDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Append loading placeholder
    const botDiv = document.createElement("div");
    botDiv.className = "flex items-start space-x-2";
    const placeholderId = "aiLoading_" + Date.now();
    botDiv.innerHTML = `
        <div class="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 text-xs">🤖</div>
        <div id="${placeholderId}" class="bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-200 text-slate-500 shadow-sm leading-relaxed">
            <i class="fas fa-spinner fa-spin mr-1"></i> Checking store shelves...
        </div>
    `;
    messagesContainer.appendChild(botDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Prepare store catalog context
    const catalogSummary = Object.entries(allProducts).map(([uid, p]) => {
        const name = p.name || 'Unnamed';
        const rack = p.rack || 'Aisle 1 - General Rack';
        const price = p.price || 0;
        const stock = p.stock_quantity ?? p.stock ?? 0;
        return `- ${name}: Location [${rack}], Price [₹${price}], Available Stock [${stock} units]`;
    }).join("\n");

    const systemPrompt = `You are the friendly AI Store Assistant mounted on a Smart IoT Shopping Trolley in Smart Mart Supermarket.

Your roles:
1. PRODUCT LOCATIONS & PRICING: Provide the exact location (Aisle, Rack, Shelf), price, and current stock for items the customer asks about based on the inventory catalog below.
2. GENERAL STORE QUERIES: Answer any general store questions such as store timings, payment methods, return policies, trolley instructions, washrooms, amenities, and discounts.
3. CONVERSATIONAL & CONCISE: Always be polite, warm, direct, and concise (1 to 3 sentences).

Store Details & Information:
- Store Name: Smart Mart Supermarket
- Timings: Open daily from 8:00 AM to 10:00 PM (Monday through Sunday, including public holidays).
- Payment Modes: UPI (Google Pay, PhonePe, Paytm, BHIM), Credit/Debit Cards, Net Banking, and Cash at the Helpdesk. Cashier-less self-checkout can be completed directly on this trolley!
- Return & Refund Policy: 7 days hassle-free return or exchange with digital receipt; same-day return for dairy and fresh perishable items.
- Smart Trolley Features:
  * Drop any RFID-tagged item into the trolley basket; it automatically detects, displays name/price, and adds it to your bill.
  * Real-time budget tracking alerts you at 50% and 90% of your budget.
  * Click 'Pay & Self-Checkout' when done to pay without standing in cashier queues.
- Facilities & Amenities:
  * Restrooms / Washrooms: Located near the rear exit behind Aisle 4.
  * Customer Helpdesk & Manager: Located at the main store entrance near Counter 1.
  * Drinking Water & First Aid: Free at Counter 1.
  * Parking: 2 hours free parking for customers in Basement B1.
- Store Aisles:
  * Aisle 1: Dairy, Fresh Milk, Bread, Bakery & Breakfast
  * Aisle 2: Beverages, Cold Drinks, Snacks & Confectionery
  * Aisle 3: Grains, Rice, Pulses, Cooking Oils & Spices
  * Aisle 4: Personal Care, Soaps & Household Cleaners

Current Supermarket Inventory Catalog:
${catalogSummary}

Guidance:
- If asked about an item in the catalog, state its rack/aisle location, price, and stock.
- If asked about an item NOT in this catalog, politely inform the customer that it is currently out of stock or not available in the store.
- If asked general questions (timings, washrooms, payments, discounts, trolley help), answer using the store details above.`;

    try {
        let replyText = "";
        
        // Priority 1: Check if Vercel serverless /api/chat is available
        try {
            const apiRes = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question: userQuestion,
                    catalog: catalogSummary
                })
            });
            if (apiRes.ok) {
                const apiData = await apiRes.json();
                replyText = apiData.reply;
            }
        } catch (_) {}

        // Priority 2: Direct client fetch fallback using local key
        if (!replyText && CONFIG.geminiKey) {
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${CONFIG.geminiKey}`;
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ parts: [{ text: userQuestion }] }]
                })
            });
            const data = await response.json();
            replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        }

        if (!replyText) {
            replyText = "I couldn't locate that product right now. Please check with store staff!";
        }

        const el = document.getElementById(placeholderId);
        if (el) {
            el.className = "bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-200 text-slate-800 shadow-sm leading-relaxed";
            el.innerHTML = replyText.replace(/\n/g, '<br>');
        }

        // Voice output (Text-to-Speech)
        speakText(replyText);
    } catch (err) {
        console.error("Gemini API error:", err);
        const el = document.getElementById(placeholderId);
        if (el) {
            el.innerHTML = "⚠️ Sorry, could not connect to Store AI Assistant.";
        }
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function askQuickPrompt(question) {
    const input = $("aiChatInput");
    if (input) input.value = question;
    askGeminiAssistant(question);
    if (input) input.value = "";
}

function setupAiChat() {
    const toggleBtn = $("toggleAiChatBtn");
    const closeBtn = $("closeAiChatBtn");
    const panel = $("aiChatPanel");
    const form = $("aiChatForm");
    const input = $("aiChatInput");
    const voiceBtn = $("aiVoiceBtn");
    const speakerBtn = $("aiSpeakerToggleBtn");

    if (toggleBtn && panel) {
        toggleBtn.addEventListener("click", () => {
            panel.classList.toggle("hidden");
            if (!panel.classList.contains("hidden")) {
                input?.focus();
            }
        });
    }

    if (closeBtn && panel) {
        closeBtn.addEventListener("click", () => {
            panel.classList.add("hidden");
        });
    }

    if (form) {
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            const text = input?.value || "";
            if (text.trim()) {
                askGeminiAssistant(text.trim());
                input.value = "";
            }
        });
    }

    if (voiceBtn) {
        voiceBtn.addEventListener("click", toggleVoiceRecognition);
    }

    if (speakerBtn) {
        speakerBtn.addEventListener("click", () => {
            speechEnabled = !speechEnabled;
            if (speechEnabled) {
                speakerBtn.className = "w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-blue-600 flex items-center justify-center text-xs transition";
                speakerBtn.innerHTML = '<i class="fas fa-volume-high"></i>';
                speakerBtn.title = "Text-to-speech enabled";
            } else {
                speakerBtn.className = "w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-400 flex items-center justify-center text-xs transition";
                speakerBtn.innerHTML = '<i class="fas fa-volume-xmark"></i>';
                speakerBtn.title = "Text-to-speech muted";
                if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            }
        });
    }
}

// -------------------------------------------------------------------------
// 8. Text-to-Speech & Speech-to-Text Voice Engine (Warm & Friendly Assistant)
// -------------------------------------------------------------------------
let availableVoices = [];

function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    availableVoices = window.speechSynthesis.getVoices();
}

if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
}

// Gentle pleasant chime using Web Audio API
function playAssistantChime(isStartMic = false) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        if (isStartMic) {
            // Cheerful mic prompt tone (A4 -> C#5)
            const notes = [440.0, 554.37];
            notes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "sine";
                osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                gain.gain.setValueAtTime(0.05, now + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.2);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.08);
                osc.stop(now + idx * 0.08 + 0.2);
            });
        } else {
            // Warm two-note assistant notification chime (C5 -> G5)
            const notes = [523.25, 783.99];
            notes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "sine";
                osc.frequency.setValueAtTime(freq, now + idx * 0.12);
                gain.gain.setValueAtTime(0.06, now + idx * 0.12);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 0.35);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.12);
                osc.stop(now + idx * 0.12 + 0.35);
            });
        }
    } catch (_) {}
}

function findBestFemaleVoice() {
    if (!availableVoices || availableVoices.length === 0) {
        loadVoices();
    }
    // High-priority natural and pleasant female assistant voices
    const preferredVoices = [
        "Google UK English Female",
        "Google US English",
        "Microsoft Jenny Online",
        "Microsoft Aria Online",
        "Samantha",
        "Victoria",
        "Karen",
        "Veena",
        "Zira",
        "Fiona",
        "Tessa"
    ];

    for (const name of preferredVoices) {
        const found = availableVoices.find(v => v.name.toLowerCase().includes(name.toLowerCase()));
        if (found) return found;
    }

    // Try finding any voice with female/natural indicator
    const femaleVoice = availableVoices.find(v => 
        (v.name.toLowerCase().includes("female") || v.name.toLowerCase().includes("natural")) && 
        v.lang.startsWith("en")
    );
    if (femaleVoice) return femaleVoice;

    // Fallback to English voice
    const enVoice = availableVoices.find(v => v.lang === "en-IN" || v.lang === "en-US" || v.lang.startsWith("en"));
    return enVoice || null;
}

function speakText(text) {
    if (!speechEnabled || !('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel(); // Stop any ongoing speech

        // Play gentle audio chime before speaking
        playAssistantChime(false);

        // Clean markdown symbols for cleaner pronunciation
        const cleanText = text.replace(/[*_#`~\[\]]/g, '').trim();
        if (!cleanText) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);

        // Warm, friendly & cheerful assistant tone parameters
        utterance.pitch = 1.25;  // Warm, higher, polite tone
        utterance.rate = 1.02;   // Natural, conversational pace
        utterance.volume = 1.0;

        const voice = findBestFemaleVoice();
        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        } else {
            utterance.lang = 'en-IN';
        }

        window.speechSynthesis.speak(utterance);
    } catch (err) {
        console.warn("Speech synthesis error:", err);
    }
}

function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.log("Web Speech API not supported in this browser.");
        return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';

    recognition.onstart = () => {
        isRecognizing = true;
        playAssistantChime(true);
        const voiceBtn = $("aiVoiceBtn");
        if (voiceBtn) {
            voiceBtn.className = "w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center text-xs transition animate-pulse";
            voiceBtn.innerHTML = `<i class="fas fa-stop"></i>`;
        }
        const input = $("aiChatInput");
        if (input) input.placeholder = "Listening... Speak now!";
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        console.log("Voice transcript:", transcript);
        const input = $("aiChatInput");
        if (input) input.value = transcript;
        askGeminiAssistant(transcript);
        if (input) input.value = "";
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        stopVoiceRecognition();
    };

    recognition.onend = () => {
        stopVoiceRecognition();
    };

    return recognition;
}

function stopVoiceRecognition() {
    isRecognizing = false;
    const voiceBtn = $("aiVoiceBtn");
    if (voiceBtn) {
        voiceBtn.className = "w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs transition";
        voiceBtn.innerHTML = `<i class="fas fa-microphone"></i>`;
    }
    const input = $("aiChatInput");
    if (input) input.placeholder = "Ask: Which rack has Orange Juice?";
}

function toggleVoiceRecognition() {
    if (!speechRecognizer) {
        speechRecognizer = initVoiceRecognition();
    }
    if (!speechRecognizer) {
        alert("Voice recognition is not supported in this browser (Chrome/Edge/Safari desktop supported).");
        return;
    }

    if (isRecognizing) {
        speechRecognizer.stop();
    } else {
        speechRecognizer.start();
    }
}

// -------------------------------------------------------------------------
// 9. AI Recipe & Smart Product Recommender
// -------------------------------------------------------------------------
let recipeDebounceTimer = null;

function checkRecipeRecommendation() {
    const items = Object.values(cart);
    const cartHash = items.map(i => `${i.uid}:${i.quantity}`).sort().join(",");

    // Only query AI when cart items actually changed
    if (cartHash === lastRecipeCheckCartHash) return;
    lastRecipeCheckCartHash = cartHash;

    const card = $("recipeRecommenderCard");
    if (items.length === 0) {
        if (card) card.classList.add("hidden");
        return;
    }

    clearTimeout(recipeDebounceTimer);
    recipeDebounceTimer = setTimeout(async () => {
        const itemNames = items.map(i => i.name).join(", ");
        const availableItems = Object.values(allProducts)
            .filter(p => !cart[p.uid]) // items not already in cart
            .map(p => `${p.name} (Location: ${p.rack || 'Aisle 1'}, Price: ₹${p.price || 0})`)
            .join("; ");

        const prompt = `A customer in a grocery store has these items in their trolley: [${itemNames}].
Available items in the store they haven't picked yet: [${availableItems}].

Suggest 1 complementary recipe idea or matching item they might need (e.g. if they have Milk and Paneer, suggest Rice or Spices).
Format your response as strict JSON with two keys:
{
  "title": "e.g., Making Paneer Curry? or Quick Breakfast Idea",
  "text": "1 friendly sentence explaining what complementary item to pick and which rack it is on.",
  "quickItem": "Name of the single recommended product to ask about"
}`;

        try {
            const apiRes = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: prompt })
            });

            if (apiRes.ok) {
                const data = await apiRes.json();
                let clean = data.reply.replace(/```json/g, '').replace(/```/g, '').trim();
                const json = JSON.parse(clean);

                const cardEl = $("recipeRecommenderCard");
                const titleEl = $("recipeTitle");
                const textEl = $("recipeSuggestionText");
                const chipsEl = $("recipeActionChips");

                if (cardEl && json.title && json.text) {
                    titleEl.textContent = json.title;
                    textEl.textContent = json.text;
                    if (json.quickItem && chipsEl) {
                        chipsEl.innerHTML = `
                            <button onclick="askQuickPrompt('Where is ${escapeHTML(json.quickItem)}?')" class="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-full font-semibold transition">
                                📍 Where is ${escapeHTML(json.quickItem)}?
                            </button>
                        `;
                    }
                    cardEl.classList.remove("hidden");
                }
            }
        } catch (err) {
            console.log("Recipe suggestion skipped:", err);
        }
    }, 1500);
}

function dismissRecipeCard() {
    const card = $("recipeRecommenderCard");
    if (card) card.classList.add("hidden");
}

function setupEventListeners() {
    const clearBtn = $("clearCartBtn");
    const payBtn = $("payCheckoutBtn");
    const closeBtn = $("closeReceiptBtn");
    const setBudgetBtn = $("setBudgetBtn");
    const saveBudgetModalBtn = $("saveBudgetModalBtn");
    const skipBudgetModalBtn = $("skipBudgetModalBtn");

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            if (confirm("Are you sure you want to clear your shopping cart?")) {
                clearCart();
            }
        });
    }
    if (payBtn) payBtn.addEventListener("click", processCheckout);
    if (closeBtn) closeBtn.addEventListener("click", () => $("receiptModal")?.close());
    
    // Budget Modal Listeners
    if (setBudgetBtn) setBudgetBtn.addEventListener("click", openBudgetModal);
    if (saveBudgetModalBtn) {
        saveBudgetModalBtn.addEventListener("click", () => {
            const input = $("customBudgetInput");
            const val = Number(input?.value);
            if (Number.isFinite(val) && val > 0) {
                setShoppingBudget(val);
                closeBudgetModal();
            } else {
                alert("Please enter a valid positive budget amount.");
            }
        });
    }
    if (skipBudgetModalBtn) {
        skipBudgetModalBtn.addEventListener("click", () => {
            sessionStorage.setItem("budget_prompted", "true");
            closeBudgetModal();
        });
    }

    setupAiChat();
}

// Initial Boot Sequence (runs when DOM is loaded)
async function init() {
    setupEventListeners();
    updateBudgetTracker(0);

    // Prompt user to set their shopping budget in the beginning
    if (!sessionStorage.getItem("budget_prompted")) {
        setTimeout(openBudgetModal, 400);
    }

    const success = await authenticate();
    if (success) {
        loadProducts();
        pollScanHistory();

        setInterval(loadProducts, 15000);
        setInterval(pollScanHistory, 800);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
