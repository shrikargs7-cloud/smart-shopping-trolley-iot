#include <WiFi.h>
#include <SPI.h>
#include <MFRC522.h>
#include <HTTPClient.h>

// ====================================================
// WIFI & FIREBASE CONFIG
// ====================================================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Firebase Realtime Database URL
const char* FIREBASE_URL = "https://inventory-fa492-default-rtdb.firebaseio.com";

// ====================================================
// PIN DEFINITIONS (MFRC522 RFID)
// ====================================================
#define SS_PIN    5   // Chip select pin (SDA)
#define RST_PIN   27  // Reset pin
#define BUZZER_PIN 4  // Active buzzer

MFRC522 mfrc522(SS_PIN, RST_PIN);

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  SPI.begin();
  mfrc522.PCD_Init();

  Serial.println("\nConnecting to WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected! IP: " + WiFi.localIP().toString());
  beep(100);
  Serial.println("Scan an RFID tag...");
}

void loop() {
  // Check for RFID tag
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    return;
  }

  // Read Tag UID
  String uid = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(mfrc522.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  Serial.println("\nTag Scanned: " + uid);
  beep(150); // Feedback beep

  // Push scan event to Firebase
  pushScanToFirebase(uid);

  mfrc522.PICC_HaltA();
  delay(1000); // 1-second debounce
}

void pushScanToFirebase(String uid) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected!");
    return;
  }

  HTTPClient http;
  String url = String(FIREBASE_URL) + "/scan_history.json";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  // JSON payload with timestamp
  String payload = "{\"uid\":\"" + uid + "\",\"event\":\"SCAN\",\"timestamp\":{\".sv\":\"timestamp\"}}";
  
  int httpCode = http.POST(payload);
  if (httpCode > 0) {
    Serial.println("Scan uploaded to Firebase (HTTP " + String(httpCode) + ")");
    if (httpCode == 403) {
      Serial.println("⚠️ ERROR: Firebase returned 403 Forbidden!");
      Serial.println("👉 Go to Firebase Console -> Realtime Database -> Rules and set .read: true, .write: true");
    }
  } else {
    Serial.println("Firebase push failed. Code: " + String(httpCode));
  }
  http.end();
}

void beep(int ms) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
}
