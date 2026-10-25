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
// 5. Render UI
// -------------------------------------------------------------------------
function renderCart() {
    const items = Object.values(cart);
    const totalCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

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

    const systemPrompt = `You are the AI Assistant on a Smart Shopping Trolley in a supermarket.
Your primary role is to tell customers the exact location (Aisle, Rack, Shelf) of products they ask about, along with their price and stock availability.
Always be concise, polite, helpful, and direct (1-3 sentences max).

Current Supermarket Inventory Catalog:
${catalogSummary}

If a customer asks for an item not in this list, politely explain that it is currently not stocked or registered in the store.`;

    try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${CONFIG.geminiKey}`;
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                contents: [{
                    parts: [{ text: userQuestion }]
                }]
            })
        });

        const data = await response.json();
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text 
            || "I couldn't locate that product right now. Please check with store staff!";

        const el = document.getElementById(placeholderId);
        if (el) {
            el.className = "bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-200 text-slate-800 shadow-sm leading-relaxed";
            el.innerHTML = replyText.replace(/\n/g, '<br>');
        }
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
}

// Event Listeners (Safe guard against DOM not ready)
function setupEventListeners() {
    const clearBtn = $("clearCartBtn");
    const payBtn = $("payCheckoutBtn");
    const closeBtn = $("closeReceiptBtn");

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            if (confirm("Are you sure you want to clear your shopping cart?")) {
                clearCart();
            }
        });
    }
    if (payBtn) payBtn.addEventListener("click", processCheckout);
    if (closeBtn) closeBtn.addEventListener("click", () => $("receiptModal")?.close());

    setupAiChat();
}

// Initial Boot Sequence (runs when DOM is loaded)
async function init() {
    setupEventListeners();

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
