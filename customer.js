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
// 7. Gemini AI Agent: Sentiment-Rich, Calm, Clear & Autonomous Actions
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
        <div id="${placeholderId}" class="bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-200 text-slate-500 shadow-sm leading-relaxed text-xs">
            <i class="fas fa-spinner fa-spin mr-1"></i> Aura is thinking...
        </div>
    `;
    messagesContainer.appendChild(botDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Prepare store catalog & cart context
    const catalogSummary = Object.entries(allProducts).map(([uid, p]) => {
        const name = p.name || 'Unnamed';
        const rack = p.rack || 'Aisle 1 - General Rack';
        const price = p.price || 0;
        const stock = p.stock_quantity ?? p.stock ?? 0;
        return `- ${name} (UID: ${uid}): Location [${rack}], Price [₹${price}], Available Stock [${stock} units]`;
    }).join("\n");

    const cartSummary = Object.values(cart).map(i => `${i.name} (Qty: ${i.quantity}, Price: ₹${i.price})`).join(", ") || "Empty";

    try {
        let rawReply = "";
        
        // Priority 1: Vercel serverless /api/chat
        try {
            const apiRes = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question: userQuestion,
                    catalog: catalogSummary,
                    cart: cartSummary
                })
            });
            if (apiRes.ok) {
                const apiData = await apiRes.json();
                rawReply = apiData.reply;
            }
        } catch (_) {}

        // Priority 2: Direct client fetch fallback
        if (!rawReply && CONFIG.geminiKey) {
            const systemPrompt = `You are Aura, an empathetic, calm, clear, and proactive AI Supermarket Shopping Agent.
Catalog:
${catalogSummary}
Customer Cart:
${cartSummary}
If the user commands an action (add item, remove item, clear cart, set budget, navigate, pay), append [ACTION: {"action": "...", ...}] at the end.`;
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
            rawReply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        }

        if (!rawReply) {
            rawReply = "I understand. Let me help you find whatever you need in the store right away!";
        }

        // Parse and execute agentic actions from response
        const { speechText, actionData } = parseAgentResponse(rawReply);

        const el = document.getElementById(placeholderId);
        if (el) {
            el.className = "bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-200 text-slate-800 shadow-sm leading-relaxed text-xs";
            el.innerHTML = speechText.replace(/\n/g, '<br>');
        }

        // Execute Agent Autonomous Actions
        if (actionData) {
            executeAgentAction(actionData);
        }

        // Voice output with calm, clear, sentiment-rich synthesis
        speakText(speechText);
    } catch (err) {
        console.error("Gemini API error:", err);
        const el = document.getElementById(placeholderId);
        if (el) {
            el.innerHTML = "⚠️ I apologize, I had a brief connection issue. Please tell me again how I can help.";
        }
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Extract [ACTION: {...}] tag and return clean customer text
function parseAgentResponse(fullText) {
    let speechText = fullText;
    let actionData = null;

    const actionMatch = fullText.match(/\[ACTION:\s*({[\s\S]*?})\]/i);
    if (actionMatch) {
        try {
            actionData = JSON.parse(actionMatch[1]);
            speechText = fullText.replace(actionMatch[0], "").trim();
        } catch (e) {
            console.warn("Action JSON parse error:", e);
        }
    }

    return { speechText, actionData };
}

// Autonomous Agent Action Executor
function executeAgentAction(actionObj) {
    if (!actionObj || !actionObj.action) return;
    const act = actionObj.action.toUpperCase();
    console.log("🤖 [Aura Agent Action Executing]:", act, actionObj);

    switch (act) {
        case "ADD_ITEM": {
            const queryName = (actionObj.item || "").toLowerCase();
            const qty = Math.max(1, Number(actionObj.quantity || 1));
            // Find in catalog
            const foundEntry = Object.entries(allProducts).find(([uid, p]) => 
                (p.name || "").toLowerCase().includes(queryName) || uid.toLowerCase() === queryName
            );

            if (foundEntry) {
                const [uid, product] = foundEntry;
                for (let i = 0; i < qty; i++) {
                    addItemToCart(uid, product.name, product.price);
                }
                highlightElement("cartItemsList");
            } else {
                // If item not registered, add placeholder
                addItemToCart("ITEM-" + Date.now().toString().slice(-4), actionObj.item || "Requested Item", 40);
            }
            break;
        }

        case "REMOVE_ITEM": {
            const queryName = (actionObj.item || "").toLowerCase();
            const itemKey = Object.keys(cart).find(uid => 
                (cart[uid].name || "").toLowerCase().includes(queryName) || uid.toLowerCase() === queryName
            );
            if (itemKey) {
                removeItem(itemKey);
                highlightElement("cartItemsList");
            }
            break;
        }

        case "CLEAR_CART": {
            clearCart();
            break;
        }

        case "SET_BUDGET": {
            const amount = Number(actionObj.amount);
            if (Number.isFinite(amount) && amount > 0) {
                setShoppingBudget(amount);
                highlightElement("budgetProgressBar");
            }
            break;
        }

        case "NAVIGATE": {
            const target = (actionObj.target || "").toLowerCase();
            if (target.includes("cart") || target.includes("item")) {
                $("cartItemsList")?.scrollIntoView({ behavior: "smooth" });
                highlightElement("cartItemsList");
            } else if (target.includes("bill") || target.includes("summary") || target.includes("checkout")) {
                $("payCheckoutBtn")?.scrollIntoView({ behavior: "smooth" });
                highlightElement("payCheckoutBtn");
            } else if (target.includes("budget")) {
                $("budgetSpent")?.scrollIntoView({ behavior: "smooth" });
                highlightElement("budgetSpent");
            }
            break;
        }

        case "CHECKOUT": {
            const payBtn = $("payCheckoutBtn");
            if (payBtn && !payBtn.disabled) {
                processCheckout();
            } else {
                alert("Your cart is empty! Please add some items before checking out.");
            }
            break;
        }

        default:
            console.log("Unhandled agent action:", act);
    }
}

function highlightElement(id) {
    const el = $(id);
    if (el) {
        el.classList.add("ring-4", "ring-indigo-400/60", "transition", "duration-500");
        setTimeout(() => el.classList.remove("ring-4", "ring-indigo-400/60"), 1800);
    }
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

function findBestCalmClearVoice() {
    if (!availableVoices || availableVoices.length === 0) {
        loadVoices();
    }
    // High-priority British / UK Professional Concierge voices
    const preferredVoices = [
        "Google UK English Female",
        "Google UK English Male",
        "Microsoft Sonia Online (Natural) - English (United Kingdom)",
        "Microsoft Ryan Online (Natural) - English (United Kingdom)",
        "Microsoft Libby Online (Natural) - English (United Kingdom)",
        "Microsoft Maisie Online (Natural) - English (United Kingdom)",
        "Serena",
        "Oliver",
        "Daniel",
        "Kate",
        "Fiona",
        "Stephanie",
        "Google UK English",
        "Microsoft Jenny Online (Natural)",
        "Microsoft Aria Online (Natural)",
        "Samantha",
        "Victoria"
    ];

    for (const name of preferredVoices) {
        const found = availableVoices.find(v => v.name.toLowerCase().includes(name.toLowerCase()));
        if (found) return found;
    }

    // Try finding any British (en-GB) voice on the system
    const ukVoice = availableVoices.find(v => v.lang === "en-GB" || v.lang.startsWith("en-GB"));
    if (ukVoice) return ukVoice;

    // Try finding natural neural or articulate voice
    const naturalVoice = availableVoices.find(v => 
        (v.name.toLowerCase().includes("natural") || v.name.toLowerCase().includes("premium") || v.name.toLowerCase().includes("female")) && 
        v.lang.startsWith("en")
    );
    if (naturalVoice) return naturalVoice;

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

        // British Concierge: Sophisticated, articulate, calm & clear
        utterance.pitch = 0.98;  // Elegant, composed, slightly deeper British timbre
        utterance.rate = 0.94;   // Measured, aristocratic, crystal-clear pacing
        utterance.volume = 1.0;

        const voice = findBestCalmClearVoice();
        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        } else {
            utterance.lang = 'en-GB';
        }

        window.speechSynthesis.speak(utterance);
    } catch (err) {
        console.warn("Speech synthesis error:", err);
    }
}

// Welcoming voice greeting on opening / session start
function speakWelcomeGreeting() {
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? "Good morning" : (hour < 17 ? "Good afternoon" : "Good evening");
    const welcomeMessage = `${timeGreeting}, and welcome to Smart Mart Supermarket! I am Aura, your personal AI shopping agent. You can ask me to find products, add or remove items from your cart, or check you out anytime. Wishing you a peaceful shopping experience!`;
    
    // Play warm greeting
    setTimeout(() => {
        speakText(welcomeMessage);
    }, 1200);
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

    // Warm, calm welcoming voice greeting on opening
    speakWelcomeGreeting();

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
