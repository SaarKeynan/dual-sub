//! DualSub's French-only WebAssembly adapter for ablaut reverse lookup.

use wasm_bindgen::prelude::*;

/// Reverse-analyze a French conjugated form into verified infinitives and slots.
#[wasm_bindgen(js_name = reverseFrench)]
pub fn reverse_french(form: &str) -> Result<JsValue, JsError> {
    Ok(serde_wasm_bindgen::to_value(&crate::reverse(form, crate::Lang::Fra))?)
}

