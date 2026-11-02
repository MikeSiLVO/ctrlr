//! XML-RPC serialization and parsing to and from serde_json::Value.
use std::io::Cursor;

use quick_xml::events::{BytesEnd, BytesRef, BytesStart, BytesText, Event};
use quick_xml::{Reader, Writer};
use serde_json::Value;

use crate::rpc::RpcError;

/// Wrap any displayable error as RpcError::Xml.
fn xml_err(e: impl std::fmt::Display) -> RpcError {
    RpcError::Xml(e.to_string())
}

/// Serialize a single XML-RPC method call.
pub fn serialize_call(method: &str, params: &[Value]) -> Result<Vec<u8>, RpcError> {
    let mut writer = Writer::new(Cursor::new(Vec::new()));

    writer
        .write_event(Event::Start(BytesStart::new("methodCall")))
        .map_err(xml_err)?;

    writer
        .write_event(Event::Start(BytesStart::new("methodName")))
        .map_err(xml_err)?;
    writer
        .write_event(Event::Text(BytesText::new(method)))
        .map_err(xml_err)?;
    writer
        .write_event(Event::End(BytesEnd::new("methodName")))
        .map_err(xml_err)?;

    writer
        .write_event(Event::Start(BytesStart::new("params")))
        .map_err(xml_err)?;
    for param in params {
        writer
            .write_event(Event::Start(BytesStart::new("param")))
            .map_err(xml_err)?;
        write_value(&mut writer, param)?;
        writer
            .write_event(Event::End(BytesEnd::new("param")))
            .map_err(xml_err)?;
    }
    writer
        .write_event(Event::End(BytesEnd::new("params")))
        .map_err(xml_err)?;

    writer
        .write_event(Event::End(BytesEnd::new("methodCall")))
        .map_err(xml_err)?;

    Ok(writer.into_inner().into_inner())
}

/// Serialize a batch of calls as a `system.multicall` XML-RPC request.
pub fn serialize_multicall(calls: &[(String, Vec<Value>)]) -> Result<Vec<u8>, RpcError> {
    let mut call_array = Vec::with_capacity(calls.len());
    for (method, params) in calls {
        let entry = serde_json::json!({
            "methodName": method,
            "params": params,
        });
        call_array.push(entry);
    }
    serialize_call("system.multicall", &[Value::Array(call_array)])
}

/// Write a <value> element from a serde_json::Value.
fn write_value(writer: &mut Writer<Cursor<Vec<u8>>>, value: &Value) -> Result<(), RpcError> {
    writer
        .write_event(Event::Start(BytesStart::new("value")))
        .map_err(xml_err)?;

    match value {
        Value::String(s) => {
            writer
                .write_event(Event::Start(BytesStart::new("string")))
                .map_err(xml_err)?;
            writer
                .write_event(Event::Text(BytesText::new(s)))
                .map_err(xml_err)?;
            writer
                .write_event(Event::End(BytesEnd::new("string")))
                .map_err(xml_err)?;
        }
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                if i >= i32::MIN as i64 && i <= i32::MAX as i64 {
                    writer
                        .write_event(Event::Start(BytesStart::new("i4")))
                        .map_err(xml_err)?;
                    writer
                        .write_event(Event::Text(BytesText::new(&i.to_string())))
                        .map_err(xml_err)?;
                    writer
                        .write_event(Event::End(BytesEnd::new("i4")))
                        .map_err(xml_err)?;
                } else {
                    writer
                        .write_event(Event::Start(BytesStart::new("i8")))
                        .map_err(xml_err)?;
                    writer
                        .write_event(Event::Text(BytesText::new(&i.to_string())))
                        .map_err(xml_err)?;
                    writer
                        .write_event(Event::End(BytesEnd::new("i8")))
                        .map_err(xml_err)?;
                }
            } else if let Some(f) = n.as_f64() {
                writer
                    .write_event(Event::Start(BytesStart::new("double")))
                    .map_err(xml_err)?;
                writer
                    .write_event(Event::Text(BytesText::new(&f.to_string())))
                    .map_err(xml_err)?;
                writer
                    .write_event(Event::End(BytesEnd::new("double")))
                    .map_err(xml_err)?;
            }
        }
        Value::Bool(b) => {
            writer
                .write_event(Event::Start(BytesStart::new("boolean")))
                .map_err(xml_err)?;
            writer
                .write_event(Event::Text(BytesText::new(if *b { "1" } else { "0" })))
                .map_err(xml_err)?;
            writer
                .write_event(Event::End(BytesEnd::new("boolean")))
                .map_err(xml_err)?;
        }
        Value::Array(arr) => {
            writer
                .write_event(Event::Start(BytesStart::new("array")))
                .map_err(xml_err)?;
            writer
                .write_event(Event::Start(BytesStart::new("data")))
                .map_err(xml_err)?;
            for item in arr {
                write_value(writer, item)?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("data")))
                .map_err(xml_err)?;
            writer
                .write_event(Event::End(BytesEnd::new("array")))
                .map_err(xml_err)?;
        }
        Value::Object(map) => {
            writer
                .write_event(Event::Start(BytesStart::new("struct")))
                .map_err(xml_err)?;
            for (key, val) in map {
                writer
                    .write_event(Event::Start(BytesStart::new("member")))
                    .map_err(xml_err)?;
                writer
                    .write_event(Event::Start(BytesStart::new("name")))
                    .map_err(xml_err)?;
                writer
                    .write_event(Event::Text(BytesText::new(key)))
                    .map_err(xml_err)?;
                writer
                    .write_event(Event::End(BytesEnd::new("name")))
                    .map_err(xml_err)?;
                write_value(writer, val)?;
                writer
                    .write_event(Event::End(BytesEnd::new("member")))
                    .map_err(xml_err)?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("struct")))
                .map_err(xml_err)?;
        }
        Value::Null => {
            // XML-RPC has no standard null
            writer
                .write_event(Event::Start(BytesStart::new("string")))
                .map_err(xml_err)?;
            writer
                .write_event(Event::End(BytesEnd::new("string")))
                .map_err(xml_err)?;
        }
    }

    writer
        .write_event(Event::End(BytesEnd::new("value")))
        .map_err(xml_err)?;
    Ok(())
}

/// Parse a `<methodResponse>` and return its value, or RpcError::Rpc on a fault.
pub fn parse_response(data: &[u8]) -> Result<Value, RpcError> {
    // no trim_text: it trims each piece, and entities split "a &amp; b" into three
    let mut reader = Reader::from_reader(data);

    skip_to_start(&mut reader, "methodResponse")?;

    let tag = next_start_tag(&mut reader)?;
    match tag.as_str() {
        "params" => {
            skip_to_start(&mut reader, "param")?;
            skip_to_start(&mut reader, "value")?;
            let val = read_value(&mut reader)?;
            Ok(val)
        }
        "fault" => {
            skip_to_start(&mut reader, "value")?;
            let fault = read_value(&mut reader)?;
            Err(fault_error(&fault, "unknown XML-RPC fault"))
        }
        other => Err(xml_err(format!(
            "expected <params> or <fault>, got <{other}>"
        ))),
    }
}

/// Parse a `system.multicall` response into results in call order, failing on the first fault.
pub fn parse_multicall_response(data: &[u8]) -> Result<Vec<Value>, RpcError> {
    let outer = parse_response(data)?;
    let array = outer
        .as_array()
        .ok_or_else(|| xml_err("multicall response is not an array"))?;

    let mut results = Vec::with_capacity(array.len());
    for item in array {
        if let Some(arr) = item.as_array() {
            // a success is a one-element array around the value
            if let Some(val) = arr.first() {
                results.push(val.clone());
            } else {
                results.push(Value::Null);
            }
        } else if item.is_object() {
            return Err(fault_error(item, "unknown multicall fault"));
        } else {
            results.push(item.clone());
        }
    }
    Ok(results)
}

/// Convert a fault struct to RpcError::Rpc, with the given message when it carries no faultString.
fn fault_error(fault: &Value, fallback: &str) -> RpcError {
    let code = fault.get("faultCode").and_then(Value::as_i64).unwrap_or(-1);
    let message = fault.get("faultString").and_then(Value::as_str).unwrap_or(fallback);
    RpcError::Rpc { code, message: message.to_string() }
}

/// Skip forward to an open or self-closing tag of a name, true when it is self-closing.
fn skip_to_start_or_empty(reader: &mut Reader<&[u8]>, tag_name: &str) -> Result<bool, RpcError> {
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) if e.name().as_ref() == tag_name => return Ok(false),
            Event::Empty(e) if e.name().as_ref() == tag_name => return Ok(true),
            Event::Eof => {
                return Err(xml_err(format!("unexpected EOF looking for <{tag_name}>")))
            }
            _ => {}
        }
    }
}

/// Skip forward to the next open tag of a name, past any self-closing one, erroring at EOF.
fn skip_to_start(reader: &mut Reader<&[u8]>, tag_name: &str) -> Result<(), RpcError> {
    while skip_to_start_or_empty(reader, tag_name)? {}
    Ok(())
}

/// Read the next Start event and return its tag name.
fn next_start_tag(reader: &mut Reader<&[u8]>) -> Result<String, RpcError> {
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) => return Ok(e.name().as_ref().to_string()),
            Event::Eof => return Err(xml_err("unexpected EOF")),
            _ => {}
        }
    }
}

/// Append an entity or character reference, decoded.
fn push_ref(text: &mut String, e: &BytesRef) -> Result<(), RpcError> {
    let raw = format!("&{};", &**e);
    text.push_str(&quick_xml::escape::unescape(&raw).map_err(xml_err)?);
    Ok(())
}

/// Read the text content of the current element until its closing tag.
fn read_text(reader: &mut Reader<&[u8]>) -> Result<String, RpcError> {
    let mut text = String::new();
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Text(e) => text.push_str(&e.xml10_content()),
            Event::GeneralRef(e) => push_ref(&mut text, &e)?,
            Event::End(_) => return Ok(text),
            Event::Eof => return Err(xml_err("unexpected EOF in text")),
            _ => {}
        }
    }
}

/// Read a `<value>` element past its opening tag, untyped text as a trimmed string.
fn read_value(reader: &mut Reader<&[u8]>) -> Result<Value, RpcError> {
    // text before a child tag is indentation; text up to </value> is a bare string
    let mut text = String::new();
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) => {
                let tag = e.name().as_ref().to_string();
                let val = read_typed_value(reader, &tag)?;
                skip_to_end_tag(reader, "value")?;
                return Ok(val);
            }
            Event::Empty(e) => {
                let val = empty_typed_value(e.name().as_ref())?;
                skip_to_end_tag(reader, "value")?;
                return Ok(val);
            }
            Event::Text(e) => text.push_str(&e.xml10_content()),
            Event::GeneralRef(e) => push_ref(&mut text, &e)?,
            Event::End(_) => return Ok(Value::String(text.trim().to_string())),
            Event::Eof => return Err(xml_err("unexpected EOF in <value>")),
            _ => {}
        }
    }
}

/// Convert a self-closing typed tag like `<nil/>` to its value, erroring on types needing content.
fn empty_typed_value(tag: &str) -> Result<Value, RpcError> {
    match tag {
        "nil" => Ok(Value::Null),
        "string" | "base64" => Ok(Value::String(String::new())),
        "array" => Ok(Value::Array(Vec::new())),
        "struct" => Ok(Value::Object(serde_json::Map::new())),
        other => Err(xml_err(format!("empty <{other}/> has no value"))),
    }
}

/// Read a value of the tag's type, from past its opening tag through its closing tag.
fn read_typed_value(reader: &mut Reader<&[u8]>, tag: &str) -> Result<Value, RpcError> {
    match tag {
        "string" => {
            let text = read_text(reader)?;
            Ok(Value::String(text))
        }
        "i4" | "int" | "i8" => {
            let text = read_text(reader)?;
            let n: i64 = text
                .trim()
                .parse()
                .map_err(|_| xml_err(format!("invalid integer: {text}")))?;
            Ok(Value::Number(n.into()))
        }
        "double" => {
            let text = read_text(reader)?;
            let f: f64 = text
                .trim()
                .parse()
                .map_err(|_| xml_err(format!("invalid double: {text}")))?;
            Ok(serde_json::Number::from_f64(f)
                .map(Value::Number)
                .unwrap_or(Value::Null))
        }
        "boolean" => {
            let text = read_text(reader)?;
            Ok(Value::Bool(text.trim() == "1"))
        }
        "base64" => {
            let text = read_text(reader)?;
            let decoded = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                text.trim(),
            )
            .map_err(|e| xml_err(format!("invalid base64: {e}")))?;
            Ok(Value::String(String::from_utf8_lossy(&decoded).into_owned()))
        }
        "array" => {
            let empty_data = skip_to_start_or_empty(reader, "data")?;
            let mut items = Vec::new();
            if !empty_data {
                loop {
                    match reader.read_event().map_err(xml_err)? {
                        Event::Start(e) if e.name().as_ref() == "value" => {
                            items.push(read_value(reader)?);
                        }
                        Event::End(e) if e.name().as_ref() == "data" => break,
                        Event::End(e) if e.name().as_ref() == "array" => return Ok(Value::Array(items)),
                        Event::Eof => return Err(xml_err("unexpected EOF in array")),
                        _ => {}
                    }
                }
            }
            skip_to_end_tag(reader, "array")?;
            Ok(Value::Array(items))
        }
        "struct" => {
            let mut map = serde_json::Map::new();
            loop {
                match reader.read_event().map_err(xml_err)? {
                    Event::Start(e) if e.name().as_ref() == "member" => {
                        let (name, val) = read_member(reader)?;
                        map.insert(name, val);
                    }
                    Event::End(e) if e.name().as_ref() == "struct" => break,
                    Event::Eof => return Err(xml_err("unexpected EOF in struct")),
                    _ => {}
                }
            }
            Ok(Value::Object(map))
        }
        "nil" => {
            read_text(reader).ok();
            Ok(Value::Null)
        }
        other => {
            let text = read_text(reader)?;
            Ok(Value::String(format!("[{other}]{text}")))
        }
    }
}

/// Read a `<member>` element past its opening tag into its name and value.
fn read_member(reader: &mut Reader<&[u8]>) -> Result<(String, Value), RpcError> {
    let mut name = String::new();
    let mut value = Value::Null;

    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(e) => {
                let tag_name = e.name();
                let tag = tag_name.as_ref();
                if tag == "name" {
                    name = read_text(reader)?;
                } else if tag == "value" {
                    value = read_value(reader)?;
                }
            }
            Event::End(e) if e.name().as_ref() == "member" => break,
            Event::Eof => return Err(xml_err("unexpected EOF in member")),
            _ => {}
        }
    }
    Ok((name, value))
}

/// Skip to the closing tag of a name at the current nesting depth.
fn skip_to_end_tag(reader: &mut Reader<&[u8]>, tag_name: &str) -> Result<(), RpcError> {
    let mut depth = 0u32;
    loop {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(_) => depth += 1,
            Event::End(e) => {
                if depth == 0 && e.name().as_ref() == tag_name {
                    return Ok(());
                }
                depth = depth.saturating_sub(1);
            }
            Event::Eof => {
                return Err(xml_err(format!(
                    "unexpected EOF looking for </{tag_name}>"
                )))
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serialize system.listMethods with no params as its methodName and an empty params element.
    #[test]
    fn test_serialize_call() {
        let body = serialize_call("system.listMethods", &[]).unwrap();
        let xml = String::from_utf8(body).unwrap();
        assert!(xml.contains("<methodName>system.listMethods</methodName>"));
        assert!(xml.contains("<params/>") || xml.contains("<params></params>"));
    }

    /// Serialize a string param as a <string> value.
    #[test]
    fn test_serialize_call_with_params() {
        let body = serialize_call(
            "d.name",
            &[Value::String("ABC123".into())],
        )
        .unwrap();
        let xml = String::from_utf8(body).unwrap();
        assert!(xml.contains("<methodName>d.name</methodName>"));
        assert!(xml.contains("<string>ABC123</string>"));
    }

    /// Parse a <string> value wrapped in newlines and indentation as just its text.
    #[test]
    fn test_parse_string_response() {
        let xml = br#"<?xml version="1.0"?>
        <methodResponse><params><param><value>
        <string>hello</string>
        </value></param></params></methodResponse>"#;
        let val = parse_response(xml).unwrap();
        assert_eq!(val, Value::String("hello".into()));
    }

    /// Parse an <i8> of 9876543210, past the i32 range, as a 64-bit number.
    #[test]
    fn test_parse_i8_response() {
        let xml = br#"<?xml version="1.0"?>
        <methodResponse><params><param><value>
        <i8>9876543210</i8>
        </value></param></params></methodResponse>"#;
        let val = parse_response(xml).unwrap();
        assert_eq!(val, Value::Number(9876543210i64.into()));
    }

    /// Parse an <array> response into a JSON array, order kept.
    #[test]
    fn test_parse_array_response() {
        let xml = br#"<?xml version="1.0"?>
        <methodResponse><params><param><value><array><data>
        <value><string>a</string></value>
        <value><string>b</string></value>
        </data></array></value></param></params></methodResponse>"#;
        let val = parse_response(xml).unwrap();
        assert_eq!(
            val,
            Value::Array(vec![Value::String("a".into()), Value::String("b".into())])
        );
    }

    /// Parse a fault as an Rpc error carrying its code and message.
    #[test]
    fn test_parse_fault() {
        let xml = br#"<?xml version="1.0"?>
        <methodResponse><fault><value><struct>
        <member><name>faultCode</name><value><i4>-503</i4></value></member>
        <member><name>faultString</name><value><string>Method not found</string></value></member>
        </struct></value></fault></methodResponse>"#;
        let err = parse_response(xml).unwrap_err();
        match err {
            RpcError::Rpc { code, message } => {
                assert_eq!(code, -503);
                assert_eq!(message, "Method not found");
            }
            other => panic!("expected Rpc error, got: {other}"),
        }
    }

    /// Parse untyped text in a <value> as a string trimmed of surrounding whitespace.
    #[test]
    fn test_parse_bare_string() {
        let xml = br#"<?xml version="1.0"?>
        <methodResponse><params><param><value>
        bare text
        </value></param></params></methodResponse>"#;
        let val = parse_response(xml).unwrap();
        assert_eq!(val, Value::String("bare text".into()));
    }

    /// Parse a multicall of a <string> and an <i4> as the two results unwrapped, in order.
    #[test]
    fn test_multicall_response() {
        let xml = br#"<?xml version="1.0"?>
        <methodResponse><params><param><value><array><data>
        <value><array><data><value><string>result1</string></value></data></array></value>
        <value><array><data><value><i4>42</i4></value></data></array></value>
        </data></array></value></param></params></methodResponse>"#;
        let results = parse_multicall_response(xml).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0], Value::String("result1".into()));
        assert_eq!(results[1], Value::Number(42.into()));
    }

    /// Serialize two calls as one system.multicall carrying both method names.
    #[test]
    fn test_serialize_multicall() {
        let calls = vec![
            ("d.name".into(), vec![Value::String("ABC".into())]),
            ("d.size_bytes".into(), vec![Value::String("ABC".into())]),
        ];
        let body = serialize_multicall(&calls).unwrap();
        let xml = String::from_utf8(body).unwrap();
        assert!(xml.contains("<methodName>system.multicall</methodName>"));
        assert!(xml.contains("d.name"));
        assert!(xml.contains("d.size_bytes"));
    }

    /// Parse nested file, peer and tracker multicalls, the empty peers as a self-closing <data/>.
    #[test]
    fn test_multicall_with_nested_multicalls() {
        let xml = br#"<?xml version="1.0"?>
        <methodResponse><params><param><value><array><data>
        <value><array><data><value><array><data>
          <value><array><data>
            <value><string>file1.mkv</string></value>
            <value><i8>1000000</i8></value>
            <value><i8>10</i8></value>
            <value><i8>10</i8></value>
            <value><i8>1</i8></value>
          </data></array></value>
          <value><array><data>
            <value><string>file2.mkv</string></value>
            <value><i8>2000000</i8></value>
            <value><i8>20</i8></value>
            <value><i8>15</i8></value>
            <value><i8>2</i8></value>
          </data></array></value>
        </data></array></value></data></array></value>
        <value><array><data><value><array><data/></array></value></data></array></value>
        <value><array><data><value><array><data>
          <value><array><data>
            <value><string>http://tracker.example.com/announce</string></value>
            <value><i4>1</i4></value>
            <value><i4>1</i4></value>
            <value><i4>50</i4></value>
            <value><i4>10</i4></value>
            <value><i4>100</i4></value>
            <value><i4>0</i4></value>
          </data></array></value>
        </data></array></value></data></array></value>
        <value><array><data><value><i4>0</i4></value></data></array></value>
        </data></array></value></param></params></methodResponse>"#;
        let results = parse_multicall_response(xml).unwrap();
        assert_eq!(results.len(), 4);
        let files = results[0].as_array().unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].as_array().unwrap()[0], Value::String("file1.mkv".into()));
        assert_eq!(files[1].as_array().unwrap()[0], Value::String("file2.mkv".into()));
        let peers = results[1].as_array().unwrap();
        assert_eq!(peers.len(), 0);
        let trackers = results[2].as_array().unwrap();
        assert_eq!(trackers.len(), 1);
        assert_eq!(results[3], Value::Number(0.into()));
    }

    /// Parse a 7-call rTorrent-shaped reply as 1 file, 1 tracker and 0 peers from a <data/>.
    #[test]
    fn test_parse_real_rtorrent_multicall() {
        let xml = br#"<?xml version="1.0"?><methodResponse><params><param><value><array><data><value><array><data><value><array><data><value><array><data><value><string>Big.Buck.Bunny.2008.1080p.x264.mkv</string></value><value><i8>7014591911</i8></value><value><i8>419</i8></value><value><i8>419</i8></value><value><i8>1</i8></value></data></array></value></data></array></value></data></array></value><value><array><data><value><array><data/></array></value></data></array></value><value><array><data><value><array><data><value><array><data><value><string>https://tracker.example.org/announce</string></value><value><i8>1</i8></value><value><i8>1</i8></value><value><i8>829</i8></value><value><i8>0</i8></value><value><i8>0</i8></value><value><i8>0</i8></value><value><i8>1771530242</i8></value><value><i8>2400</i8></value></data></array></value></data></array></value></data></array></value><value><array><data><value><i8>1</i8></value></data></array></value><value><array><data><value><i8>16777216</i8></value></data></array></value><value><array><data><value><i8>0</i8></value></data></array></value><value><array><data><value><i8>1771400828</i8></value></data></array></value></data></array></value></param></params></methodResponse>"#;
        let results = parse_multicall_response(xml).unwrap();
        assert_eq!(results.len(), 7);
        let files = results[0].as_array().unwrap();
        assert_eq!(files.len(), 1);
        let peers = results[1].as_array().unwrap();
        assert_eq!(peers.len(), 0);
        let trackers = results[2].as_array().unwrap();
        assert_eq!(trackers.len(), 1);
    }

    /// Parse a struct into an object, each member keeping its own type.
    #[test]
    fn test_parse_struct_response() {
        let xml = br#"<?xml version="1.0"?>
        <methodResponse><params><param><value><struct>
        <member><name>dht</name><value><string>auto</string></value></member>
        <member><name>active</name><value><i4>1</i4></value></member>
        </struct></value></param></params></methodResponse>"#;
        let val = parse_response(xml).unwrap();
        let obj = val.as_object().unwrap();
        assert_eq!(obj.get("dht").unwrap(), &Value::String("auto".into()));
        assert_eq!(obj.get("active").unwrap(), &Value::Number(1.into()));
    }

    /// Parse Tom &amp; Jerry &lt;1080p&gt; as Tom & Jerry <1080p>, spaces beside entities kept.
    #[test]
    fn test_entities_keep_surrounding_spaces() {
        let xml = b"<methodResponse><params><param><value><string>Tom &amp; Jerry &lt;1080p&gt;</string></value></param></params></methodResponse>";
        assert_eq!(parse_response(xml).unwrap(), Value::String("Tom & Jerry <1080p>".into()));
    }

    /// Decode decimal and hex character references, a&#38;b&#x2F;c to a&b/c.
    #[test]
    fn test_char_refs_decode() {
        let xml = b"<methodResponse><params><param><value><string>a&#38;b&#x2F;c</string></value></param></params></methodResponse>";
        assert_eq!(parse_response(xml).unwrap(), Value::String("a&b/c".into()));
    }

    /// Read untyped x &amp; y as the whole x & y, not stopping at the entity.
    #[test]
    fn test_bare_value_reads_past_entities() {
        let xml = b"<methodResponse><params><param><value>x &amp; y</value></param></params></methodResponse>";
        assert_eq!(parse_response(xml).unwrap(), Value::String("x & y".into()));
    }

    /// Parse a response indented at every level, padded <i4> 7 </i4> included, as [7].
    #[test]
    fn test_indented_response_parses() {
        let xml = b"<methodResponse>\n  <params>\n    <param>\n      <value>\n        <array><data>\n          <value><i4> 7 </i4></value>\n        </data></array>\n      </value>\n    </param>\n  </params>\n</methodResponse>";
        assert_eq!(parse_response(xml).unwrap(), serde_json::json!([7]));
    }

    /// Parse a string holding the undefined entity &bogus; as an error, not as text.
    #[test]
    fn test_unknown_entity_is_an_error() {
        let xml = b"<methodResponse><params><param><value><string>&bogus;</string></value></param></params></methodResponse>";
        assert!(parse_response(xml).is_err());
    }

    /// Serialize the string a<b&c with < and & escaped as &lt; and &amp;.
    #[test]
    fn test_serialize_escapes_markup() {
        let body = serialize_call("d.name", &[Value::String("a<b&c".into())]).unwrap();
        let xml = String::from_utf8(body).unwrap();
        assert!(xml.contains("<string>a&lt;b&amp;c</string>"));
    }

    /// Parse self-closing typed values: <nil/> as null, <string/> as empty, <i4/> as an error.
    #[test]
    fn test_self_closing_typed_values() {
        let wrap = |inner: &str| {
            format!("<methodResponse><params><param><value>{inner}</value></param></params></methodResponse>")
        };
        assert_eq!(parse_response(wrap("<nil/>").as_bytes()).unwrap(), Value::Null);
        assert_eq!(parse_response(wrap("<string/>").as_bytes()).unwrap(), Value::String(String::new()));
        assert!(parse_response(wrap("<i4/>").as_bytes()).is_err());
    }
}
