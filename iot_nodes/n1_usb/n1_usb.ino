/*
 * n1_usb.ino — N1 (ESP8266) USB Serial mode
 *
 * No WiFi. No MQTT. Reads analog IR sensor on A0 and
 * prints a JSON line to Serial every second.
 *
 * The PC-side usb_serial_reader.py picks this up and
 * feeds it into the same processing pipeline as MQTT.
 *
 * Board  : ESP8266 (e.g. NodeMCU / Wemos D1 Mini)
 * Sensor : IR on A0 (analog, 0–1023)
 * Baud   : 115200
 */

const char* NODE_ID = "N1";

void setup() {
  Serial.begin(115200);
  delay(500);
}

void loop() {
  int ir_value = analogRead(A0);
  bool detected = (ir_value < 225);  // ~22% of 1023 — matches N3 digital LOW = detected

  Serial.print("{\"node_id\":\"");
  Serial.print(NODE_ID);
  Serial.print("\",\"timestamp\":");
  Serial.print(millis() / 1000.0, 3);
  Serial.print(",\"ir_value\":");
  Serial.print(ir_value);
  Serial.print(",\"detected\":");
  Serial.print(detected ? "true" : "false");
  Serial.println("}");

  delay(1000);
}
