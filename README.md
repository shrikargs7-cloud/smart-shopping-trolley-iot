# IoT Smart Shopping Trolley

This repository contains the code for the **IoT-Based Smart Shopping Trolley: Automating Billing for a Cashier-Less Retail Experience** project, strictly following your submitted project report.

## How it works (According to your report):
1. **ESP32 as a Server:** The ESP32 acts as a Wi-Fi Access Point (`RFID_Billing_AP`) and runs an embedded WebServer on port 80.
2. **EEPROM Storage:** Product UIDs and prices are stored locally on the ESP32's EEPROM.
3. **Cart Management:** When an RFID tag is scanned (MFRC522), the ESP32 checks the EEPROM, adds it to an internal struct array (`CartItem`), calculates the total, and beeps the buzzer.
4. **Website Interface:** The customer uses a smartphone or display connected to the trolley's Wi-Fi network. The website fetches live cart data directly from the ESP32 using the `/api/cart` endpoint.
5. **Checkout:** Pressing checkout on the website triggers the `/api/checkout` endpoint, which clears the cart on the ESP32.

## Project Structure
- `SmartTrolley/SmartTrolley.ino`: The exact Arduino code reflecting the "Core Functionality" logic from pages 15 & 16 of your report.
- `index.html`: The user-friendly website (Mobile/Display Interface) that connects directly to the ESP32. 

---

## 1. Setting up the ESP32 (Arduino Code)
1. Open `SmartTrolley/SmartTrolley.ino` in the Arduino IDE.
2. Install the `MFRC522` library by GithubCommunity via the Library Manager.
3. **Wiring (from your report):**
   - **MFRC522 (RFID)**: SS_PIN -> GPIO 5, RST_PIN -> GPIO 27, MOSI -> 23, MISO -> 19, SCK -> 18.
   - **Buzzer**: Positive -> GPIO 4, GND -> GND.
4. Upload the code to the ESP32.

## 2. Using the Website (Customer Interface)
Unlike the previous python dashboard, your report dictates that the ESP32 processes transactions and handles communication with the web server. 

1. Once the ESP32 is powered on, grab your phone or laptop and connect to the new Wi-Fi network:
   - **Network Name (SSID):** `RFID_Billing_AP`
   - **Password:** `12345678`
2. Simply double-click the `index.html` file located in this folder to open it in your browser.
3. The website will automatically connect to `http://192.168.4.1` (the ESP32) and display the live cart.
4. Scan an RFID tag on the hardware. The item will instantly appear on the website and update the total cost!
5. Click **Pay & Checkout** on the website to clear the trolley.

