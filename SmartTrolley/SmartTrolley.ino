#define ENABLE_USER_AUTH
#define ENABLE_DATABASE

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>
#include <FirebaseClient.h>
#include <HX711.h>

// ==================================================
// WIFI AND FIREBASE CONFIGURATION
// ==================================================

#define WIFI_SSID       "OnePlus"
#define WIFI_PASSWORD   "12345678"

#define API_KEY         "AIzaSyBdId6Lqg-zc5o0dTzrArcgS0-6lC5VFD8"
#define USER_EMAIL      "shrikargs7@gmail.com"
#define USER_PASSWORD   "Shri@1234"

#define DATABASE_URL \
  "https://inventory-fa492-default-rtdb.firebaseio.com/"

// ==================================================
// HARDWARE PINS
// ==================================================

#define RFID_SS_PIN     5
#define RFID_RST_PIN    4
#define BUZZER_PIN      13

#define SPI_SCK         18
#define SPI_MISO        19
#define SPI_MOSI        23

#define LCD_SDA         21
#define LCD_SCL         22

// 5kg Load Cell (HX711) Pins
#define HX711_DT_PIN    16
#define HX711_SCK_PIN   17

// ==================================================
// OBJECTS
// ==================================================

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2);
HX711 scale;

using SSL_CLIENT = WiFiClientSecure;
SSL_CLIENT ssl_client;

using AsyncClient = AsyncClientClass;
AsyncClient aClient(ssl_client);

UserAuth user_auth(
  API_KEY,
  USER_EMAIL,
  USER_PASSWORD,
  3000
);

FirebaseApp app;
RealtimeDatabase Database;

// ==================================================
// STATE & ANTI-THEFT TRACKING
// ==================================================

bool firebaseReady = false;
bool lookupPending = false;
bool cardProcessed = false;

String pendingUID = "";
String lastUID = "";

unsigned long lastScanTime = 0;
unsigned long lastReconnectAttempt = 0;
unsigned long lastSessionPoll = 0;
unsigned long lastWeightPublish = 0;

const unsigned long SCAN_COOLDOWN_MS = 1800;

// Per-User & Session Lockout State
bool isSessionPaid = false;
String currentSessionUser = "USER-101";
float expectedCartWeight = 0.0;
float actualCartWeight = 0.0;
bool securityAlarmActive = false;

// "One ID scan only once" session tracking
const int MAX_SESSION_TAGS = 50;
String scannedUIDs[MAX_SESSION_TAGS];
int scannedUIDCount = 0;

bool isTagAlreadyScanned(const String &uid) {
  for (int i = 0; i < scannedUIDCount; i++) {
    if (scannedUIDs[i] == uid) return true;
  }
  return false;
}

void registerScannedTag(const String &uid) {
  if (scannedUIDCount < MAX_SESSION_TAGS) {
    scannedUIDs[scannedUIDCount++] = uid;
  }
}

void resetSessionState() {
  scannedUIDCount = 0;
  isSessionPaid = false;
  expectedCartWeight = 0.0;
  securityAlarmActive = false;
  if (scale.is_ready()) {
    scale.tare();
  }
}

// ==================================================
// BUZZER & ALARM ALERTS
// ==================================================

void beepSuccess() {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(120);
  digitalWrite(BUZZER_PIN, LOW);
}

void beepWarning() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(180);
    digitalWrite(BUZZER_PIN, LOW);
    delay(100);
  }
}

void beepError() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(100);
    digitalWrite(BUZZER_PIN, LOW);
    delay(100);
  }
}

void triggerAlarm(const String &line1, const String &line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, 16));
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, 16));

  for (int i = 0; i < 5; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(140);
    digitalWrite(BUZZER_PIN, LOW);
    delay(90);
  }
}

// ==================================================
// LCD HELPERS
// ==================================================

void showLCD(const String &line1, const String &line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, 16));
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, 16));
}

String formatPrice(double price) {
  return "Rs." + String(price, 2);
}

// ==================================================
// REPORT SECURITY ALERT TO FIREBASE
// ==================================================

void reportSecurityAlert(const String &title, const String &message) {
  JsonDocument doc;
  doc["alert"] = true;
  doc["title"] = title;
  doc["message"] = message;
  doc["timestamp"] = millis();

  String json;
  serializeJson(doc, json);

  Database.set<object_t>(
    aClient,
    "/active_sessions/TRL-01/security_alert",
    object_t(json),
    nullptr,
    "securityAlertSet"
  );
}

// ==================================================
// FIREBASE PRODUCT LOOKUP CALLBACK
// ==================================================

void productLookupCallback(AsyncResult &result) {
  if (!result.isResult()) {
    return;
  }

  if (result.isEvent()) {
    Serial.printf(
      "Firebase event: %s\n",
      result.eventLog().message().c_str()
    );
  }

  if (result.error().code() != 0) {
    Serial.printf(
      "Firebase error: %s, code: %d\n",
      result.error().message().c_str(),
      result.error().code()
    );

    showLCD("Firebase Error", "Check Serial");
    beepError();
    lookupPending = false;
    return;
  }

  if (!result.available()) {
    return;
  }

  // Ignore responses that do not belong to the current lookup.
  if (String(result.uid().c_str()) != "productLookup") {
    return;
  }

  String response = result.c_str();
  response.trim();

  Serial.println("Firebase response:");
  Serial.println(response);

  lookupPending = false;

  if (response == "null" || response.length() == 0) {
    showLCD("Unknown Product", pendingUID);
    Serial.println("Product UID not found.");
    beepError();
    return;
  }

  JsonDocument doc;
  DeserializationError parseError = deserializeJson(doc, response);

  if (parseError) {
    Serial.print("JSON parsing failed: ");
    Serial.println(parseError.c_str());
    showLCD("Invalid Product", "Check DB JSON");
    beepError();
    return;
  }

  String name = doc["name"] | doc["product_name"] | "Unnamed";
  String category = doc["category"] | "Unassigned";
  double price = doc["price"] | 0.0;
  int stock = doc["stock_quantity"] | doc["stock"] | 0;
  String expiry = doc["expiry_date"] | "Not set";
  float weightGrams = doc["weight_grams"] | 250.0;

  Serial.println("Product found.");
  Serial.println("Name: " + name);
  Serial.println("Category: " + category);
  Serial.printf("Price: %.2f\n", price);
  Serial.printf("Stock: %d\n", stock);
  Serial.printf("Weight: %.1fg\n", weightGrams);

  if (stock <= 0) {
    showLCD(name, "OUT OF STOCK!");
    beepError();
    return;
  }

  // Register tag in current session so it cannot be scanned twice
  registerScannedTag(pendingUID);
  expectedCartWeight += weightGrams;

  // Log scan event with user_id tag so individual user carts filter accurately
  JsonDocument history;
  history["uid"] = pendingUID;
  history["name"] = name;
  history["category"] = category;
  history["price"] = price;
  history["stock_quantity"] = stock;
  history["weight_grams"] = weightGrams;
  history["user_id"] = currentSessionUser;
  history["event"] = "SCAN";
  history["timestamp"] = millis();

  String historyJson;
  serializeJson(history, historyJson);

  Database.set<object_t>(
    aClient,
    "/scan_history/",
    object_t(historyJson),
    [](AsyncResult &r) {
      if (r.isResult()) {
        Serial.println("Scan history request completed.");
      }
    },
    "historyWrite"
  );

  // Sync updated expected weight and scanned count to active trolley session
  String sessionUpdate = "{\"items_count\":" + String(scannedUIDCount) +
                         ",\"expected_weight_grams\":" + String(expectedCartWeight, 1) + "}";
  Database.patch<object_t>(
    aClient,
    "/active_sessions/TRL-01",
    object_t(sessionUpdate),
    nullptr,
    "sessionWeightUpdate"
  );

  // LCD display: product name + price and stock
  showLCD(name, formatPrice(price) + " Qty:" + String(stock));
  beepSuccess();
}

// ==================================================
// FIREBASE SESSION STATUS CALLBACK
// ==================================================

void sessionStatusCallback(AsyncResult &result) {
  if (!result.isResult() || !result.available()) return;
  if (String(result.uid().c_str()) != "sessionStatus") return;

  String response = result.c_str();
  response.trim();
  if (response == "null" || response.length() == 0) return;

  JsonDocument doc;
  if (deserializeJson(doc, response) == DeserializationError::Ok) {
    String status = doc["status"] | "ACTIVE";
    bool paid = doc["paid"] | false;
    String uid = doc["user_id"] | "USER-101";

    // Switch user if login modal updated user_id
    if (uid != currentSessionUser) {
      currentSessionUser = uid;
      resetSessionState();
      Serial.println("User session changed to: " + currentSessionUser);
      showLCD("Shopper Logged In", currentSessionUser);
      beepSuccess();
    }

    if (status == "PAID" || paid) {
      if (!isSessionPaid) {
        isSessionPaid = true;
        Serial.println("Session status: PAID! Checkout lockout enabled.");
        showLCD("PAID: CHECKOUT", "Take Your Receipt");
        beepSuccess();
      }
    } else {
      isSessionPaid = false;
    }
  }
}

void pollSessionStatus() {
  if (!app.ready() || lookupPending) return;
  if (millis() - lastSessionPoll > 3000) {
    lastSessionPoll = millis();
    Database.get(
      aClient,
      "/active_sessions/TRL-01",
      sessionStatusCallback,
      false,
      "sessionStatus"
    );
  }
}

// ==================================================
// 5KG LOAD SENSOR (HX711) WEIGHT VERIFICATION
// ==================================================

void updateAndPublishWeight() {
  if (!app.ready() || lookupPending) return;

  if (scale.is_ready()) {
    float reading = scale.get_units(3);
    if (reading < 0) reading = 0;
    actualCartWeight = reading;
  }

  if (millis() - lastWeightPublish > 2000) {
    lastWeightPublish = millis();

    // Verify weight match with 35g tolerance
    float weightDiff = abs(actualCartWeight - expectedCartWeight);
    if (weightDiff > 35.0 && (expectedCartWeight > 0 || actualCartWeight > 25.0)) {
      if (!securityAlarmActive) {
        securityAlarmActive = true;
        Serial.printf("THEFT ALERT: Weight mismatch! Actual=%.1fg Expected=%.1fg Diff=%.1fg\n",
                      actualCartWeight, expectedCartWeight, weightDiff);
        triggerAlarm("WEIGHT MISMATCH", "Diff: " + String((int)weightDiff) + "g");
        reportSecurityAlert("Theft Alert: Weight Mismatch",
          "Cart weight " + String((int)actualCartWeight) + "g deviates from scanned " + String((int)expectedCartWeight) + "g");
      }
    } else {
      securityAlarmActive = false;
    }

    // Publish live load cell weight to Firebase
    String weightJson = "{\"actual_weight_grams\":" + String(actualCartWeight, 1) + "}";
    Database.patch<object_t>(
      aClient,
      "/active_sessions/TRL-01",
      object_t(weightJson),
      nullptr,
      "weightPatch"
    );
  }
}

// ==================================================
// RFID SCANNER
// ==================================================

String readUID() {
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) {
      uid += "0";
    }
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

void scanRFID() {
  if (lookupPending) {
    return;
  }

  // Robust card wake-up
  byte bufferATQA[2];
  byte bufferSize = sizeof(bufferATQA);
  MFRC522::StatusCode status = rfid.PICC_WakeupA(bufferATQA, &bufferSize);

  if (status != MFRC522::STATUS_OK && !rfid.PICC_IsNewCardPresent()) {
    cardProcessed = false;
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  String uid = readUID();

  // Avoid duplicate lookups while a card remains physically resting on the reader
  if (cardProcessed &&
      uid == lastUID &&
      millis() - lastScanTime < SCAN_COOLDOWN_MS) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  cardProcessed = true;
  lastUID = uid;
  lastScanTime = millis();

  Serial.println("-------------------------");
  Serial.println("Card UID: " + uid);

  // 1. Post-Payment Checkout Lockout Check
  if (isSessionPaid) {
    Serial.println("ALERT: Scan attempted after payment completed!");
    triggerAlarm("CART IS PAID!", "Scan Locked");
    reportSecurityAlert("Scan Blocked: Cart Paid",
      "User attempted to scan tag " + uid + " after checkout was completed!");
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  // 2. "One ID scan only once" Verification
  if (isTagAlreadyScanned(uid)) {
    Serial.println("ALERT: Duplicate scan! Tag already registered in this cart: " + uid);
    showLCD("ALREADY SCANNED!", "1 Tag = 1 Item");
    beepWarning();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  pendingUID = uid;

  if (!app.ready()) {
    Serial.println("Firebase is not ready.");
    showLCD("Firebase Not", "Ready Yet");
    beepError();
  } else {
    lookupPending = true;

    // Give immediate feedback while fetching product data
    beepSuccess();
    showLCD("Looking up...", uid);

    String path = "/products/" + uid;
    Serial.print("Firebase GET path: ");
    Serial.println(path);

    Database.get(
      aClient,
      path,
      productLookupCallback,
      false,
      "productLookup"
    );
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// ==================================================
// SETUP
// ==================================================

void setup() {
  Serial.begin(115200);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // LCD initialization
  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  showLCD("Smart Trolley", "Starting...");

  // 5kg Load Cell (HX711) initialization
  scale.begin(HX711_DT_PIN, HX711_SCK_PIN);
  scale.set_scale(420.0); // Calibration factor for 5kg load cell in grams
  if (scale.is_ready()) {
    scale.tare();
    Serial.println("HX711 5kg Load Sensor initialized and tared to 0g.");
  } else {
    Serial.println("HX711 Load Cell waiting for connection...");
  }

  // RFID hardware reset pulse
  pinMode(RFID_RST_PIN, OUTPUT);
  digitalWrite(RFID_RST_PIN, LOW);
  delay(50);
  digitalWrite(RFID_RST_PIN, HIGH);
  delay(50);

  // RFID initialization
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, RFID_SS_PIN);
  rfid.PCD_Init();
  delay(100);

  rfid.PCD_SetAntennaGain(MFRC522::RxGain_max);
  rfid.PCD_AntennaOn();

  byte txControl = rfid.PCD_ReadRegister(MFRC522::TxControlReg);
  if ((txControl & 0x03) != 0x03) {
    rfid.PCD_WriteRegister(MFRC522::TxControlReg, 0x83);
  }

  byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (version == 0x00 || version == 0xFF) {
    showLCD("RFID Error", "Check Wiring");
    Serial.println("RC522 communication error.");
    beepError();
    while (true) {
      delay(100);
    }
  }

  Serial.print("RFID version: 0x");
  Serial.println(version, HEX);

  // Wi-Fi Connection
  showLCD("Connecting WiFi", "");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 20000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi connected.");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connection failed.");
    showLCD("WiFi Failed", "Check Network");
    beepError();
    return;
  }

  // FirebaseClient TLS configuration
  ssl_client.setInsecure();
  Serial.println("Initializing Firebase...");

  initializeApp(aClient, app, getAuth(user_auth));
  app.getApp<RealtimeDatabase>(Database);
  Database.url(DATABASE_URL);

  showLCD("Firebase Login", "In Progress");
  beepSuccess();

  Serial.println("Setup complete.");
}

// ==================================================
// MAIN LOOP
// ==================================================

void loop() {
  app.loop();

  if (WiFi.status() != WL_CONNECTED && millis() - lastReconnectAttempt > 10000) {
    lastReconnectAttempt = millis();
    WiFi.reconnect();
  }

  if (app.ready() && !firebaseReady) {
    firebaseReady = true;
    Serial.println("Firebase authenticated.");
    showLCD("System Ready", "Scan Your Card");
  }

  scanRFID();
  pollSessionStatus();
  updateAndPublishWeight();

  delay(5);
}
