//! JSON-RPC 2.0 request and response types, and the RPC error and reply cap every transport shares.
use serde::{Deserialize, Serialize};

/// Largest response body accepted; rTorrent replies are torrent lists, not downloads.
pub(crate) const MAX_RESPONSE: u64 = 64 * 1024 * 1024;

/// A JSON-RPC 2.0 request, sent alone or as one entry of a batch.
#[derive(Debug, Serialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: &'static str,
    pub method: String,
    pub params: Vec<serde_json::Value>,
    pub id: u64,
}

/// A JSON-RPC 2.0 response, holding either a result or an error object.
#[derive(Debug, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub result: Option<serde_json::Value>,
    pub error: Option<JsonRpcError>,
    pub id: Option<u64>,
}

/// A JSON-RPC 2.0 error object, surfaced to callers as RpcError::Rpc.
#[derive(Debug, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
}

/// RPC failure, from transport and protocol errors to server faults.
#[derive(Debug, thiserror::Error)]
pub enum RpcError {
    #[error("connection failed: {0}")]
    Connection(String),

    /// A socket error before any login, such as a refused or timed-out connect.
    #[error("connection failed: {0}")]
    Unreachable(String),

    #[error("protocol error: {0}")]
    Protocol(String),

    #[error("RPC error {code}: {message}")]
    Rpc { code: i64, message: String },

    #[error("JSON serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("XML error: {0}")]
    Xml(String),
}

impl RpcError {
    /// Build the error for a reply over MAX_RESPONSE.
    pub(crate) fn too_large() -> Self {
        RpcError::Connection("response exceeded 64 MiB".into())
    }
}

/// Serialize a JSON-RPC request to bytes.
pub fn serialize_request(request: &JsonRpcRequest) -> Result<Vec<u8>, RpcError> {
    serde_json::to_vec(request).map_err(RpcError::from)
}

/// Serialize a batch of JSON-RPC requests to bytes.
pub fn serialize_batch(requests: &[JsonRpcRequest]) -> Result<Vec<u8>, RpcError> {
    serde_json::to_vec(requests).map_err(RpcError::from)
}

/// Parse a JSON-RPC response, turning an error object into RpcError::Rpc.
pub fn parse_response(data: &[u8]) -> Result<JsonRpcResponse, RpcError> {
    let response: JsonRpcResponse = serde_json::from_slice(data)?;
    if let Some(err) = &response.error {
        return Err(RpcError::Rpc {
            code: err.code,
            message: err.message.clone(),
        });
    }
    Ok(response)
}

/// Parse a batch of JSON-RPC responses, leaving error objects for the caller.
pub fn parse_batch_response(data: &[u8]) -> Result<Vec<JsonRpcResponse>, RpcError> {
    let responses: Vec<JsonRpcResponse> = serde_json::from_slice(data)?;
    Ok(responses)
}
