# 🛒 IoT Smart Shopping Trolley

<div align="center">

[![Hardware](https://img.shields.io/badge/Hardware-ESP32_%2F_ESP8266-E7352C?style=for-the-badge&logo=espressif&logoColor=white)](https://www.espressif.com/)
[![Sensor](https://img.shields.io/badge/RFID-MFRC522_13.56MHz-00599C?style=for-the-badge)](https://en.wikipedia.org/wiki/Radio-frequency_identification)
[![Display](https://img.shields.io/badge/Telemetry-I2C_16x2_LCD-4CAF50?style=for-the-badge)](https://en.wikipedia.org/wiki/I%C2%B2C)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**Automating Billing for a Cashier-Less, Queue-Free Retail Experience**

</div>

---

## 📖 Overview

The **IoT-Based Smart Shopping Trolley** eliminates traditional checkout lines by turning standard retail carts into autonomous self-checkout terminals. Customers scan items directly at the cart using high-frequency RFID modules. The system validates transactions through sensory weight cross-checks, updates an onboard I2C LCD in real time, and transmits the finalized bill to a central web portal for instantaneous online payment.

---

## 🔄 End-to-End System Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Shopper as Customer
    participant Cart as ESP32 & RFID (RC522)
    participant Sensors as Ultrasonic & Weight Sensors
    participant Display as I2C LCD (16x2)
    participant Cloud as Cloud Gateway / Backend API
    actor Cashier as Central Store Server

    Shopper->>Cart: Drops item into cart (RFID Tag scanned)
    Cart->>Sensors: Reads weight & confirms physical drop
    alt Valid Item & Weight Match
        Cart->>Display: Updates item count & running total
        Cart->>Cloud: POST /api/cart/add (Item SKU, price)
        Cloud-->>Cart: 200 OK (Cart synchronized)
    else Tag Missing or Weight Discrepancy
        Cart->>Cart: Triggers buzzer & alert LED
        Cart->>Display: Displays "Scan Error - Retry"
    end

    Shopper->>Cart: Presses "Checkout / End Shopping" Button
    Cart->>Cloud: Finalize Session (Generate Invoice)
    Cloud->>Cashier: Transmit receipt & mark RFID tags paid
    Display->>Shopper: Display QR code for instant UPI payment
```

---

## ⚙️ Hardware Architecture

```mermaid
graph TD
    subgraph Power Management
        Batt[Li-Ion Battery Pack 7.4V] --> Reg[LM2596 Buck Converter 5V/3.3V]
    end

    subgraph Microcontroller & Processing
        Reg --> MCU[ESP32 / ESP8266 Microcontroller]
        MCU <--> RFID[MFRC522 RFID Reader 13.56 MHz]
        MCU <--> LCD[16x2 Liquid Crystal Display with I2C Module]
        MCU <--> Sonic[HC-SR04 Ultrasonic Obstacle Sensor]
        MCU --> Buzz[Piezo Buzzer & Indicator LEDs]
        MCU --> Keypad[Push-Button Controls Add/Remove/Checkout]
    end

    subgraph Telemetry & Cloud
        MCU -->|WiFi / MQTT / HTTP| AP[Store WiFi Gateway]
        AP --> CloudServer[Billing Server & SQL Database]
        CloudServer --> Dashboard[Store Admin & Billing Terminal]
    end
```

---

## 🔌 Hardware Pinout Configuration

| Component | ESP32 Pin | Function |
| :--- | :--- | :--- |
| **MFRC522 (SDA / SS)** | GPIO 5 | SPI Slave Select |
| **MFRC522 (SCK)** | GPIO 18 | SPI Clock |
| **MFRC522 (MOSI)** | GPIO 23 | SPI Master Out |
| **MFRC522 (MISO)** | GPIO 19 | SPI Master In |
| **MFRC522 (RST)** | GPIO 22 | Reset Line |
| **I2C LCD (SDA)** | GPIO 21 | I2C Data Line |
| **I2C LCD (SCL)** | GPIO 22 | I2C Clock Line |
| **HC-SR04 (Trig)** | GPIO 4 | Ultrasonic Trigger |
| **HC-SR04 (Echo)** | GPIO 2 | Ultrasonic Echo |
| **Buzzer** | GPIO 15 | Audio Feedback |

---

## 💻 Firmware Setup & Flashing

### Requirements
- Arduino IDE or PlatformIO
- ESP32 Board Support Package
- Libraries: `MFRC522`, `LiquidCrystal_I2C`, `WiFiClientSecure`, `PubSubClient`

### Flashing
1. Open `firmware/smart_trolley.ino` in Arduino IDE.
2. Configure your WiFi credentials and Server Endpoint in `config.h`:
   ```cpp
   #define WIFI_SSID "STORE_WIFI"
   #define WIFI_PASS "secure_password"
   #define API_SERVER "http://192.168.1.100:5000/api/cart"
   ```
3. Connect ESP32 via Micro-USB and select the appropriate COM port.
4. Click **Upload**.

---

## 📄 License
Distributed under the MIT License. See `LICENSE` for details.
