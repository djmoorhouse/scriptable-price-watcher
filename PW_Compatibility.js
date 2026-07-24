// Compatibility helpers for differences between Scriptable releases.
// Some versions return null, rather than an empty string, for an optional
// Alert text field. Price Watcher expects textFieldValue() to be string-safe.

if (!globalThis.__PW_ALERT_TEXT_FIELD_PATCHED__) {
  const originalTextFieldValue = Alert.prototype.textFieldValue;

  Alert.prototype.textFieldValue = function(index) {
    const value = originalTextFieldValue.call(this, index);
    return value == null ? "" : String(value);
  };

  globalThis.__PW_ALERT_TEXT_FIELD_PATCHED__ = true;
}

module.exports = { version: "0.9.1" };
