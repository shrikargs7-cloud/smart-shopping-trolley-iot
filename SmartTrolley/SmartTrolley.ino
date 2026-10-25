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

// ==================================================
// OBJECTS
// ==================================================

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

LiquidCrystal_I2C lcd(0x27, 16, 2);

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
// STATE
// ==================================================

bool firebaseReady = false;
bool lookupPending = false;
bool cardProcessed = false;

String pendingUID = "";
String lastUID = "";

unsigned long lastScanTime = 0;
unsigned long lastReconnectAttempt = 0;

const unsigned long SCAN_COOLDOWN_MS = 1800;

// ==================================================
// BUZZER
// ==================================================

void beepSuccess() {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(120);
  digitalWrite(BUZZER_PIN, LOW);
}

void beepError() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(100);
    digitalWrite(BUZZER_PIN, LOW);
    delay(100);
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
// FIREBASE CALLBACK
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

  if (result.isError()) {
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

  DeserializationError parseError =
    deserializeJson(doc, response);

  if (parseError) {
    Serial.print("JSON parsing failed: ");
    Serial.println(parseError.c_str());

    showLCD("Invalid Product", "Check DB JSON");
    beepError();
    return;
  }

  String name = doc["name"] | "Unnamed";
  String category = doc["category"] | "Unassigned";
  double price = doc["price"] | 0.0;
  int stock = doc["stock_quantity"] | 0;
  String expiry = doc["expiry_date"] | "Not set";

  Serial.println("Product found.");
  Serial.println("Name: " + name);
  Serial.println("Category: " + category);
  Serial.printf("Price: %.2f\n", price);
  Serial.printf("Stock: %d\n", stock);
  Serial.println("Expiry: " + expiry);

  // Log every successful product lookup.
  JsonDocument history;
  history["uid"] = pendingUID;
  history["name"] = name;
  history["category"] = category;
  history["price"] = price;
  history["stock_quantity"] = stock;
  history["expiry_date"] = expiry;
  history["event"] = stock <= 0 ? "OUT_OF_STOCK" : "SCAN";

  String historyJson;
  serializeJson(history, historyJson);

  String historyPath =
    "/scan_history/";

  Database.set<object_t>(
    aClient,
    historyPath,
    object_t(historyJson),
    [](AsyncResult &r) {
      if (r.isError()) {
        Serial.printf(
          "Scan history write failed: %s\n",
          r.error().message().c_str()
        );
      } else if (r.isResult()) {
        Serial.println("Scan history request completed.");
      }
    },
    "historyWrite"
  );

  if (stock <= 0) {
    showLCD(name, "OUT OF STOCK!");
    beepError();
  } else {
    // LCD first line: product name
    // LCD second line: price and available stock
    showLCD(name, formatPrice(price) + " Qty:" + String(stock));
    beepSuccess();
  }
}

// ==================================================
// RFID
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

  if (!rfid.PICC_IsNewCardPresent()) {
    cardProcessed = false;
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  String uid = readUID();

  // Avoid duplicate lookups while a card remains on the reader.
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

  pendingUID = uid;

  if (!app.ready()) {
    Serial.println("Firebase is not ready.");
    showLCD("Firebase Not", "Ready Yet");
    beepError();
  } else {
    lookupPending = true;

    // Give immediate feedback while fetching product data.
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

  showLCD("RFID Inventory", "Starting...");

  // RFID initialization
  SPI.begin(
    SPI_SCK,
    SPI_MISO,
    SPI_MOSI,
    RFID_SS_PIN
  );

  rfid.PCD_Init();
  delay(100);

  byte version = rfid.PCD_ReadRegister(
    MFRC522::VersionReg
  );

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

  // Wi-Fi
  showLCD("Connecting WiFi", "");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long wifiStart = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - wifiStart < 20000) {
    delay(300);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi connected.");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connection failed.");
    showLCD("WiFi Failed", "Check Credentials");
    beepError();
    return;
  }

  // FirebaseClient TLS configuration.
  ssl_client.setInsecure();

  Serial.println("Initializing Firebase...");

  initializeApp(
    aClient,
    app,
    getAuth(user_auth)
  );

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
  // Required to progress Firebase authentication/tasks.
  app.loop();

  if (WiFi.status() != WL_CONNECTED &&
      millis() - lastReconnectAttempt > 10000) {
    lastReconnectAttempt = millis();
    WiFi.reconnect();
  }

  if (app.ready() && !firebaseReady) {
    firebaseReady = true;

    Serial.println("Firebase authenticated.");
    showLCD("System Ready", "Scan Your Card");
  }

  scanRFID();

  delay(5);
}
