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
let cart = {}; // { [uid]: { uid, name, price, quantity, maxStock, weight_grams } }
let lastSeenScan = null; // Store stringified scan object to detect change
let shoppingBudget = Number(localStorage.getItem("trolley_budget") || 500);
let alertedMilestones = { 50: false, 90: false, 100: false };
let speechEnabled = true;
let isRecognizing = false;
let speechRecognizer = null;
let wakeWordRecognizer = null;
let wakeWordEnabled = true;
let isAwake = false;
let lastRecipeCheckCartHash = "";

// Per-User & Anti-Theft Session State
let currentUserId = localStorage.getItem("trolley_user_id") || "USER-101";
let sessionPaid = false;
let currentCartActualWeight = 0;
let lastSecurityAlertState = false;

// Multilingual Voice Agent Configuration & Translation Matrix
let currentLanguage = localStorage.getItem("trolley_language") || "en-IN";

const TRANSLATIONS = {
    "en-IN": {
        welcome_morning: "Good morning, and welcome to Smart Mart! I am Aura, your personal AI shopping agent. How may I assist you today?",
        welcome_afternoon: "Good afternoon, and welcome to Smart Mart! I am Aura, your personal AI shopping agent. How may I assist you today?",
        welcome_evening: "Good evening, and welcome to Smart Mart! I am Aura, your personal AI shopping agent. How may I assist you today?",
        lang_switched: "Voice agent language switched to English. How may I help you?",
        added_to_cart: "Added {name} to your cart.",
        already_scanned: "Notice: {name} has already been scanned in your basket.",
        scan_locked_paid: "Warning: Payment is already completed. New items cannot be scanned.",
        weight_mismatch: "Security warning: Cart weight mismatch detected. Please verify your items.",
        budget_50: "Notice: You have reached 50 percent of your shopping budget.",
        budget_90: "Warning: You have reached 90 percent of your budget.",
        budget_100: "Alert: You have exceeded your shopping budget.",
        checkout_success: "Payment successful. Thank you for shopping with Smart Cart!",
        listening: "Listening in English... Speak now!",
        user_ready: "Welcome, {user}. Your shopping cart is ready."
    },
    "hi-IN": {
        welcome_morning: "सुप्रभात! स्मार्ट मार्ट में आपका स्वागत है। मैं ऑरा हूँ, आपकी AI शॉपिंग सहायक। आज मैं आपकी क्या मदद कर सकती हूँ?",
        welcome_afternoon: "नमस्ते! स्मार्ट मार्ट में आपका स्वागत है। मैं ऑरा हूँ, आपकी AI शॉपिंग सहायक। आज मैं आपकी क्या मदद कर सकती हूँ?",
        welcome_evening: "शुभ संध्या! स्मार्ट मार्ट में आपका स्वागत है। मैं ऑरा हूँ, आपकी AI शॉपिंग सहायक। आज मैं आपकी क्या मदद कर सकती हूँ?",
        lang_switched: "वॉइस असिस्टेंट की भाषा बदलकर हिंदी कर दी गई है। मैं आपकी क्या सेवा करूँ?",
        added_to_cart: "{name} आपके कार्ट में जोड़ दिया गया है।",
        already_scanned: "सूचना: {name} पहले ही आपके कार्ट में स्कैन हो चुका है।",
        scan_locked_paid: "चेतावनी: भुगतान पूरा हो चुका है। नई वस्तुएं स्कैन नहीं की जा सकतीं।",
        weight_mismatch: "सुरक्षा चेतावनी: ट्रॉली के वजन में अंतर पाया गया है। कृपया अपनी टोकरी जांचें।",
        budget_50: "सूचना: आपने अपने बजट का 50 प्रतिशत खर्च कर लिया है।",
        budget_90: "चेतावनी: आप अपने बजट के 90 प्रतिशत तक पहुँच चुके हैं।",
        budget_100: "अलर्ट: आपका शॉपिंग बजट समाप्त हो चुका है।",
        checkout_success: "भुगतान सफल रहा। स्मार्ट कार्ट के साथ खरीदारी करने के लिए धन्यवाद!",
        listening: "हिंदी में सुन रही हूँ... बोलिए!",
        user_ready: "नमस्ते {user}! आपका शॉपिंग कार्ट तैयार है।"
    },
    "kn-IN": {
        welcome_morning: "ಶುಭೋದಯ! ಸ್ಮಾರ್ಟ್ ಮಾರ್ಟ್‌ಗೆ ಸುಸ್ವಾಗತ. ನಾನು ಔರಾ, ನಿಮ್ಮ AI ಶಾಪಿಂಗ್ ಸಹಾಯಕ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
        welcome_afternoon: "ನಮಸ್ಕಾರ! ಸ್ಮಾರ್ಟ್ ಮಾರ್ಟ್‌ಗೆ ಸುಸ್ವಾಗತ. ನಾನು ಔರಾ, ನಿಮ್ಮ AI ಶಾಪಿಂಗ್ ಸಹಾಯಕ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
        welcome_evening: "ಶುಭ ಸಂಜೆ! ಸ್ಮಾರ್ಟ್ ಮಾರ್ಟ್‌ಗೆ ಸುಸ್ವಾಗತ. ನಾನು ಔರಾ, ನಿಮ್ಮ AI ಶಾಪಿಂಗ್ ಸಹಾಯಕ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
        lang_switched: "ಧ್ವನಿ ಸಹಾಯಕ ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ. ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
        added_to_cart: "{name} ನಿಮ್ಮ ಕಾರ್ಟ್‌ಗೆ ಸೇರಿಸಲಾಗಿದೆ.",
        already_scanned: "ಗಮನಿಸಿ: {name} ಈಗಾಗಲೇ ನಿಮ್ಮ ಕಾರ್ಟ್‌ನಲ್ಲಿ ಸ್ಕ್ಯಾನ್ ಆಗಿದೆ.",
        scan_locked_paid: "ಎಚ್ಚರಿಕೆ: ಪಾವತಿ ಈಗಾಗಲೇ ಪೂರ್ಣಗೊಂಡಿದೆ. ಹೊಸ ವಸ್ತುಗಳನ್ನು ಸ್ಕ್ಯಾನ್ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ.",
        weight_mismatch: "ಭದ್ರತಾ ಎಚ್ಚರಿಕೆ: ಟ್ರಾಲಿ ತೂಕದಲ್ಲಿ ವ್ಯತ್ಯಾಸ ಕಂಡುಬಂದಿದೆ. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ.",
        budget_50: "ಸೂಚನೆ: ನಿಮ್ಮ ಬಜೆಟ್‌ನ ಶೇಕಡಾ 50 ರಷ್ಟು ಖರ್ಚಾಗಿದೆ.",
        budget_90: "ಎಚ್ಚರಿಕೆ: ನಿಮ್ಮ ಬಜೆಟ್‌ನ ಶೇಕಡಾ 90 ರಷ್ಟನ್ನು ತಲುಪಿದ್ದೀರಿ.",
        budget_100: "ಎಚ್ಚರಿಕೆ: ನಿಮ್ಮ ಶಾಪಿಂಗ್ ಬಜೆಟ್ ಮೀರಿದೆ.",
        checkout_success: "ಪಾವತಿ ಯಶಸ್ವಿಯಾಗಿದೆ. ಸ್ಮಾರ್ಟ್ ಕಾರ್ಟ್ ಜೊತೆ ಶಾಪಿಂಗ್ ಮಾಡಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು!",
        listening: "ಕನ್ನಡದಲ್ಲಿ ಆಲಿಸಲಾಗುತ್ತಿದೆ... ಮಾತನಾಡಿ!",
        user_ready: "ಸುಸ್ವಾಗತ {user}! ನಿಮ್ಮ ಶಾಪಿಂಗ್ ಕಾರ್ಟ್ ಸಿದ್ಧವಾಗಿದೆ."
    },
    "te-IN": {
        welcome_morning: "శుభోదయం! స్మార్ట్ మార్ట్‌కి స్వాగతం. నేను ఆరా, మీ AI షాపింగ్ అసిస్టెంట్. నేను మీకు ఎలా సహాయపడగలను?",
        welcome_afternoon: "నమస్కారం! స్మార్ట్ మార్ట్‌కి స్వాగతం. నేను ఆరా, మీ AI షాపింగ్ అసిస్టెంట్. నేను మీకు ఎలా సహాయపడగలను?",
        welcome_evening: "శుభ సాయంత్రం! స్మార్ట్ మార్ట్‌కి స్వాగతం. నేను ఆరా, మీ AI షాపింగ్ అసిస్టెంట్. నేను మీకు ఎలా సహాయపడగలను?",
        lang_switched: "వాయిస్ అసిస్టెంట్ భాష తెలుగులోకి మార్చబడింది. నేను మీకు ఎలా సహాయపడగలను?",
        added_to_cart: "{name} మీ కార్ట్‌కు జోడించబడింది.",
        already_scanned: "గమనిక: {name} ఇప్పటికే మీ కార్ట్‌లో స్కాన్ చేయబడింది.",
        scan_locked_paid: "హెచ్చరిక: చెల్లింపు ఇప్పటికే పూర్తయింది. కొత్త వస్తువులను స్కాన్ చేయలేరు.",
        weight_mismatch: "భద్రతా హెచ్చరిక: ట్రాలీ బరువులో తేడా గుర్తించబడింది.",
        budget_50: "గమనిక: మీరు మీ బడ్జెట్‌లో 50 శాతం ఖర్చు చేశారు.",
        budget_90: "హెచ్చరిక: మీరు మీ బడ్జెట్‌లో 90 శాతానికి చేరుకున్నారు.",
        budget_100: "హెచ్చరిక: మీరు మీ షాపింగ్ బడ్జెట్‌ను మించిపోయారు.",
        checkout_success: "చెల్లింపు విజయవంతమైంది. స్మార్ట్ కార్ట్‌తో షాపింగ్ చేసినందుకు ధన్యవాదాలు!",
        listening: "తెలుగులో వింటున్నాను... మాట్లాడండి!",
        user_ready: "స్వాగతం {user}! మీ కార్ట్ సిద్ధంగా ఉంది."
    },
    "ta-IN": {
        welcome_morning: "காலை வணக்கம்! ஸ்மார்ட் மார்ட்டிற்கு வரவேற்கிறோம். நான் ஆரா, உங்கள் AI ஷாப்பிங் உதவியாளர். நான் உங்களுக்கு எப்படி உதவ முடியும்?",
        welcome_afternoon: "வணக்கம்! ஸ்மார்ட் மார்ட்டிற்கு வரவேற்கிறோம். நான் ஆரா, உங்கள் AI ஷாப்பிங் உதவியாளர். நான் உங்களுக்கு எப்படி உதவ முடியும்?",
        welcome_evening: "மாலை வணக்கம்! ஸ்மார்ட் மார்ட்டிற்கு வரவேற்கிறோம். நான் ஆரா, உங்கள் AI ஷாப்பிங் உதவியாளர். நான் உங்களுக்கு எப்படி உதவ முடியும்?",
        lang_switched: "குரல் உதவியாளர் மொழி தமிழுக்கு மாற்றப்பட்டது. நான் உங்களுக்கு எப்படி உதவ முடியும்?",
        added_to_cart: "{name} உங்கள் கூடையில் சேர்க்கப்பட்டது.",
        already_scanned: "அறிவிப்பு: {name} ஏற்கனவே உங்கள் கூடையில் ஸ்கேன் செய்யப்பட்டுள்ளது.",
        scan_locked_paid: "எச்சரிக்கை: கட்டணம் ஏற்கனவே செலுத்தப்பட்டுவிட்டது. புதிய பொருட்களை ஸ்கேன் செய்ய முடியாது.",
        weight_mismatch: "பாதுகாப்பு எச்சரிக்கை: வண்டி எடையில் முரண்பாடு கண்டறியப்பட்டது.",
        budget_50: "அறிவிப்பு: உங்கள் பட்ஜெட்டில் 50 சதவீதத்தை அடைந்துவிட்டீர்கள்.",
        budget_90: "எச்சரிக்கை: உங்கள் பட்ஜெட்டில் 90 சதவீதத்தை அடைந்துவிட்டீர்கள்.",
        budget_100: "எச்சரிக்கை: உங்கள் பட்ஜெட்டைத் தாண்டிவிட்டீர்கள்.",
        checkout_success: "கட்டணம் வெற்றிகரமாக முடிந்தது. ஸ்மார்ட் கார்ட்டில் வாங்கியதற்கு நன்றி!",
        listening: "தமிழில் கேட்கிறேன்... பேசுங்கள்!",
        user_ready: "வரவேற்கிறோம் {user}! உங்கள் கூடை தயாராக உள்ளது."
    }
};

function getLocalizedText(key, params = {}) {
    const langDict = TRANSLATIONS[currentLanguage] || TRANSLATIONS["en-IN"];
    let text = langDict[key] || TRANSLATIONS["en-IN"][key] || "";
    for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
    return text;
}

function setLanguage(langCode) {
    if (!TRANSLATIONS[langCode]) langCode = "en-IN";
    currentLanguage = langCode;
    localStorage.setItem("trolley_language", langCode);

    const select = $("languageSelect");
    if (select && select.value !== langCode) {
        select.value = langCode;
    }

    if (speechRecognizer) {
        speechRecognizer.lang = currentLanguage;
    }
    if (wakeWordRecognizer) {
        wakeWordRecognizer.lang = currentLanguage;
    }

    const confirmation = getLocalizedText("lang_switched");
    speakText(confirmation, currentLanguage);
}

window.setLanguage = setLanguage;

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

// Synchronize active session (cart items, expected weight, user_id) to Firebase
async function syncActiveSessionToFirebase() {
    if (!idToken) return;
    try {
        const expectedWeight = getExpectedCartWeight();
        await fetch(`${CONFIG.dbUrl}/active_sessions/TRL-01.json?auth=${idToken}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user_id: currentUserId,
                status: sessionPaid ? "PAID" : "ACTIVE",
                paid: sessionPaid,
                items_count: Object.keys(cart).length,
                scanned_uids: Object.keys(cart),
                expected_weight_grams: expectedWeight,
                last_updated: Date.now()
            })
        });
    } catch (err) {
        console.warn("Session sync notice:", err);
    }
}

// Listen to ESP32 Load Cell weight and security alerts from Firebase
async function pollActiveSessionFeedback() {
    if (!idToken) return;
    try {
        const res = await fetch(`${CONFIG.dbUrl}/active_sessions/TRL-01.json?auth=${idToken}`);
        const session = await res.json();
        if (!session) return;

        // Verify session matches current user
        if (session.user_id && session.user_id !== currentUserId) {
            // New user has taken over the cart on the ESP32
            currentUserId = session.user_id;
            updateUserDisplay();
        }

        // Live weight reading from ESP32 load sensor
        if (session.actual_weight_grams !== undefined) {
            updateLoadSensorVerification(session.actual_weight_grams);
        }

        // Security alert triggered by ESP32 load sensor or lockouts
        if (session.security_alert && session.security_alert.alert) {
            if (!lastSecurityAlertState) {
                lastSecurityAlertState = true;
                triggerSecurityAlert(
                    session.security_alert.title || "Theft Alert: Weight Mismatch",
                    session.security_alert.message || "Trolley load cell detected an unscanned item!"
                );
            }
        } else {
            lastSecurityAlertState = false;
        }
    } catch (_) {}
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

        // Check if scan belongs to this user session (if user_id tagged)
        if (currentScan.user_id && currentScan.user_id !== currentUserId) {
            return; // Ignore scan belonging to another user
        }

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

    // Security Check: If session has been checked out and paid, lock cart!
    if (sessionPaid) {
        triggerSecurityAlert(
            "Scan Blocked: Cart Already Paid",
            "Payment has already been processed for this session. Scanning new items is locked!"
        );
        speakText(getLocalizedText("scan_locked_paid"), currentLanguage);
        return;
    }

    const product = allProducts[uid];
    const name = product?.name || fallbackName || `Item (${uid})`;
    const price = Number(product?.price ?? fallbackPrice ?? 0);
    const stock = Number(product?.stock_quantity ?? product?.stock ?? 99);
    const weight = Number(product?.weight_grams ?? product?.weight ?? 250);

    // Single-Scan Rule: One physical ID tag should only scan ONCE per customer cart
    if (cart[uid]) {
        console.warn(`Tag ${uid} already scanned in this cart session.`);
        triggerSecurityAlert(
            "Item Already Scanned",
            `"${name}" (${uid}) is already scanned in your cart. Each item ID can only be scanned once!`
        );
        speakText(getLocalizedText("already_scanned", { name }), currentLanguage);
        return;
    }

    // New unique item added to cart
    cart[uid] = {
        uid,
        name,
        price,
        quantity: 1,
        maxStock: stock,
        weight_grams: weight
    };

    speakText(getLocalizedText("added_to_cart", { name }), currentLanguage);
    renderCart();
    syncActiveSessionToFirebase();
}

function changeQuantity(uid, delta) {
    if (!cart[uid]) return;

    if (sessionPaid) {
        alert("Cart is already paid. Modifications locked.");
        return;
    }

    // Since each physical item has a unique tag ID, increasing qty of the same UID is restricted
    if (delta > 0) {
        alert("Single Tag Mode: Each individual item has a unique RFID tag. Please scan another tag to add another unit!");
        return;
    }

    const nextQty = cart[uid].quantity + delta;
    if (nextQty <= 0) {
        delete cart[uid];
    }
    renderCart();
    syncActiveSessionToFirebase();
}

function removeItem(uid) {
    if (cart[uid]) {
        if (sessionPaid) {
            alert("Cart is already paid. Modifications locked.");
            return;
        }
        delete cart[uid];
        renderCart();
        syncActiveSessionToFirebase();
    }
}

function clearCart() {
    if (sessionPaid) {
        alert("Cart is already paid. Modifications locked.");
        return;
    }
    cart = {};
    renderCart();
    syncActiveSessionToFirebase();
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
                speakText(getLocalizedText("budget_100"), currentLanguage);
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
                speakText(getLocalizedText("budget_90"), currentLanguage);
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
                speakText(getLocalizedText("budget_50"), currentLanguage);
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

// Calculate expected weight in grams based on all scanned items
function getExpectedCartWeight() {
    return Object.values(cart).reduce((sum, item) => {
        const wt = Number(item.weight_grams || 250);
        return sum + (wt * item.quantity);
    }, 0);
}

// Update the 5kg Load Cell Verification UI Card
function updateLoadSensorVerification(actualWeight) {
    currentCartActualWeight = Number(actualWeight || 0);
    const expectedWeight = getExpectedCartWeight();

    const actualEl = $("cartActualWeight");
    const expectedEl = $("cartExpectedWeight");
    const badge = $("weightStatusBadge");
    const bar = $("weightProgressBar");
    const alertMsg = $("weightAlertMsg");

    if (actualEl) actualEl.textContent = `${currentCartActualWeight}g`;
    if (expectedEl) expectedEl.textContent = `${expectedWeight}g expected`;

    const delta = Math.abs(currentCartActualWeight - expectedWeight);
    const TOLERANCE_GRAMS = 35; // 35g tolerance for packaging variance

    // Weight mismatch threshold (> 35g difference)
    if (delta > TOLERANCE_GRAMS && (expectedWeight > 0 || currentCartActualWeight > 20)) {
        if (badge) {
            badge.className = "text-[10px] font-black px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 animate-pulse";
            badge.textContent = "MISMATCH / THEFT ALERT";
        }
        if (bar) {
            bar.className = "bg-rose-500 h-2 rounded-full transition-all duration-500 animate-pulse";
            bar.style.width = "100%";
        }
        if (alertMsg) {
            alertMsg.className = "text-[11px] mt-2 font-bold text-rose-600 flex items-center gap-1";
            alertMsg.innerHTML = `<i class="fas fa-triangle-exclamation"></i><span>Unscanned item or weight difference: ${delta}g</span>`;
        }
        triggerSecurityAlert(
            "Security Alert: Weight Mismatch Detected",
            `Cart sensor weight (${currentCartActualWeight}g) does not tally with your scanned items (${expectedWeight}g). Difference: ${delta}g.`
        );
    } else {
        if (badge) {
            badge.className = "text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700";
            badge.textContent = "MATCHED";
        }
        if (bar) {
            bar.className = "bg-emerald-500 h-2 rounded-full transition-all duration-500";
            bar.style.width = "100%";
        }
        if (alertMsg) {
            alertMsg.className = "text-[11px] mt-2 font-medium text-emerald-600 flex items-center gap-1";
            alertMsg.innerHTML = `<i class="fas fa-shield-check"></i><span>Trolley weight matches scanned items list</span>`;
        }
    }
}

function triggerSecurityAlert(title, message) {
    const banner = $("securityAlertBanner");
    const titleEl = $("securityAlertTitle");
    const descEl = $("securityAlertDesc");

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = message;
    if (banner) banner.classList.remove("hidden");

    // Also notify Firebase session about security alert
    if (idToken) {
        fetch(`${CONFIG.dbUrl}/active_sessions/TRL-01/security_alert.json?auth=${idToken}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                alert: true,
                title: title,
                message: message,
                timestamp: Date.now()
            })
        }).catch(() => {});
    }
}

function dismissSecurityBanner() {
    const banner = $("securityAlertBanner");
    if (banner) banner.classList.add("hidden");
    if (idToken) {
        fetch(`${CONFIG.dbUrl}/active_sessions/TRL-01/security_alert.json?auth=${idToken}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(null)
        }).catch(() => {});
    }
}

function updateUserDisplay() {
    const nameEl = $("userSessionName");
    if (nameEl) nameEl.textContent = currentUserId;
    localStorage.setItem("trolley_user_id", currentUserId);
}

function openUserModal() {
    const modal = $("userLoginModal");
    const input = $("userIdInput");
    if (input) input.value = currentUserId;
    if (modal) modal.showModal();
}

function closeUserModal() {
    const modal = $("userLoginModal");
    if (modal) modal.close();
}

function quickSelectUser(uid) {
    const input = $("userIdInput");
    if (input) input.value = uid;
}

window.quickSelectUser = quickSelectUser;
window.dismissSecurityBanner = dismissSecurityBanner;

function renderCart() {
    const items = Object.values(cart);
    const totalCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Update budget tracker
    updateBudgetTracker(subtotal);

    // Update load sensor tally
    updateLoadSensorVerification(currentCartActualWeight || getExpectedCartWeight());

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
            <div class="slide-in bg-slate-50 border border-slate-200 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="flex items-center space-x-3 flex-1 min-w-0">
                    <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-lg sm:text-xl shrink-0">
                        🏷️
                    </div>
                    <div class="min-w-0 flex-1">
                        <h4 class="font-bold text-slate-800 text-sm truncate">${escapeHTML(item.name)}</h4>
                        <p class="text-xs text-slate-400 font-mono mt-0.5">
                            <span class="bg-slate-200/80 text-slate-700 px-1.5 py-0.5 rounded text-[11px]">${item.uid}</span>
                            &bull; ₹${item.price.toFixed(2)} each
                        </p>
                    </div>
                </div>

                <div class="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 w-full sm:w-auto shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200/60">
                    <div class="flex items-center border border-slate-200 bg-white rounded-lg shadow-sm">
                        <button onclick="changeQuantity('${item.uid}', -1)" class="w-8 h-8 flex items-center justify-center hover:bg-slate-100 font-bold text-slate-600 rounded-l-lg transition">-</button>
                        <span class="w-8 text-center text-sm font-bold">${item.quantity}</span>
                        <button onclick="changeQuantity('${item.uid}', 1)" class="w-8 h-8 flex items-center justify-center hover:bg-slate-100 font-bold text-slate-600 rounded-r-lg transition">+</button>
                    </div>

                    <div class="text-right sm:w-24">
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
                const currentStock = Number(prod.stock_quantity ?? prod.stock ?? 0);
                const updatedStock = Math.max(0, currentStock - item.quantity);

                // Atomically update both stock and stock_quantity fields
                await fetch(`${CONFIG.dbUrl}/products/${item.uid}.json?auth=${idToken}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        stock: updatedStock,
                        stock_quantity: updatedStock
                    })
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

        // Also record scan_history checkout/removal event so RFID scan activity updates in real-time
        for (const item of items) {
            await fetch(`${CONFIG.dbUrl}/scan_history.json?auth=${idToken}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    uid: item.uid,
                    name: item.name,
                    price: item.price,
                    event: "CHECKOUT_PAID",
                    receipt_id: receiptId,
                    timestamp: Date.now()
                })
            });
        }

        // Update active session state in Firebase to PAID so ESP32 locks any further scans
        sessionPaid = true;
        await fetch(`${CONFIG.dbUrl}/active_sessions/TRL-01.json?auth=${idToken}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status: "PAID",
                user_id: currentUserId,
                paid: true,
                paid_at: Date.now(),
                receipt_id: receiptId,
                final_amount: subtotal
            })
        });

        $("receiptNumber").textContent = `#${receiptId}`;
        $("receiptDate").textContent = new Date().toLocaleString("en-IN");
        $("receiptAmount").textContent = `₹${subtotal.toFixed(2)}`;
        $("receiptModal").showModal();

        speakText(getLocalizedText("checkout_success"), currentLanguage);

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

    // 1. Try immediate local intent execution for instant feedback
    const executedLocally = checkAndExecuteDirectIntent(userQuestion);

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
                    cart: cartSummary,
                    language: currentLanguage
                })
            });
            if (apiRes.ok) {
                const apiData = await apiRes.json();
                rawReply = apiData.reply;
            }
        } catch (_) {}

        // Priority 2: Direct client fetch fallback
        if (!rawReply && CONFIG.geminiKey) {
            const langInstruction = currentLanguage !== "en-IN" 
                ? `\nIMPORTANT: The customer selected language is ${currentLanguage}. Respond in this language with high clarity. Keep any [ACTION: {...}] block in English JSON format at the very end.` 
                : "";
            const systemPrompt = `You are Aura, an empathetic, calm, clear, and proactive AI Supermarket Shopping Agent.${langInstruction}
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
            rawReply = getLocalizedText("welcome_morning");
        }

        // Parse and execute agentic actions from response
        const { speechText, actionData } = parseAgentResponse(rawReply);

        const el = document.getElementById(placeholderId);
        if (el) {
            el.className = "bg-white p-2.5 rounded-2xl rounded-tl-none border border-slate-200 text-slate-800 shadow-sm leading-relaxed text-xs";
            el.innerHTML = speechText.replace(/\n/g, '<br>');
        }

        // Execute Agent Autonomous Actions (if not already handled locally)
        if (actionData && !executedLocally) {
            executeAgentAction(actionData);
        }

        // Voice output (if not already spoken by local intent)
        if (!executedLocally) {
            speakText(speechText, currentLanguage);
        }
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

// Local intent interceptor: executes immediate UI actions reliably even before/alongside AI
function checkAndExecuteDirectIntent(phrase) {
    const text = phrase.toLowerCase().trim();
    console.log("⚡ Checking direct intent for:", text);

    // 1. CLEAR CART
    if (/clear.*cart|empty.*cart|remove.*all|delete.*all/i.test(text)) {
        clearCart();
        speakText("I have cleared your shopping cart.");
        return true;
    }

    // 2. CHECKOUT / PAY
    if (/check\s*out|pay.*bill|proceed.*payment|pay\s*now/i.test(text)) {
        const payBtn = $("payCheckoutBtn");
        if (payBtn && !payBtn.disabled) {
            speakText("Certainly, taking you to self-checkout now.");
            processCheckout();
        } else {
            speakText("Your cart is currently empty. Please add items before checking out.");
        }
        return true;
    }

    // 3. SET BUDGET (e.g. "set budget to 800", "budget 1000", "my budget is 500")
    const budgetMatch = text.match(/(?:budget\s*(?:is|to)?\s*(?:of|rupees|rs\.?|inr)?\s*|set\s*budget\s*to?\s*)(\d+)/i);
    if (budgetMatch && budgetMatch[1]) {
        const amount = Number(budgetMatch[1]);
        if (amount > 0) {
            setShoppingBudget(amount);
            speakText(`I have updated your shopping budget to ₹${amount}.`);
            highlightElement("budgetProgressBar");
            return true;
        }
    }

    // 4. ADD ITEM (e.g. "add 1 milk", "add milk", "add two bread", "put milk", "include paneer")
    const addMatch = text.match(/(?:add|put|buy|insert|include)\s*(?:(\d+|one|two|three|four|five)\s+)?([a-z\s]+?)(?:\s+to\s+cart|\s+in\s+cart|\s+to\s+my\s+cart|$)/i);
    if (addMatch && addMatch[2]) {
        let itemQuery = addMatch[2].trim().replace(/^(?:a|an|the|some)\s+/, "");
        const wordNum = { one: 1, two: 2, three: 3, four: 4, five: 5 };
        const qty = Number(addMatch[1]) || wordNum[addMatch[1]] || 1;

        if (itemQuery.length > 2 && !itemQuery.includes("budget") && !itemQuery.includes("checkout")) {
            executeAgentAction({
                action: "ADD_ITEM",
                item: itemQuery,
                quantity: qty
            });
            speakText(`I've added ${qty} ${itemQuery} to your cart.`);
            return true;
        }
    }

    // 5. REMOVE ITEM (e.g. "remove milk", "delete bread", "take out the chips")
    const removeMatch = text.match(/(?:remove|delete|take\s*out|drop)\s*(?:the\s+)?([a-z\s]+?)(?:\s+from\s+cart|$)/i);
    if (removeMatch && removeMatch[1]) {
        const itemQuery = removeMatch[1].trim();
        if (itemQuery.length > 2) {
            executeAgentAction({
                action: "REMOVE_ITEM",
                item: itemQuery
            });
            speakText(`I've removed ${itemQuery} from your cart.`);
            return true;
        }
    }

    // 6. SCROLL / NAVIGATE
    if (/show.*bill|summary|scroll.*bottom/i.test(text)) {
        $("summaryPayable")?.scrollIntoView({ behavior: "smooth" });
        highlightElement("summaryPayable");
        speakText("Here is your order bill summary.");
        return true;
    }

    return false;
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

function cleanConversationalText(text) {
    if (!text) return "";
    return text
        .replace(/\[ACTION:[\s\S]*?\]/gi, '') // Strip action JSON tags
        .replace(/[*_#`~\[\]\(\)\{\}]/g, ' ')   // Strip markdown formatting symbols
        .replace(/₹\s*(\d+(?:\.\d+)?)/g, '$1 rupees')
        .replace(/Rs\.?\s*(\d+(?:\.\d+)?)/gi, '$1 rupees')
        .replace(/Qty:\s*(\d+)/gi, ', quantity $1')
        .replace(/\bUID:\s*/gi, '')
        .replace(/\bUID\b/gi, 'ID')
        .replace(/\s+/g, ' ')
        .trim();
}

const LEGACY_ROBOTIC_BLACKLIST = [
    "victoria", "fred", "junior", "kathy", "princess", "vicki", "whisper",
    "zarvox", "bells", "boing", "cellos", "deranged", "good news",
    "hysterical", "pipe organ", "trinoids", "bad news", "bahh", "albert", "ralph", "bruce", "agnes"
];

function isBlacklistedVoice(name) {
    const lower = (name || "").toLowerCase();
    return LEGACY_ROBOTIC_BLACKLIST.some(b => lower.includes(b));
}

function findBestAlexaVoice() {
    if (!availableVoices || availableVoices.length === 0) {
        loadVoices();
    }

    // Alexa / Modern Assistant voices ranked by naturalness and speed:
    const alexaStyleVoices = [
        "Samantha",                         // macOS/iOS - iconic, natural, smooth assistant
        "Ava",                              // macOS neural - hyper-realistic Alexa-like assistant
        "Google US English",                // Chrome/Android - standard fluent, crisp assistant
        "Microsoft Jenny Online (Natural)", // Edge/Windows - modern neural Alexa-like voice
        "Microsoft Aria Online (Natural)",  // Edge/Windows - conversational assistant
        "Siri",                             // Apple Siri voice
        "Zoe",                              // macOS natural voice
        "Allison",                          // macOS natural voice
        "Google UK English Female",         // Chrome natural
        "Karen"                             // macOS clean assistant
    ];

    for (const name of alexaStyleVoices) {
        const found = availableVoices.find(v => 
            v.name.toLowerCase().includes(name.toLowerCase()) && !isBlacklistedVoice(v.name)
        );
        if (found) return found;
    }

    // Next, look for any female/natural English voice that is not blacklisted
    const femaleVoice = availableVoices.find(v => 
        (v.name.toLowerCase().includes("female") || v.name.toLowerCase().includes("natural") || v.name.toLowerCase().includes("siri")) && 
        v.lang.startsWith("en") && 
        !isBlacklistedVoice(v.name)
    );
    if (femaleVoice) return femaleVoice;

    // Filter out blacklisted robotic voices
    return availableVoices.find(v => v.lang.startsWith("en") && !isBlacklistedVoice(v.name)) || null;
}

function findBestVoiceForLanguage(langCode) {
    if (!availableVoices || availableVoices.length === 0) {
        loadVoices();
    }
    const target = (langCode || currentLanguage || "en-IN").toLowerCase();
    const prefix = target.split("-")[0];

    // Priority 1: Exact language match (e.g., "hi-in", "kn-in", "te-in", "ta-in")
    let voice = availableVoices.find(v => v.lang.toLowerCase() === target && !isBlacklistedVoice(v.name));
    if (voice) return voice;

    // Priority 2: Prefix match (e.g., starts with "hi", "kn", "te", "ta")
    voice = availableVoices.find(v => v.lang.toLowerCase().startsWith(prefix) && !isBlacklistedVoice(v.name));
    if (voice) return voice;

    // Priority 3: Name match (e.g. voice name contains "Hindi", "Kannada", etc.)
    const nameMap = {
        "hi": ["hindi", "leka", "kalpana", "hemant"],
        "kn": ["kannada", "sapna"],
        "te": ["telugu", "chitra", "mohan"],
        "ta": ["tamil", "valluvar"],
        "en": ["samantha", "ava", "google us english", "jenny", "aria", "siri", "karen"]
    };
    if (nameMap[prefix]) {
        for (const token of nameMap[prefix]) {
            voice = availableVoices.find(v => v.name.toLowerCase().includes(token) && !isBlacklistedVoice(v.name));
            if (voice) return voice;
        }
    }

    // For English, use top Alexa/Siri style voice
    if (prefix === "en") {
        return findBestAlexaVoice();
    }

    // Default fallback (ensure not blacklisted)
    return availableVoices.find(v => v.lang.startsWith("en") && !isBlacklistedVoice(v.name)) || null;
}

function speakText(text, explicitLang) {
    if (!speechEnabled || !('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel(); // Stop any ongoing speech

        // Play gentle crisp audio chime before speaking
        playAssistantChime(false);

        // Preprocess text for crystal-clear word emission
        const cleanText = cleanConversationalText(text);
        if (!cleanText) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);
        const lang = explicitLang || currentLanguage || "en-IN";
        utterance.lang = lang;

        const voice = findBestVoiceForLanguage(lang);
        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        }

        // Alexa-Style Natural Conversational Speed & Tone:
        if (lang.startsWith("en")) {
            utterance.pitch = 1.0;   // Neutral, authentic human timbre (no artificial pitch strain)
            utterance.rate = 1.15;   // Brisk, confident Alexa conversational pace (never slow-motion)
        } else {
            utterance.pitch = 1.0;   // Neutral regional human pitch
            utterance.rate = 1.10;   // Fluent, natural regional speaking pace
        }
        utterance.volume = 1.0;

        window.speechSynthesis.speak(utterance);
    } catch (err) {
        console.warn("Speech synthesis error:", err);
    }
}

// Welcoming voice greeting on opening / session start
function speakWelcomeGreeting() {
    const hour = new Date().getHours();
    const timeKey = hour < 12 ? "welcome_morning" : (hour < 17 ? "welcome_afternoon" : "welcome_evening");
    const welcomeMessage = getLocalizedText(timeKey);
    
    // Play warm greeting in selected language
    setTimeout(() => {
        speakText(welcomeMessage, currentLanguage);
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
    recognition.lang = currentLanguage;

    recognition.onstart = () => {
        isRecognizing = true;
        playAssistantChime(true);
        const voiceBtn = $("aiVoiceBtn");
        if (voiceBtn) {
            voiceBtn.className = "w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center text-xs transition animate-pulse";
            voiceBtn.innerHTML = `<i class="fas fa-stop"></i>`;
        }
        const input = $("aiChatInput");
        if (input) input.placeholder = getLocalizedText("listening");
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
        // Resume wake word listener if enabled
        if (wakeWordEnabled && !isRecognizing) {
            setTimeout(startWakeWordListener, 400);
        }
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
        // Pause wake word listener while direct recognition runs
        if (wakeWordRecognizer) {
            try { wakeWordRecognizer.stop(); } catch (_) {}
        }
        speechRecognizer.start();
    }
}

// -------------------------------------------------------------------------
// Hands-free Wake-Word Engine ("Hey Aura" / "Hi Aura" / "Okay Aura")
// -------------------------------------------------------------------------
function initWakeWordListener() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = currentLanguage;

    recognizer.onresult = (event) => {
        if (isRecognizing) return;

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const rawPhrase = event.results[i][0].transcript.toLowerCase().trim();
            console.log("👂 Ambient speech:", rawPhrase);

            // Check wake phrase variants: "hey aura", "hi aura", "aura", "ok aura", "hello aura"
            const wakeMatch = rawPhrase.match(/\b(hey\s+aura|hi\s+aura|hello\s+aura|ok\s+aura|okay\s+aura|aura)\b/i);
            
            if (wakeMatch) {
                console.log("⚡ [WAKE WORD DETECTED]:", wakeMatch[0]);
                
                // Open panel if hidden
                const panel = $("aiChatPanel");
                if (panel) panel.classList.remove("hidden");

                // Extract any command spoken immediately after wake word
                const commandAfterWake = rawPhrase.replace(wakeMatch[0], "").trim();

                // Stop wake word recognizer temporarily
                try { recognizer.stop(); } catch (_) {}

                if (commandAfterWake.length > 2) {
                    // Customer said: "Hey Aura add 1 milk"
                    const input = $("aiChatInput");
                    if (input) input.value = commandAfterWake;
                    askGeminiAssistant(commandAfterWake);
                    if (input) input.value = "";
                } else {
                    // Customer just said "Hey Aura" -> chime, acknowledge & immediately activate listening mic
                    playAssistantChime(true);
                    speakText("Yes, I'm here. How may I help you?");
                    setTimeout(() => {
                        if (!isRecognizing) toggleVoiceRecognition();
                    }, 1400);
                }
                break;
            }
        }
    };

    recognizer.onerror = (e) => {
        if (e.error !== "no-speech" && e.error !== "aborted") {
            console.log("Wake-word listener notice:", e.error);
        }
    };

    recognizer.onend = () => {
        // Automatically restart to keep hands-free listening alive
        if (wakeWordEnabled && !isRecognizing) {
            setTimeout(startWakeWordListener, 600);
        }
    };

    return recognizer;
}

function startWakeWordListener() {
    if (!wakeWordEnabled || isRecognizing) return;
    try {
        if (!wakeWordRecognizer) {
            wakeWordRecognizer = initWakeWordListener();
        }
        if (wakeWordRecognizer) {
            wakeWordRecognizer.start();
            updateWakeWordUI(true);
        }
    } catch (_) {}
}

function updateWakeWordUI(active) {
    const dot = $("wakeWordDot");
    const text = $("wakeWordText");
    const btn = $("wakeWordToggleBtn");
    if (!dot || !text) return;

    if (active && wakeWordEnabled) {
        dot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
        text.textContent = "Hey Aura: Listening";
        if (btn) btn.className = "flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 transition";
    } else {
        dot.className = "w-2 h-2 rounded-full bg-slate-400";
        text.textContent = "Hey Aura: Paused";
        if (btn) btn.className = "flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white/10 text-slate-300 border border-white/20 transition";
    }
}

function toggleWakeWord() {
    wakeWordEnabled = !wakeWordEnabled;
    if (wakeWordEnabled) {
        startWakeWordListener();
    } else {
        if (wakeWordRecognizer) {
            try { wakeWordRecognizer.stop(); } catch (_) {}
        }
        updateWakeWordUI(false);
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

    // User Session Login Listeners
    const userBtn = $("userSessionBtn");
    if (userBtn) userBtn.addEventListener("click", openUserModal);

    const userForm = $("userLoginForm");
    if (userForm) {
        userForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const input = $("userIdInput");
            if (input && input.value.trim()) {
                currentUserId = input.value.trim().toUpperCase();
                updateUserDisplay();
                sessionPaid = false; // Reset session for new user
                cart = {};
                renderCart();
                syncActiveSessionToFirebase();
                closeUserModal();
                speakText(getLocalizedText("user_ready", { user: currentUserId }), currentLanguage);
            }
        });
    }

    // Hands-Free Wake-Word Toggle Button
    $("wakeWordToggleBtn")?.addEventListener("click", toggleWakeWord);

    // Multilingual Voice Agent Language Selector Listener
    const langSelect = $("languageSelect");
    if (langSelect) {
        langSelect.value = currentLanguage;
        langSelect.addEventListener("change", (e) => {
            setLanguage(e.target.value);
        });
    }

    setupAiChat();
}

// Initial Boot Sequence (runs when DOM is loaded)
async function init() {
    setupEventListeners();
    updateUserDisplay();
    updateBudgetTracker(0);

    const langSelect = $("languageSelect");
    if (langSelect) langSelect.value = currentLanguage;

    // Warm, calm welcoming voice greeting on opening
    speakWelcomeGreeting();

    // Start hands-free wake word listener after initial greeting
    setTimeout(() => {
        startWakeWordListener();
    }, 2800);

    // Prompt user to set their shopping budget in the beginning
    if (!sessionStorage.getItem("budget_prompted")) {
        setTimeout(openBudgetModal, 400);
    }

    const success = await authenticate();
    if (success) {
        loadProducts();
        pollScanHistory();
        syncActiveSessionToFirebase();

        setInterval(loadProducts, 15000);
        setInterval(pollScanHistory, 800);
        setInterval(pollActiveSessionFeedback, 1000);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
