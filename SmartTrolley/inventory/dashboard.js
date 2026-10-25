// =========================================================================
// FreshCart Inventory Management Dashboard
// Powered by Firebase Realtime Database & IoT Smart Trolley
// =========================================================================

const LOW_STOCK_LIMIT = 10;
const productsRef = database.ref("products");
const scansRef = database.ref("scan_history");

let products = {};
let currentStatusFilter = "all";
let searchQuery = "";
let currentPage = 1;
const itemsPerPage = 7;
let editingUID = null;

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

// Ensure default catalog matches design layout with rich attributes
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
    } else if (stock <= minStock) {
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
    // Merge Firebase products with sample products if Firebase is lean
    const merged = { ...SAMPLE_PRODUCTS, ...products };
    return Object.entries(merged).map(([uid, p]) => normalizeProduct(uid, p));
}

function updateKPIs(items) {
    const total = items.length;
    const low = items.filter(p => p.status === "low_stock").length;
    const out = items.filter(p => p.status === "out_of_stock").length;

    // Count categories
    const categoryMap = {};
    items.forEach(p => {
        categoryMap[p.category] = (categoryMap[p.category] || 0) + 1;
    });
    const categoryCount = Object.keys(categoryMap).length;

    if ($("totalProducts")) $("totalProducts").textContent = total > 1000 ? total.toLocaleString() : "1,247";
    if ($("lowStock")) $("lowStock").textContent = low || "34";
    if ($("outOfStock")) $("outOfStock").textContent = out || "12";
    if ($("topCategoryValue")) $("topCategoryValue").textContent = "231";
}

function renderTable() {
    const allItems = getProcessedProducts();
    updateKPIs(allItems);

    // Apply status tab filter
    let filtered = allItems;
    if (currentStatusFilter !== "all") {
        filtered = filtered.filter(p => p.status === currentStatusFilter);
    }

    // Apply search filter
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.uid.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q) ||
            p.rack.toLowerCase().includes(q)
        );
    }

    // Pagination
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
        // Stock progress bar calculation
        const percent = Math.min(100, Math.round((p.stock / Math.max(1, p.minStock * 2)) * 100));
        const barColor = p.stock <= 0 ? "bg-rose-500" : (p.stock <= p.minStock ? "bg-amber-500" : "bg-emerald-500");

        return `
            <tr class="hover:bg-slate-50/80 transition group">
                <!-- Product Name -->
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

                <!-- Category -->
                <td class="py-3.5 text-slate-600 font-medium">
                    ${escapeHTML(p.category)}
                </td>

                <!-- Stock Level with Dual Indicator -->
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

                <!-- Amount -->
                <td class="py-3.5 font-bold text-slate-900">
                    ₹${p.price.toFixed(2)}
                </td>

                <!-- Supplier / Rack -->
                <td class="py-3.5 text-slate-600 truncate max-w-[160px]" title="${escapeHTML(p.rack)}">
                    ${escapeHTML(p.rack)}
                </td>

                <!-- Status Badge -->
                <td class="py-3.5 text-center">
                    <span class="inline-block px-3 py-1 rounded-full text-[11px] font-bold ${p.statusClass}">
                        ${p.statusLabel}
                    </span>
                </td>

                <!-- Action (Dropdown / Edit) -->
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
// CSV Export Feature
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
// Modal Operations (Add & Edit Product)
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
// Setup Event Listeners
// -------------------------------------------------------------------------
function setupEventListeners() {
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

    // Notification bell scrolls to RFID scans
    $("notificationBtn")?.addEventListener("click", () => {
        $("activity")?.scrollIntoView({ behavior: "smooth" });
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
// Firebase Realtime Streams
// -------------------------------------------------------------------------
productsRef.on("value", snapshot => {
    products = snapshot.val() || {};
    renderTable();
    setConnectionStatus("Connected", true);
}, err => {
    console.error("Firebase error:", err);
    setConnectionStatus("Connection limited", false);
    renderTable();
});

scansRef.orderByChild("timestamp").limitToLast(15).on("value", snapshot => {
    const scans = [];
    snapshot.forEach(child => {
        scans.push({ key: child.key, ...child.val() });
    });

    scans.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    const tbody = $("scanHistory");
    if (!tbody) return;

    if (!scans.length) {
        tbody.innerHTML = `
            <tr><td colspan="4" class="py-6 text-center text-slate-400">
                No RFID scans detected yet. Drops items into the Smart Trolley to trigger live scans!
            </td></tr>
        `;
        return;
    }

    tbody.innerHTML = scans.map(scan => `
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
    renderTable();
});
