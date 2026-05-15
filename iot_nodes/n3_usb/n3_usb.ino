/*
 * n3_usb.ino — N3 (ESP32) USB Serial mode
 *
 * No WiFi. No MQTT. Reads digital IR sensor on pin 34 and
 * prints a JSON line to Serial every second.
 *
 * Board  : ESP32 DevKit
 * Sensor : IR on GPIO 34 (digital, LOW = object detected)
 * Baud   : 115200
 */

const char* NODE_ID = "N3";
#define IR_PIN 34

void setup() {
  Serial.begin(115200);
  pinMode(IR_PIN, INPUT);
  delay(500);
}

void loop() {
  int ir_value = digitalRead(IR_PIN);
  bool detected = (ir_value == 0);

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
