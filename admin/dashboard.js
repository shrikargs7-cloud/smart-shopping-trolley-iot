const LOW_STOCK_LIMIT = 5;
const EXPIRY_WARNING_DAYS = 7;

const productsRef = database.ref("products");
const scansRef = database.ref("scan_history");

const productsBody = document.getElementById("productsBody");
const scanHistoryBody = document.getElementById("scanHistory");
const stockAlerts = document.getElementById("stockAlerts");
const productDialog = document.getElementById("productDialog");
const productForm = document.getElementById("productForm");

let products = {};
let editingUID = null;

const $ = (id) => document.getElementById(id);

function setConnectionStatus(message, state = "") {
    $("connectionStatus").textContent = message;

    const dot = document.querySelector(".connection-dot");
    dot.className = "connection-dot";

    if (state) {
        dot.classList.add(state);
    }
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}
function normaliseProduct(product) {
    return {
        name: product.name || "Unnamed product",
        category: product.category || "Uncategorised",
        price: Number(product.price) || 0,
        // Map stock_quantity from JSON to stock
        stock: Math.max(0, Number(product.stock_quantity ?? product.stock) || 0),
        // Map unit from JSON to quantity (pack size)
        quantity: product.unit || product.quantity || "",
        // Map expiry_date from JSON to expiry
        expiry: product.expiry_date || product.expiry || ""
    };
}

function getStatus(stock) {
    if (stock <= 0) {
        return { label: "Out of stock", className: "badge-out" };
    }

    if (stock <= LOW_STOCK_LIMIT) {
        return { label: "Low stock", className: "badge-low" };
    }

    return { label: "In stock", className: "badge-ok" };
}

function formatDate(dateString) {
    if (!dateString) return "—";

    const date = new Date(`${dateString}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
        return escapeHTML(dateString);
    }

    return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function getExpiryDays(expiry) {
    if (!expiry) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiryDate = new Date(`${expiry}T00:00:00`);

    if (Number.isNaN(expiryDate.getTime())) return null;

    return Math.ceil((expiryDate - today) / 86400000);
}

function renderDashboard() {
    const entries = Object.entries(products).map(([uid, value]) => ({
        uid,
        ...normaliseProduct(value)
    }));

    $("totalProducts").textContent = entries.length;
    $("totalUnits").textContent = entries.reduce((sum, p) => sum + p.stock, 0);
    $("lowStock").textContent = entries.filter(
        p => p.stock > 0 && p.stock <= LOW_STOCK_LIMIT
    ).length;
    $("outOfStock").textContent = entries.filter(p => p.stock === 0).length;

    renderCategoryFilter(entries);
    renderProductTable(entries);
    renderAlerts(entries);
}

function renderCategoryFilter(entries) {
    const select = $("categoryFilter");
    const previousValue = select.value;

    const categories = [...new Set(entries.map(p => p.category))]
        .sort((a, b) => a.localeCompare(b));

    select.innerHTML = '<option value="all">All categories</option>';

    categories.forEach(category => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
    });

    if (categories.includes(previousValue)) {
        select.value = previousValue;
    }
}

function renderProductTable(entries) {
    const query = $("searchInput").value.trim().toLowerCase();
    const selectedCategory = $("categoryFilter").value;

    const filtered = entries.filter(product => {
        const matchesSearch =
            product.name.toLowerCase().includes(query) ||
            product.uid.toLowerCase().includes(query) ||
            product.category.toLowerCase().includes(query);

        const matchesCategory =
            selectedCategory === "all" ||
            product.category === selectedCategory;

        return matchesSearch && matchesCategory;
    });

    if (!filtered.length) {
        productsBody.innerHTML = `
            <tr><td colspan="8" class="empty-state">
                No matching products found.
            </td></tr>`;
        return;
    }

    productsBody.innerHTML = filtered.map(product => {
        const status = getStatus(product.stock);

        return `
            <tr>
                <td>
                    <span class="product-name">${escapeHTML(product.name)}</span>
                    <span class="product-size">${escapeHTML(product.quantity)}</span>
                </td>
                <td>${escapeHTML(product.uid)}</td>
                <td>${escapeHTML(product.category)}</td>
                <td>₹${product.price.toFixed(2)}</td>
                <td>${product.stock}</td>
                <td>${formatDate(product.expiry)}</td>
                <td><span class="badge ${status.className}">
                    ${status.label}
                </span></td>
                <td>
                    <button class="edit-button"
                        data-edit-uid="${escapeHTML(product.uid)}">
                        Edit
                    </button>
                </td>
            </tr>`;
    }).join("");
}

function renderAlerts(entries) {
    const alerts = [];

    entries.forEach(product => {
        const name = escapeHTML(product.name);
        const uid = escapeHTML(product.uid);

        if (product.stock === 0) {
            alerts.push({
                className: "alert-out",
                title: "Out of stock",
                text: `${name} · UID ${uid}`
            });
        } else if (product.stock <= LOW_STOCK_LIMIT) {
            alerts.push({
                className: "alert-low",
                title: "Low stock",
                text: `${name}: ${product.stock} units remaining`
            });
        }

        const days = getExpiryDays(product.expiry);

        if (days !== null && days < 0) {
            alerts.push({
                className: "alert-out",
                title: "Expired",
                text: `${name} expired on ${formatDate(product.expiry)}`
            });
        } else if (days !== null && days <= EXPIRY_WARNING_DAYS) {
            alerts.push({
                className: "alert-expiry",
                title: "Expiry approaching",
                text: `${name} expires in ${days} day(s)`
            });
        }
    });

    if (!alerts.length) {
        stockAlerts.innerHTML = `
            <div class="alert-item alert-ok">
                <strong>All clear</strong>
                No low-stock, out-of-stock or near-expiry alerts.
            </div>`;
        return;
    }

    stockAlerts.innerHTML = alerts.map(alert => `
        <div class="alert-item ${alert.className}">
            <strong>${alert.title}</strong>
            ${alert.text}
        </div>
    `).join("");
}

function openAddDialog() {
    editingUID = null;
    productForm.reset();

    $("uid").readOnly = false;
    $("dialogTitle").textContent = "Add Product";
    $("saveButton").textContent = "Save Product";
    $("formMessage").textContent = "";

    productDialog.showModal();
}

function openEditDialog(uid) {
    const product = products[uid];

    if (!product) return;

    editingUID = uid;

    $("uid").value = uid;
    $("uid").readOnly = true;
    $("name").value = product.name || "";
    $("category").value = product.category || "";
    $("price").value = product.price ?? 0;
    $("stock").value = product.stock ?? 0;
    $("quantity").value = product.quantity || "";
    $("expiry").value = product.expiry || "";

    $("dialogTitle").textContent = "Edit Product";
    $("saveButton").textContent = "Update Product";
    $("formMessage").textContent = "";

    productDialog.showModal();
}

$("addProductBtn").addEventListener("click", openAddDialog);
$("closeDialog").addEventListener("click", () => productDialog.close());
$("cancelDialog").addEventListener("click", () => productDialog.close());

$("searchInput").addEventListener("input", renderDashboard);
$("categoryFilter").addEventListener("change", renderDashboard);

$("refreshBtn").addEventListener("click", () => {
    productsRef.once("value")
        .then(snapshot => {
            products = snapshot.val() || {};
            renderDashboard();
        })
        .catch(error => alert(`Refresh failed: ${error.message}`));
});

productsBody.addEventListener("click", event => {
    const button = event.target.closest("[data-edit-uid]");

    if (button) {
        openEditDialog(button.dataset.editUid);
    }
});

productForm.addEventListener("submit", async event => {
    event.preventDefault();

    // Clean up UID: remove spaces, colons, dashes and uppercase it
    const rawUid = $("uid").value.trim();
    const uid = rawUid.replace(/[\s:-]/g, "").toUpperCase();

    if (!uid || !/^[A-F0-9]+$/.test(uid)) {
        $("formMessage").textContent =
            "Enter a valid RFID UID (hexadecimal, e.g. 3F8A2D1B or 3F 8A 2D 1B).";
        return;
    }

    const product = {
        name: $("name").value.trim(),
        category: $("category").value.trim(),
        price: Number($("price").value),
        stock: Number($("stock").value),
        quantity: $("quantity").value.trim(),
        expiry: $("expiry").value
    };

    if (!product.name || !product.category ||
        !Number.isFinite(product.price) || product.price < 0 ||
        !Number.isInteger(product.stock) || product.stock < 0) {
        $("formMessage").textContent =
            "Check the product name, category, price and stock quantity.";
        return;
    }

    $("saveButton").disabled = true;
    $("formMessage").textContent = "Saving to Firebase...";

    try {
        await productsRef.child(uid).update(product);
        productDialog.close();
    } catch (error) {
        $("formMessage").textContent =
            `Save failed: ${error.message}`;
    } finally {
        $("saveButton").disabled = false;
    }
});

// Live product updates
productsRef.on("value", snapshot => {
    products = snapshot.val() || {};
    renderDashboard();
    setConnectionStatus("Firebase connected", "connected");
}, error => {
    setConnectionStatus("Firebase access denied or disconnected", "disconnected");
    productsBody.innerHTML = `
        <tr><td colspan="8" class="empty-state">
            Could not load products: ${escapeHTML(error.message)}
        </td></tr>`;
});

// Recent RFID scans
scansRef.orderByChild("timestamp").limitToLast(20).on("value", snapshot => {
    const scans = [];

    snapshot.forEach(child => {
        scans.push({ key: child.key, ...child.val() });
    });

    scans.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    if (!scans.length) {
        scanHistoryBody.innerHTML = `
            <tr><td colspan="4" class="empty-state">
                No scan events found. The ESP32 must write events to /scan_history.
            </td></tr>`;
        return;
    }

    scanHistoryBody.innerHTML = scans.map(scan => `
        <tr>
            <td>${escapeHTML(scan.name || "Unknown product")}</td>
            <td>${escapeHTML(scan.uid || "—")}</td>
            <td>${escapeHTML(scan.event || "SCAN")}</td>
            <td>${scan.timestamp
                ? new Date(Number(scan.timestamp)).toLocaleString("en-IN")
                : "—"}</td>
        </tr>
    `).join("");
}, error => {
    scanHistoryBody.innerHTML = `
        <tr><td colspan="4" class="empty-state">
            Could not load scan history: ${escapeHTML(error.message)}
        </td></tr>`;
});

// Automatically authenticate the admin dashboard using your Firebase credentials
auth.signInWithEmailAndPassword("shrikargs7@gmail.com", "Shri@1234")
    .then((userCredential) => {
        console.log("Admin portal authenticated with Firebase:", userCredential.user.email);
        setConnectionStatus("Firebase connected", "connected");
    })
    .catch((error) => {
        console.error("Firebase Auth Error:", error);
        setConnectionStatus("Firebase auth error: " + error.message, "disconnected");
    });
