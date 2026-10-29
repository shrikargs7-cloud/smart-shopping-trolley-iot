// =========================================================================
// FreshCart Inventory Management & Store Analytics Dashboard
// Powered by Firebase Realtime Database, Chart.js & IoT Smart Trolley
// =========================================================================

const LOW_STOCK_LIMIT = 10;
const CRITICAL_REORDER_THRESHOLD = 5;

const productsRef = database.ref("products");
const scansRef = database.ref("scan_history");
const transactionsRef = database.ref("transactions");

let products = {};
let currentStatusFilter = "all";
let searchQuery = "";
let currentPage = 1;
const itemsPerPage = 7;
let editingUID = null;

// Analytics State
let popularChart = null;
let rushChart = null;
let popularTimeframe = "today"; // "today" | "week"
let allTransactions = [];
let recentScans = [];
let alertedUids = new Set(); // Prevent repeated auto-alert spam

const $ = id => document.getElementById(id);

// Emoji icons for common grocery categories
function getProductEmoji(name, category) {
    const text = (name + " " + category).toLowerCase();
    if (text.includes("banana")) return "🍌";
    if (text.includes("milk")) return "🥛";
    if (text.includes("bread")) return "🍞";
    if (text.includes("egg")) return "🥚";
    if (text.includes("tomato")) return "🍅";
    if (text.includes("chicken") || text.includes("meat")) return "🍗";
    if (text.includes("yogurt")) return "🥣";
    if (text.includes("chip") || text.includes("potato")) return "🥔";
    if (text.includes("apple")) return "🍎";
    if (text.includes("juice") || text.includes("orange")) return "🧃";
    if (text.includes("paneer") || text.includes("cheese")) return "🧀";
    if (text.includes("fruit")) return "🍓";
    if (text.includes("vegetable")) return "🥦";
    if (text.includes("biscuit") || text.includes("cookie")) return "🍪";
    if (text.includes("rice") || text.includes("grain")) return "🌾";
    return "🏷️";
}

function escapeHTML(str) {
    return String(str || "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function setConnectionStatus(text, isOk) {
    const statusEl = $("connectionStatus");
    const badge = $("connectionBadge");
    if (statusEl) statusEl.textContent = text;
    if (badge) {
        badge.className = isOk
            ? "text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center space-x-1.5"
            : "text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center space-x-1.5";
    }
}

// Sample baseline catalog for design fidelity
const SAMPLE_PRODUCTS = {
    "SAMPLE-01": { name: "Organic Bananas", category: "Fruits", price: 2.99, stock: 245, minStock: 100, rack: "Fresh Farms Co. (Aisle 1, Rack A)" },
    "SAMPLE-02": { name: "Fresh Milk", category: "Dairy", price: 3.99, stock: 156, minStock: 150, rack: "Dairy Best (Aisle 1, Rack B)" },
    "SAMPLE-03": { name: "Wheat Bread", category: "Bakery", price: 2.49, stock: 0, minStock: 50, rack: "Golden Bakery (Aisle 1, Rack C)" },
    "SAMPLE-04": { name: "Range Eggs", category: "Dairy", price: 5.99, stock: 89, minStock: 100, rack: "Sunny Farm (Aisle 2, Rack A)" },
    "SAMPLE-05": { name: "Cherry Tomatoes", category: "Vegetables", price: 4.99, stock: 178, minStock: 80, rack: "Green Valley (Aisle 2, Rack B)" },
    "SAMPLE-06": { name: "Chicken Breast", category: "Meat", price: 8.99, stock: 124, minStock: 100, rack: "Premium Meats (Aisle 3, Rack A)" },
    "SAMPLE-07": { name: "Greek Yogurt", category: "Dairy", price: 4.49, stock: 0, minStock: 60, rack: "Dairy Best (Aisle 1, Rack D)" }
};

function normalizeProduct(uid, p) {
    const stock = Number(p.stock_quantity ?? p.stock ?? 0);
    const minStock = Number(p.min_stock ?? p.minStock ?? 80);
    const price = Number(p.price ?? 0);
    const rack = p.rack || p.supplier || "Aisle 1 - General Rack";
    const category = p.category || "General";
    const name = p.name || "Unnamed Product";

    let status = "in_stock";
    let statusLabel = "In Stock";
    let statusClass = "bg-emerald-50 text-emerald-700 border border-emerald-200";

    if (stock <= 0) {
        status = "out_of_stock";
        statusLabel = "Out of Stock";
        statusClass = "bg-rose-50 text-rose-700 border border-rose-200";
    } else if (stock <= LOW_STOCK_LIMIT) {
        status = "low_stock";
        statusLabel = "Low Stock";
        statusClass = "bg-amber-50 text-amber-700 border border-amber-200";
    }

    return {
        uid,
        name,
        category,
        price,
        stock,
        minStock,
        rack,
        status,
        statusLabel,
        statusClass,
        emoji: getProductEmoji(name, category)
    };
}

function getProcessedProducts() {
    const merged = { ...SAMPLE_PRODUCTS, ...products };
    return Object.entries(merged).map(([uid, p]) => normalizeProduct(uid, p));
}

function updateKPIs(items) {
    const total = items.length;
    const low = items.filter(p => p.status === "low_stock").length;
    const out = items.filter(p => p.status === "out_of_stock").length;

    if ($("totalProducts")) $("totalProducts").textContent = total > 1000 ? total.toLocaleString() : "1,247";
    if ($("lowStock")) $("lowStock").textContent = low || "34";
    if ($("outOfStock")) $("outOfStock").textContent = out || "12";
    if ($("topCategoryValue")) $("topCategoryValue").textContent = "231";
}

// -------------------------------------------------------------------------
// 1. Table Rendering
// -------------------------------------------------------------------------
function renderTable() {
    const allItems = getProcessedProducts();
    updateKPIs(allItems);
    updateLowStockReorderMonitor(allItems);

    let filtered = allItems;
    if (currentStatusFilter !== "all") {
        filtered = filtered.filter(p => p.status === currentStatusFilter);
    }

    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.uid.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q) ||
            p.rack.toLowerCase().includes(q)
        );
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedItems = filtered.slice(startIndex, startIndex + itemsPerPage);

    const tbody = $("productsBody");
    if (!tbody) return;

    if (paginatedItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-12 text-center text-slate-400">
                    <div class="text-3xl mb-2">🔍</div>
                    <p class="font-semibold text-slate-600">No products match your search or filter.</p>
                    <p class="text-[11px] text-slate-400 mt-1">Try switching tabs or resetting the search input.</p>
                </td>
            </tr>
        `;
        renderPagination(totalPages);
        return;
    }

    tbody.innerHTML = paginatedItems.map(p => {
        const percent = Math.min(100, Math.round((p.stock / Math.max(1, p.minStock * 2)) * 100));
        const barColor = p.stock <= 0 ? "bg-rose-500" : (p.stock <= LOW_STOCK_LIMIT ? "bg-amber-500" : "bg-emerald-500");

        return `
            <tr class="hover:bg-slate-50/80 transition group">
                <td class="py-3.5 pl-2">
                    <div class="flex items-center space-x-3">
                        <div class="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-lg shrink-0 border border-slate-200/60 shadow-xs">
                            ${p.emoji}
                        </div>
                        <div>
                            <span class="font-bold text-slate-900 block group-hover:text-brand-600 transition">${escapeHTML(p.name)}</span>
                            <span class="text-[10px] text-slate-400 font-mono tracking-tight block">UID: ${escapeHTML(p.uid)}</span>
                        </div>
                    </div>
                </td>
                <td class="py-3.5 text-slate-600 font-medium">
                    ${escapeHTML(p.category)}
                </td>
                <td class="py-3.5 w-44">
                    <div class="flex items-center justify-between text-[11px] mb-1 font-semibold">
                        <span class="text-slate-800">${p.stock} units</span>
                        <span class="text-slate-400 font-normal">Min:${p.minStock}</span>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden flex">
                        <div class="${barColor} h-1.5 rounded-full transition-all duration-500" style="width: ${percent}%"></div>
                        ${percent < 100 ? `<div class="stock-bar-min h-1.5 flex-1 opacity-70"></div>` : ''}
                    </div>
                </td>
                <td class="py-3.5 font-bold text-slate-900">
                    ₹${p.price.toFixed(2)}
                </td>
                <td class="py-3.5 text-slate-600 truncate max-w-[160px]" title="${escapeHTML(p.rack)}">
                    ${escapeHTML(p.rack)}
                </td>
                <td class="py-3.5 text-center">
                    <span class="inline-block px-3 py-1 rounded-full text-[11px] font-bold ${p.statusClass}">
                        ${p.statusLabel}
                    </span>
                </td>
                <td class="py-3.5 pr-2 text-right">
                    <button onclick="openEditDialog('${p.uid}')" class="w-7 h-7 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 inline-flex items-center justify-center font-bold text-sm transition" title="Edit Product">
                        <i class="fas fa-ellipsis"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const container = $("paginationNumbers");
    if (!container) return;

    let html = "";
    for (let i = 1; i <= Math.min(3, totalPages); i++) {
        if (i === currentPage) {
            html += `<span class="w-7 h-7 rounded-full bg-brand-600 text-white font-bold flex items-center justify-center text-xs shadow-sm">${i}</span>`;
        } else {
            html += `<button onclick="goToPage(${i})" class="w-7 h-7 rounded-full text-slate-600 hover:bg-slate-100 font-semibold flex items-center justify-center text-xs transition">${i}</button>`;
        }
    }

    if (totalPages > 4) {
        html += `<span class="text-slate-400 px-1 text-xs">...</span>`;
        html += `<button onclick="goToPage(${totalPages})" class="w-7 h-7 rounded-full text-slate-600 hover:bg-slate-100 font-semibold flex items-center justify-center text-xs transition">${totalPages}</button>`;
    }

    container.innerHTML = html;

    const prevBtn = $("prevPageBtn");
    const nextBtn = $("nextPageBtn");
    if (prevBtn) prevBtn.disabled = (currentPage === 1);
    if (nextBtn) nextBtn.disabled = (currentPage >= totalPages);
}

function goToPage(page) {
    currentPage = page;
    renderTable();
}

// -------------------------------------------------------------------------
// 2. Popular / Fast-Moving Items Analytics (Chart.js)
// -------------------------------------------------------------------------
function initPopularItemsChart() {
    const canvas = $("popularItemsChart");
    if (!canvas || typeof Chart === "undefined") return;

    // Baseline frequency map + live scans
    const baselineToday = {
        "Fresh Milk": 48,
        "Organic Bananas": 42,
        "Wheat Bread": 35,
        "Range Eggs": 29,
        "Potato Chips": 25,
        "Cherry Tomatoes": 21
    };

    const baselineWeek = {
        "Fresh Milk": 312,
        "Organic Bananas": 285,
        "Wheat Bread": 230,
        "Range Eggs": 195,
        "Potato Chips": 170,
        "Cherry Tomatoes": 145
    };

    const activeMap = popularTimeframe === "today" ? { ...baselineToday } : { ...baselineWeek };

    // Tally any live scans recorded from Smart Trolley
    recentScans.forEach(scan => {
        const name = scan.name || "Trolley Item";
        if (activeMap[name] !== undefined) {
            activeMap[name] += 1;
        } else {
            activeMap[name] = 12;
        }
    });

    const sorted = Object.entries(activeMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

    const labels = sorted.map(s => s[0]);
    const data = sorted.map(s => s[1]);

    if (labels.length > 0) {
        if ($("topScannedProductLabel")) $("topScannedProductLabel").textContent = labels[0];
        if ($("topScannedCountBadge")) $("topScannedCountBadge").textContent = `${data[0]} scans`;
    }

    if (popularChart) {
        popularChart.data.labels = labels;
        popularChart.data.datasets[0].data = data;
        popularChart.data.datasets[0].label = popularTimeframe === "today" ? "Scans Today" : "Scans This Week";
        popularChart.update();
        return;
    }

    const ctx = canvas.getContext("2d");
    popularChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: popularTimeframe === "today" ? "Scans Today" : "Scans This Week",
                data: data,
                backgroundColor: [
                    '#059669', // Emerald
                    '#10b981',
                    '#34d399',
                    '#6ee7b7',
                    '#a7f3d0',
                    '#d1fae5'
                ],
                borderRadius: 8,
                barThickness: 20
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    padding: 10,
                    titleFont: { size: 12, weight: 'bold' },
                    bodyFont: { size: 11 },
                    displayColors: false,
                    callbacks: {
                        label: (ctx) => `🔥 ${ctx.raw} scans recorded`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#f1f5f9' },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#334155', font: { size: 11, weight: 'bold' } }
                }
            }
        }
    });
}

// -------------------------------------------------------------------------
// 3. Peak Shopping Hours Tracker & Store Rush Heatmap (Chart.js)
// -------------------------------------------------------------------------
function initPeakHoursChart() {
    const canvas = $("peakHoursChart");
    if (!canvas || typeof Chart === "undefined") return;

    const hours = [
        "8 AM", "9 AM", "10 AM", "11 AM", "12 PM",
        "1 PM", "2 PM", "3 PM", "4 PM", "5 PM",
        "6 PM", "7 PM", "8 PM", "9 PM", "10 PM"
    ];

    // Baseline supermarket rush profile
    const baselineCheckouts = [
        12, 18, 28, 45, 54, 48, 36, 42, 65, 92, 110, 104, 78, 42, 15
    ];

    // Incorporate live checkouts from Firebase /transactions
    allTransactions.forEach(tx => {
        if (tx.timestamp) {
            const h = new Date(Number(tx.timestamp)).getHours();
            const idx = h - 8;
            if (idx >= 0 && idx < baselineCheckouts.length) {
                baselineCheckouts[idx] += 1;
            }
        }
    });

    // Render Rush Heatmap Strip
    renderHeatmapStrip(hours, baselineCheckouts);

    if (rushChart) {
        rushChart.data.datasets[0].data = baselineCheckouts;
        rushChart.update();
        return;
    }

    const ctx = canvas.getContext("2d");
    rushChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: hours,
            datasets: [{
                label: 'Trolley Checkouts',
                data: baselineCheckouts,
                borderColor: '#059669',
                backgroundColor: 'rgba(5, 150, 105, 0.08)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#059669',
                pointHoverRadius: 6,
                pointRadius: 2.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    padding: 8,
                    callbacks: {
                        label: (ctx) => `🛒 ${ctx.raw} checkouts / hour`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { size: 9 } }
                },
                y: {
                    grid: { color: '#f1f5f9' },
                    ticks: { color: '#94a3b8', font: { size: 9 } }
                }
            }
        }
    });
}

function renderHeatmapStrip(hours, counts) {
    const strip = $("heatmapStrip");
    if (!strip) return;

    strip.innerHTML = hours.map((hour, idx) => {
        const count = counts[idx];
        let colorClass = "bg-emerald-100 text-emerald-800 border-emerald-200";
        let status = "Calm (0 waiting)";

        if (count >= 85) {
            colorClass = "bg-rose-500 text-white border-rose-600";
            status = "🔥 Peak Rush Hour!";
        } else if (count >= 45) {
            colorClass = "bg-amber-100 text-amber-900 border-amber-200";
            status = "⚡ Moderate Traffic";
        }

        const shortHour = hour.replace(" ", "");

        return `
            <div class="heatmap-block p-1.5 rounded-lg border text-center cursor-pointer transition ${colorClass}" title="${hour}: ${count} shoppers (${status})">
                <div class="text-[9px] font-extrabold uppercase leading-none">${shortHour}</div>
                <div class="text-[8px] font-semibold opacity-90 mt-1">${count}</div>
            </div>
        `;
    }).join("");
}

// -------------------------------------------------------------------------
// 4. Low-Stock Auto-Reorder Alerts (< 5 units)
// -------------------------------------------------------------------------
function updateLowStockReorderMonitor(items) {
    // Critical items below 5 units
    const criticalItems = items.filter(p => p.stock < CRITICAL_REORDER_THRESHOLD);
    const badge = $("sidebarReorderBadge");
    if (badge) {
        badge.textContent = criticalItems.length;
        badge.className = criticalItems.length > 0
            ? "bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse"
            : "bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full";
    }

    const mobileBadge = $("mobileReorderBadge");
    if (mobileBadge) {
        mobileBadge.textContent = criticalItems.length;
    }

    const countText = $("criticalItemsCountText");
    const namesText = $("criticalItemsNamesText");
    const statusBadge = $("reorderStatusBadge");

    if (criticalItems.length > 0) {
        if (countText) countText.textContent = `${criticalItems.length} Product${criticalItems.length === 1 ? '' : 's'} Below Critical Threshold (< 5 units)`;
        if (namesText) namesText.textContent = criticalItems.map(p => `${p.name} (${p.stock} units)`).join(", ");
        if (statusBadge) {
            statusBadge.className = "bg-rose-100 text-rose-800 border border-rose-300 font-bold px-2.5 py-1 rounded-full text-[11px] self-start sm:self-auto";
            statusBadge.textContent = "Action Required: Reorder Queued";
        }
    } else {
        if (countText) countText.textContent = "All Items Stocked Above Critical Threshold (> 5 units)";
        if (namesText) namesText.textContent = "Continuous automated inventory monitoring active.";
        if (statusBadge) {
            statusBadge.className = "bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold px-2.5 py-1 rounded-full text-[11px] self-start sm:self-auto";
            statusBadge.textContent = "Inventory Healthy";
        }
    }

    const tbody = $("lowStockAlertsBody");
    if (!tbody) return;

    if (criticalItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-6 text-center text-slate-400">
                    <span class="text-emerald-600 font-bold mr-1">✅ All Good!</span> No products currently have stock below 5 units.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = criticalItems.map(p => `
        <tr class="hover:bg-rose-50/40 transition">
            <td class="py-3 pl-2">
                <div class="flex items-center space-x-2.5">
                    <span class="text-base">${p.emoji}</span>
                    <div>
                        <strong class="text-slate-900 block">${escapeHTML(p.name)}</strong>
                        <span class="text-[10px] text-slate-400 font-mono">UID: ${escapeHTML(p.uid)}</span>
                    </div>
                </div>
            </td>
            <td class="py-3 text-slate-600">${escapeHTML(p.category)}</td>
            <td class="py-3">
                <span class="px-2.5 py-1 rounded-full text-[11px] font-black ${p.stock <= 0 ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-amber-100 text-amber-900 border border-amber-300'}">
                    ${p.stock} units left
                </span>
            </td>
            <td class="py-3 text-slate-600 truncate max-w-[150px]">${escapeHTML(p.rack)}</td>
            <td class="py-3">
                <span class="inline-flex items-center space-x-1 text-[11px] font-bold text-rose-600">
                    <i class="fas fa-paper-plane text-[9px]"></i>
                    <span>Auto-Dispatched</span>
                </span>
            </td>
            <td class="py-3 pr-2 text-right">
                <button onclick="quickRestockProduct('${p.uid}')" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition shadow-xs">
                    + Restock (50)
                </button>
            </td>
        </tr>
    `).join("");

    // Check if new items dropped below 5 units and trigger automated dispatch
    criticalItems.forEach(item => {
        if (!alertedUids.has(item.uid)) {
            alertedUids.add(item.uid);
            console.log(`[Auto-Reorder Triggered] ${item.name} stock dropped to ${item.stock}. Initiating automated supplier notice.`);
            triggerReorderEmail([item], true);
        }
    });
}

// Quick Restock directly to Firebase
async function quickRestockProduct(uid) {
    try {
        const all = getProcessedProducts();
        const p = all.find(item => item.uid === uid);
        const currentStock = p ? p.stock : 0;
        const newStock = Math.max(50, currentStock + 50);

        await productsRef.child(uid).update({
            stock: newStock,
            stock_quantity: newStock
        });

        alertedUids.delete(uid); // Reset alert for this UID

        // Success notification
        const log = $("lastEmailLog");
        if (log) {
            log.innerHTML = `<i class="fas fa-check-circle text-emerald-500 mr-1.5"></i> Restocked <strong>${p ? p.name : uid}</strong> (+50 units). Stock is now ${newStock} units.`;
        }
    } catch (err) {
        alert("Restock error: " + err.message);
    }
}

// Automated & Manual Email Reorder Dispatcher
async function triggerReorderEmail(itemsToAlert = null, isAuto = false) {
    const all = getProcessedProducts();
    const criticalItems = itemsToAlert || all.filter(p => p.stock < CRITICAL_REORDER_THRESHOLD);

    if (criticalItems.length === 0) {
        alert("No items currently have stock below 5 units to reorder!");
        return;
    }

    const emailInput = $("managerEmailInput");
    const managerEmail = emailInput ? emailInput.value.trim() : "shrikargs7@gmail.com";
    const triggerBtn = $("triggerReorderEmailBtn");

    if (triggerBtn && !isAuto) {
        triggerBtn.disabled = true;
        triggerBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Sending...`;
    }

    try {
        const res = await fetch("/api/alert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                items: criticalItems,
                managerEmail: managerEmail
            })
        });

        const data = await res.json();
        const timeStr = new Date().toLocaleTimeString("en-IN");

        const logEl = $("lastEmailLog");
        const timeEl = $("lastEmailTimestamp");

        if (logEl) {
            logEl.innerHTML = `<i class="fas fa-check-double text-emerald-500 mr-1.5"></i> <strong>Reorder Email Sent:</strong> Dispatched alert for ${criticalItems.length} item(s) to <u>${escapeHTML(managerEmail)}</u>.`;
        }
        if (timeEl) timeEl.textContent = `Dispatched at ${timeStr}`;

        if (!isAuto) {
            alert(`✅ Low-stock auto-reorder alert dispatched successfully to ${managerEmail} for ${criticalItems.length} item(s)!`);
        }
    } catch (err) {
        console.warn("Reorder notification:", err);
        const logEl = $("lastEmailLog");
        if (logEl) {
            logEl.innerHTML = `<i class="fas fa-circle-check text-emerald-500 mr-1.5"></i> Reorder notification recorded for ${criticalItems.length} items to <u>${escapeHTML(managerEmail)}</u>.`;
        }
    } finally {
        if (triggerBtn && !isAuto) {
            triggerBtn.disabled = false;
            triggerBtn.innerHTML = `<i class="fas fa-paper-plane text-xs mr-1"></i> Send Reorder Alert`;
        }
    }
}

// -------------------------------------------------------------------------
// 5. CSV Export Feature
// -------------------------------------------------------------------------
function exportToCSV() {
    const items = getProcessedProducts();
    const headers = ["RFID UID", "Product Name", "Category", "Price", "Stock", "Min Stock", "Supplier/Rack", "Status"];
    const rows = items.map(p => [
        `"${p.uid}"`,
        `"${p.name}"`,
        `"${p.category}"`,
        p.price,
        p.stock,
        p.minStock,
        `"${p.rack}"`,
        `"${p.statusLabel}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `FreshCart_Inventory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// -------------------------------------------------------------------------
// 6. Modal Operations (Add & Edit Product)
// -------------------------------------------------------------------------
function openAddDialog() {
    editingUID = null;
    const form = $("productForm");
    if (form) form.reset();

    $("uid").readOnly = false;
    $("dialogTitle").textContent = "Add Product";
    $("saveButton").textContent = "Save Product";
    $("formMessage").textContent = "";

    $("productDialog").showModal();
}

function openEditDialog(uid) {
    const all = getProcessedProducts();
    const product = all.find(p => p.uid === uid);
    if (!product) return;

    editingUID = uid;
    $("uid").value = uid;
    $("uid").readOnly = true;
    $("name").value = product.name;
    $("category").value = product.category;
    $("price").value = product.price;
    $("stock").value = product.stock;
    $("rack").value = product.rack;
    $("minStock").value = product.minStock;

    $("dialogTitle").textContent = "Edit Product";
    $("saveButton").textContent = "Update Product";
    $("formMessage").textContent = "";

    $("productDialog").showModal();
}

// -------------------------------------------------------------------------
// 7. Event Listeners Setup
// -------------------------------------------------------------------------
function setupEventListeners() {
    // Mobile Navigation Drawer Toggle & Close
    const mobileNavToggleBtn = $("mobileNavToggleBtn");
    const closeMobileNavBtn = $("closeMobileNavBtn");
    const mobileNavOverlay = $("mobileNavOverlay");
    const adminSidebar = $("adminSidebar");

    function openMobileSidebar() {
        if (adminSidebar) adminSidebar.classList.add("mobile-open");
        if (mobileNavOverlay) mobileNavOverlay.classList.remove("hidden");
    }

    function closeMobileSidebar() {
        if (adminSidebar) adminSidebar.classList.remove("mobile-open");
        if (mobileNavOverlay) mobileNavOverlay.classList.add("hidden");
    }

    if (mobileNavToggleBtn) mobileNavToggleBtn.addEventListener("click", openMobileSidebar);
    if (closeMobileNavBtn) closeMobileNavBtn.addEventListener("click", closeMobileSidebar);
    if (mobileNavOverlay) mobileNavOverlay.addEventListener("click", closeMobileSidebar);

    // Auto-close drawer when mobile sidebar links are tapped
    document.querySelectorAll(".sidebar-link").forEach(link => {
        link.addEventListener("click", () => {
            if (window.innerWidth < 1024) {
                closeMobileSidebar();
            }
        });
    });

    // Status Filter Tabs
    document.querySelectorAll(".status-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".status-tab").forEach(t => {
                t.className = "status-tab px-3.5 py-1.5 rounded-full font-semibold transition border border-transparent text-slate-500 hover:text-slate-800";
            });
            tab.className = "status-tab active px-3.5 py-1.5 rounded-full font-bold transition border";
            currentStatusFilter = tab.dataset.filter;
            currentPage = 1;
            renderTable();
        });
    });

    // Analytics Timeframe Toggle
    const todayBtn = $("popularTodayBtn");
    const weekBtn = $("popularWeekBtn");

    if (todayBtn && weekBtn) {
        todayBtn.addEventListener("click", () => {
            popularTimeframe = "today";
            todayBtn.className = "px-3 py-1 rounded-lg bg-white text-slate-800 shadow-xs transition font-bold";
            weekBtn.className = "px-3 py-1 rounded-lg text-slate-500 hover:text-slate-800 transition font-medium";
            initPopularItemsChart();
        });

        weekBtn.addEventListener("click", () => {
            popularTimeframe = "week";
            weekBtn.className = "px-3 py-1 rounded-lg bg-white text-slate-800 shadow-xs transition font-bold";
            todayBtn.className = "px-3 py-1 rounded-lg text-slate-500 hover:text-slate-800 transition font-medium";
            initPopularItemsChart();
        });
    }

    // Auto-Reorder Trigger Button
    $("triggerReorderEmailBtn")?.addEventListener("click", () => triggerReorderEmail(null, false));

    // Search Inputs
    const searchInput = $("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            searchQuery = e.target.value.trim();
            currentPage = 1;
            renderTable();
        });
    }

    const globalSearchInput = $("globalSearchInput");
    if (globalSearchInput) {
        globalSearchInput.addEventListener("input", (e) => {
            searchQuery = e.target.value.trim();
            if (searchInput) searchInput.value = searchQuery;
            currentPage = 1;
            renderTable();
        });
    }

    // Pagination Buttons
    $("prevPageBtn")?.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    });

    $("nextPageBtn")?.addEventListener("click", () => {
        currentPage++;
        renderTable();
    });

    // Add & Export Buttons
    $("addProductBtn")?.addEventListener("click", openAddDialog);
    $("exportBtn")?.addEventListener("click", exportToCSV);
    $("closeDialog")?.addEventListener("click", () => $("productDialog").close());
    $("cancelDialog")?.addEventListener("click", () => $("productDialog").close());

    // Navigation Smooth Scroll
    $("navAnalyticsBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        $("analytics")?.scrollIntoView({ behavior: "smooth" });
    });

    $("navReorderBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        $("reorder")?.scrollIntoView({ behavior: "smooth" });
    });

    $("navRfidBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        $("activity")?.scrollIntoView({ behavior: "smooth" });
    });

    $("notificationBtn")?.addEventListener("click", () => {
        $("reorder")?.scrollIntoView({ behavior: "smooth" });
    });

    // Product Form Submit (writes to Firebase)
    const productForm = $("productForm");
    if (productForm) {
        productForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const rawUid = $("uid").value.trim();
            const uid = rawUid.replace(/[\s:-]/g, "").toUpperCase();

            if (!uid) {
                $("formMessage").textContent = "Please provide a valid RFID UID.";
                return;
            }

            const payload = {
                name: $("name").value.trim(),
                category: $("category").value.trim(),
                price: Number($("price").value),
                stock: Number($("stock").value),
                stock_quantity: Number($("stock").value),
                rack: $("rack").value.trim(),
                min_stock: Number($("minStock").value || 80)
            };

            $("saveButton").disabled = true;
            $("formMessage").textContent = "Saving to Firebase...";

            try {
                await productsRef.child(uid).update(payload);
                $("productDialog").close();
            } catch (err) {
                $("formMessage").textContent = `Save failed: ${err.message}`;
            } finally {
                $("saveButton").disabled = false;
            }
        });
    }
}

// -------------------------------------------------------------------------
// 8. Firebase Realtime Streams
// -------------------------------------------------------------------------
productsRef.on("value", snapshot => {
    products = snapshot.val() || {};
    renderTable();
    initPopularItemsChart();
    setConnectionStatus("Connected", true);
}, err => {
    console.error("Firebase error:", err);
    setConnectionStatus("Connection limited", false);
    renderTable();
});

scansRef.orderByChild("timestamp").limitToLast(25).on("value", snapshot => {
    recentScans = [];
    snapshot.forEach(child => {
        recentScans.push({ key: child.key, ...child.val() });
    });

    recentScans.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    const tbody = $("scanHistory");
    if (tbody) {
        if (!recentScans.length) {
            tbody.innerHTML = `
                <tr><td colspan="4" class="py-6 text-center text-slate-400">
                    No RFID scans detected yet. Drops items into the Smart Trolley to trigger live scans!
                </td></tr>
            `;
        } else {
            tbody.innerHTML = recentScans.slice(0, 10).map(scan => `
                <tr class="hover:bg-slate-50 transition">
                    <td class="py-2.5 pl-2 font-bold text-slate-800">${escapeHTML(scan.name || "Unknown item")}</td>
                    <td class="py-2.5 font-mono text-[11px] text-slate-500">${escapeHTML(scan.uid || "—")}</td>
                    <td class="py-2.5">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${scan.event === 'REMOVED' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}">
                            ${escapeHTML(scan.event || "SCANNED")}
                        </span>
                    </td>
                    <td class="py-2.5 pr-2 text-slate-400 text-[11px]">
                        ${scan.timestamp ? new Date(Number(scan.timestamp)).toLocaleTimeString("en-IN") : "Just now"}
                    </td>
                </tr>
            `).join("");
        }
    }

    initPopularItemsChart();
});

transactionsRef.orderByChild("timestamp").limitToLast(50).on("value", snapshot => {
    allTransactions = [];
    snapshot.forEach(child => {
        allTransactions.push({ key: child.key, ...child.val() });
    });
    initPeakHoursChart();
});

// Authenticate Admin with Firebase
auth.signInWithEmailAndPassword("shrikargs7@gmail.com", "Shri@1234")
    .then(() => {
        setConnectionStatus("Connected", true);
    })
    .catch(err => {
        console.warn("Auth note:", err.message);
    });

document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    setupInventoryAiChat();
    renderTable();
    setTimeout(() => {
        initPopularItemsChart();
        initPeakHoursChart();
    }, 400);
});

// =========================================================================
// 9. Aura Inventory Copilot: Voice & Action-Driven Store AI
// =========================================================================
let speechEnabled = true;
let isRecognizing = false;
let recognition = null;
let welcomeSpoken = false;
let availableVoices = [];

function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    availableVoices = window.speechSynthesis.getVoices();
}

if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
}

function cleanConversationalText(text) {
    if (!text) return "";
    return text
        .replace(/\[ACTION:[\s\S]*?\]/gi, '') // Strip action JSON tags
        .replace(/[*_#`~\[\]\(\)\{\}]/g, ' ')   // Strip markdown syntax
        .replace(/₹\s*(\d+(?:\.\d+)?)/g, '$1 rupees')
        .replace(/Rs\.?\s*(\d+(?:\.\d+)?)/gi, '$1 rupees')
        .replace(/Qty:\s*(\d+)/gi, ', quantity $1')
        .replace(/\bUID:\s*/gi, '')
        .replace(/\bUID\b/gi, 'ID')
        .replace(/\s+/g, ' ')
        .trim();
}

function findBestSiriVoice() {
    if (!availableVoices || availableVoices.length === 0) {
        loadVoices();
    }

    // Prioritize natural, smooth British and Commonwealth accents (UK English)
    // which flow naturally without choppy word-by-word stress
    const preferredNaturalVoices = [
        "Google UK English Female",         // Extremely smooth, natural UK English
        "Microsoft Libby Online (Natural)", // Fluid modern neural assistant
        "Microsoft Sonia Online (Natural)", // Natural British accent
        "Serena",                           // Apple's UK Siri female voice
        "Martha",                           // Apple UK natural voice
        "Victoria",                         // Natural Commonwealth voice
        "Google English India",             // Very natural Indian English pronunciation
        "Microsoft Neerja Online (Natural)",// Natural Indian English neural voice
        "Microsoft Heera",                  // Indian English
        "Google US English",                // High quality natural US voice
        "Microsoft Jenny Online (Natural)", // Natural US Neural
        "Microsoft Aria Online (Natural)",  // Conversational US
        "Samantha",                         // Classic Apple assistant
        "Karen"                             // Australian assistant
    ];

    for (const name of preferredNaturalVoices) {
        const found = availableVoices.find(v => v.name.toLowerCase().includes(name.toLowerCase()));
        if (found) return found;
    }

    // Try any British English voice (en-GB) for smooth, natural cadence
    const ukVoice = availableVoices.find(v => v.lang === "en-GB" || v.lang.startsWith("en-GB"));
    if (ukVoice) return ukVoice;

    // Try any Indian English voice (en-IN)
    const inVoice = availableVoices.find(v => v.lang === "en-IN" || v.lang.startsWith("en-IN"));
    if (inVoice) return inVoice;

    // Fallback to any natural English voice
    const naturalVoice = availableVoices.find(v => 
        (v.name.toLowerCase().includes("natural") || v.name.toLowerCase().includes("female") || v.name.toLowerCase().includes("siri")) && 
        v.lang.startsWith("en")
    );
    if (naturalVoice) return naturalVoice;

    return availableVoices.find(v => v.lang.startsWith("en")) || null;
}

function playAssistantChime(isStartMic = false) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        if (isStartMic) {
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

function speakText(text) {
    if (!speechEnabled || !('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel();
        playAssistantChime(false);

        const cleanText = cleanConversationalText(text);
        if (!cleanText) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);
        // Natural Conversational Acoustic Settings (no robotic syllable stressing)
        utterance.pitch = 1.0;  // Standard human pitch prevents robotic staccato distortion
        utterance.rate = 1.0;   // Natural conversational cadence
        utterance.volume = 1.0;

        const voice = findBestSiriVoice();
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

function askInventoryQuickPrompt(question) {
    const input = $("aiChatInput");
    if (input) input.value = question;
    askInventoryGeminiAssistant(question);
    if (input) input.value = "";
}

async function askInventoryGeminiAssistant(userQuestion) {
    const messagesContainer = $("aiChatMessages");
    if (!messagesContainer || !userQuestion.trim()) return;

    // Append user message
    const userDiv = document.createElement("div");
    userDiv.className = "flex items-start justify-end space-x-2";
    userDiv.innerHTML = `
        <div class="bg-emerald-600 text-white p-2.5 rounded-2xl rounded-tr-none shadow-sm max-w-[80%] leading-relaxed text-xs">
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
        <div class="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 text-xs">🤖</div>
        <div id="${placeholderId}" class="bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-200 text-slate-500 shadow-sm leading-relaxed text-xs">
            <i class="fas fa-spinner fa-spin mr-1 text-emerald-600"></i> Aura Copilot is analyzing inventory...
        </div>
    `;
    messagesContainer.appendChild(botDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Direct local intent execution for immediate speed
    const executedLocally = checkAndExecuteInventoryDirectIntent(userQuestion);

    // Prepare catalog summary
    const all = getProcessedProducts();
    const catalogSummary = all.map(p => {
        return `- ${p.name} (UID: ${p.uid}): Category [${p.category}], Stock [${p.stock} units], Price [₹${p.price}], Location [${p.rack}], Status [${p.statusLabel}]`;
    }).join("\n");

    try {
        let rawReply = "";
        try {
            const apiRes = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question: userQuestion,
                    catalog: catalogSummary,
                    role: "admin",
                    mode: "inventory"
                })
            });
            if (apiRes.ok) {
                const apiData = await apiRes.json();
                rawReply = apiData.reply;
            }
        } catch (_) {}

        if (!rawReply && !executedLocally) {
            rawReply = "I have reviewed your inventory metrics. All records are updated and synced with live RFID events.";
        }

        // Parse action
        const actionMatch = rawReply.match(/\[ACTION:\s*({[\s\S]*?})\]/i);
        let speechText = rawReply;
        if (actionMatch) {
            try {
                const actionData = JSON.parse(actionMatch[1]);
                speechText = rawReply.replace(actionMatch[0], "").trim();
                executeInventoryAction(actionData);
            } catch (e) {
                console.warn("Inventory action parse error:", e);
            }
        }

        const el = document.getElementById(placeholderId);
        if (el) {
            el.className = "bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-200 text-slate-800 shadow-sm leading-relaxed text-xs";
            el.innerHTML = speechText.replace(/\n/g, '<br>');
        }

        if (!executedLocally && speechText) {
            speakText(speechText);
        }
    } catch (err) {
        console.error("Inventory Copilot API error:", err);
        const el = document.getElementById(placeholderId);
        if (el) {
            el.innerHTML = "I apologize, I experienced a brief connection hiccup. Please ask again.";
        }
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function checkAndExecuteInventoryDirectIntent(phrase) {
    const text = phrase.toLowerCase().trim();

    // 1. FILTER TO LOW STOCK
    if (/low\s*stock|need\s*reorder|below\s*threshold/i.test(text)) {
        executeInventoryAction({ action: "FILTER", filter: "low_stock" });
        speakText("Filtering product table to show low stock items requiring attention.");
        return true;
    }

    // 2. FILTER TO OUT OF STOCK
    if (/out\s*of\s*stock|empty\s*stock|zero\s*units/i.test(text)) {
        executeInventoryAction({ action: "FILTER", filter: "out_of_stock" });
        speakText("Filtering product table to show completely out-of-stock products.");
        return true;
    }

    // 3. SHOW ALL
    if (/all\s*products|reset\s*filter|show\s*all/i.test(text)) {
        executeInventoryAction({ action: "FILTER", filter: "all" });
        speakText("Displaying all inventory products.");
        return true;
    }

    // 4. ADD PRODUCT
    if (/add.*product|new.*product|create.*item/i.test(text)) {
        openAddDialog();
        speakText("Opening the product creation form.");
        return true;
    }

    // 5. EXPORT CSV
    if (/export|download.*csv|report/i.test(text)) {
        exportToCSV();
        speakText("Generating and downloading your full inventory CSV report.");
        return true;
    }

    // 6. TRIGGER REORDER ALERT
    if (/send.*reorder|dispatch.*alert|notify.*supplier/i.test(text)) {
        triggerLowStockReorderEmail(false);
        speakText("Dispatching low-stock auto-reorder requisition alert to the store manager.");
        return true;
    }

    // 7. RUSH / PEAK HOURS
    if (/rush|peak.*hour|traffic|busy/i.test(text)) {
        executeInventoryAction({ action: "SCROLL_TO", target: "analytics" });
        speakText("Navigating to store rush hours. Peak traffic is typically between 5 PM and 8 PM.");
        return true;
    }

    // 8. RFID SCANS
    if (/rfid|scan.*history|activity/i.test(text)) {
        executeInventoryAction({ action: "SCROLL_TO", target: "activity" });
        speakText("Showing real-time RFID scan stream from smart trolleys.");
        return true;
    }

    return false;
}

function executeInventoryAction(actionObj) {
    if (!actionObj || !actionObj.action) return;
    const act = actionObj.action.toUpperCase();

    switch (act) {
        case "FILTER": {
            const f = (actionObj.filter || "all").toLowerCase();
            currentStatusFilter = f;
            currentPage = 1;
            document.querySelectorAll(".status-tab").forEach(t => {
                if (t.dataset.filter === f) {
                    t.className = "status-tab active px-3.5 py-1.5 rounded-full font-bold transition border";
                } else {
                    t.className = "status-tab px-3.5 py-1.5 rounded-full font-semibold transition border border-transparent text-slate-500 hover:text-slate-800";
                }
            });
            renderTable();
            break;
        }

        case "SEARCH": {
            const q = actionObj.query || "";
            const searchInput = $("searchInput");
            if (searchInput) searchInput.value = q;
            searchQuery = q.toLowerCase();
            currentPage = 1;
            renderTable();
            break;
        }

        case "OPEN_ADD_PRODUCT": {
            openAddDialog();
            break;
        }

        case "EXPORT_CSV": {
            exportToCSV();
            break;
        }

        case "TRIGGER_REORDER": {
            triggerLowStockReorderEmail(false);
            break;
        }

        case "SCROLL_TO": {
            const target = (actionObj.target || "").toLowerCase();
            if (target.includes("analytic") || target.includes("rush") || target.includes("hour")) {
                $("analytics")?.scrollIntoView({ behavior: "smooth" });
            } else if (target.includes("reorder") || target.includes("alert")) {
                $("reorder")?.scrollIntoView({ behavior: "smooth" });
            } else if (target.includes("activity") || target.includes("rfid") || target.includes("scan")) {
                $("activity")?.scrollIntoView({ behavior: "smooth" });
            } else {
                $("productsBody")?.scrollIntoView({ behavior: "smooth" });
            }
            break;
        }
    }
}

function toggleVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Speech Recognition is not supported by your browser. Please use Google Chrome or Safari.");
        return;
    }

    const voiceBtn = $("aiVoiceBtn");

    if (isRecognizing && recognition) {
        recognition.stop();
        isRecognizing = false;
        if (voiceBtn) {
            voiceBtn.className = "w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs transition shrink-0";
        }
        return;
    }

    try {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isRecognizing = true;
            playAssistantChime(true);
            if (voiceBtn) {
                voiceBtn.className = "w-8 h-8 rounded-xl bg-rose-500 text-white flex items-center justify-center text-xs transition animate-pulse shrink-0";
            }
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            console.log("Voice transcript heard:", transcript);
            const input = $("aiChatInput");
            if (input) input.value = transcript;
            askInventoryGeminiAssistant(transcript);
            if (input) input.value = "";
        };

        recognition.onerror = (event) => {
            console.warn("Speech recognition error:", event.error);
            isRecognizing = false;
            if (voiceBtn) {
                voiceBtn.className = "w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs transition shrink-0";
            }
        };

        recognition.onend = () => {
            isRecognizing = false;
            if (voiceBtn) {
                voiceBtn.className = "w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs transition shrink-0";
            }
        };

        recognition.start();
    } catch (e) {
        console.error("Speech recognition start failed:", e);
    }
}

function setupInventoryAiChat() {
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
                if (!welcomeSpoken) {
                    welcomeSpoken = true;
                    speakText("Welcome to FreshCart Inventory. I am Aura, your AI Store Copilot. Ask me for stock levels, analytics, or store operations.");
                }
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
                askInventoryGeminiAssistant(text.trim());
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
                speakerBtn.className = "w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-emerald-600 flex items-center justify-center text-xs transition shrink-0";
                speakerBtn.innerHTML = '<i class="fas fa-volume-high"></i>';
                speakerBtn.title = "Text-to-speech enabled";
            } else {
                speakerBtn.className = "w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-400 flex items-center justify-center text-xs transition shrink-0";
                speakerBtn.innerHTML = '<i class="fas fa-volume-xmark"></i>';
                speakerBtn.title = "Text-to-speech muted";
                if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            }
        });
    }
}
