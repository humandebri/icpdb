// Where: crates/icpdb_canister/src/http.rs
// What: HTTP DTOs, JSON response helpers, and bearer-token header parsing.
// Why: The control canister keeps endpoint logic in lib.rs while HTTP wire details stay isolated.

use candid::{CandidType, Deserialize};
use icpdb_runtime::RequiredRole;
use icpdb_types::{DatabaseRole, DatabaseTokenScope};
use serde::Deserialize as JsonDeserialize;

const HTTP_JSON_CONTENT_TYPE: &str = "application/json";
const HTTP_CORS_ALLOW_HEADERS: &str = "authorization, content-type, idempotency-key";
const HTTP_CORS_ALLOW_METHODS: &str = "POST, OPTIONS";

pub(crate) type HeaderField = (String, String);

#[derive(Clone, Debug, CandidType, Deserialize)]
pub(crate) struct HttpRequest {
    pub(crate) method: String,
    pub(crate) url: String,
    pub(crate) headers: Vec<HeaderField>,
    pub(crate) body: Vec<u8>,
    pub(crate) certificate_version: Option<u16>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub(crate) struct HttpUpdateRequest {
    pub(crate) method: String,
    pub(crate) url: String,
    pub(crate) headers: Vec<HeaderField>,
    pub(crate) body: Vec<u8>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub(crate) struct HttpResponse {
    pub(crate) status_code: u16,
    pub(crate) headers: Vec<HeaderField>,
    pub(crate) body: Vec<u8>,
    pub(crate) upgrade: Option<bool>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub(crate) struct HttpUpdateResponse {
    pub(crate) status_code: u16,
    pub(crate) headers: Vec<HeaderField>,
    pub(crate) body: Vec<u8>,
}

#[derive(Clone, Debug, JsonDeserialize)]
pub(crate) struct DatabaseIdRequest {
    pub(crate) database_id: String,
}

#[derive(Clone, Debug, JsonDeserialize)]
pub(crate) struct DescribeTableRequest {
    pub(crate) database_id: String,
    pub(crate) table_name: String,
}

#[derive(Clone, Debug, JsonDeserialize)]
pub(crate) struct RevokeDatabaseTokenRequest {
    pub(crate) database_id: String,
    pub(crate) token_id: String,
}

#[derive(Clone, Debug, JsonDeserialize)]
pub(crate) struct GrantDatabaseAccessRequest {
    pub(crate) database_id: String,
    pub(crate) principal: String,
    pub(crate) role: DatabaseRole,
}

#[derive(Clone, Debug, JsonDeserialize)]
pub(crate) struct RevokeDatabaseAccessRequest {
    pub(crate) database_id: String,
    pub(crate) principal: String,
}

pub(crate) struct HttpUsageContext<'a> {
    pub(crate) required_role: RequiredRole,
    pub(crate) now: i64,
    pub(crate) method: &'a str,
    pub(crate) operation: Option<&'a str>,
    pub(crate) database_id: &'a str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HttpUpdateRoute {
    ArchiveBegin,
    ArchiveCancel,
    ArchiveFinalize,
    ArchiveRead,
    Billing,
    DatabaseDelete,
    MembersGrant,
    MembersList,
    MembersRevoke,
    OperationsGet,
    PaymentsList,
    PlacementsGet,
    QuotaSet,
    RestoreBegin,
    RestoreFinalize,
    RestoreWrite,
    Session,
    SqlBatch,
    SqlExecute,
    SqlQuery,
    TablesDescribe,
    TablesList,
    TablesPreview,
    TokensCreate,
    TokensList,
    TokensRevoke,
    Usage,
    UsageEvents,
}

impl HttpUpdateRoute {
    pub(crate) fn from_path(path: &str) -> Option<Self> {
        match path {
            "/v1/archive/begin" => Some(Self::ArchiveBegin),
            "/v1/archive/cancel" => Some(Self::ArchiveCancel),
            "/v1/archive/finalize" => Some(Self::ArchiveFinalize),
            "/v1/archive/read" => Some(Self::ArchiveRead),
            "/v1/billing" => Some(Self::Billing),
            "/v1/database/delete" => Some(Self::DatabaseDelete),
            "/v1/members/grant" => Some(Self::MembersGrant),
            "/v1/members/list" => Some(Self::MembersList),
            "/v1/members/revoke" => Some(Self::MembersRevoke),
            "/v1/operations/get" => Some(Self::OperationsGet),
            "/v1/payments/list" => Some(Self::PaymentsList),
            "/v1/placements/get" => Some(Self::PlacementsGet),
            "/v1/quota/set" => Some(Self::QuotaSet),
            "/v1/restore/begin" => Some(Self::RestoreBegin),
            "/v1/restore/finalize" => Some(Self::RestoreFinalize),
            "/v1/restore/write" => Some(Self::RestoreWrite),
            "/v1/session" => Some(Self::Session),
            "/v1/sql/batch" => Some(Self::SqlBatch),
            "/v1/sql/execute" => Some(Self::SqlExecute),
            "/v1/sql/query" => Some(Self::SqlQuery),
            "/v1/tables/describe" => Some(Self::TablesDescribe),
            "/v1/tables/list" => Some(Self::TablesList),
            "/v1/tables/preview" => Some(Self::TablesPreview),
            "/v1/tokens/create" => Some(Self::TokensCreate),
            "/v1/tokens/list" => Some(Self::TokensList),
            "/v1/tokens/revoke" => Some(Self::TokensRevoke),
            "/v1/usage" => Some(Self::Usage),
            "/v1/usage/events" => Some(Self::UsageEvents),
            _ => None,
        }
    }
}

pub(crate) fn route_http_query_request(request: &HttpRequest) -> HttpResponse {
    if request.method.eq_ignore_ascii_case("OPTIONS") {
        return cors_preflight_response();
    }
    if !request.method.eq_ignore_ascii_case("POST") {
        return json_query_response(
            405,
            serde_json::json!({ "error": "only POST is supported" }),
        );
    }
    let path = request.url.split('?').next().unwrap_or("");
    if HttpUpdateRoute::from_path(path).is_some() {
        return upgrade_response();
    }
    json_query_response(404, serde_json::json!({ "error": "unknown endpoint" }))
}

pub(crate) fn parse_update_route(url: &str) -> Result<HttpUpdateRoute, (u16, String)> {
    let path = url.split('?').next().unwrap_or("");
    HttpUpdateRoute::from_path(path).ok_or_else(|| (404, "unknown endpoint".to_string()))
}

pub(crate) fn decode_json_body<T>(body: &[u8], label: &str) -> Result<T, (u16, String)>
where
    T: for<'de> serde::Deserialize<'de>,
{
    serde_json::from_slice::<T>(body)
        .map_err(|error| (400, format!("invalid JSON {label}: {error}")))
}

pub(crate) fn bearer_token(headers: &[HeaderField]) -> Option<&str> {
    headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("authorization"))
        .and_then(|(_, value)| {
            let mut parts = value.split_whitespace();
            let scheme = parts.next()?;
            let token = parts.next()?;
            if scheme.eq_ignore_ascii_case("bearer") {
                Some(token)
            } else {
                None
            }
        })
}

pub(crate) fn idempotency_key(headers: &[HeaderField]) -> Option<&str> {
    headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("idempotency-key"))
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty())
}

pub(crate) fn http_error_status(error: &str) -> u16 {
    if error == "api token scope does not allow this operation" {
        return 403;
    }
    if error.contains("token") {
        return 401;
    }
    400
}

pub(crate) fn json_query_response(status_code: u16, value: serde_json::Value) -> HttpResponse {
    let body = serde_json::to_vec(&value)
        .unwrap_or_else(|_| b"{\"error\":\"failed to encode response\"}".to_vec());
    HttpResponse {
        status_code,
        headers: json_headers(),
        body,
        upgrade: None,
    }
}

pub(crate) fn json_response(status_code: u16, value: serde_json::Value) -> HttpUpdateResponse {
    let body = serde_json::to_vec(&value)
        .unwrap_or_else(|_| b"{\"error\":\"failed to encode response\"}".to_vec());
    HttpUpdateResponse {
        status_code,
        headers: json_headers(),
        body,
    }
}

pub(crate) fn cors_preflight_response() -> HttpResponse {
    HttpResponse {
        status_code: 204,
        headers: json_headers(),
        body: Vec::new(),
        upgrade: None,
    }
}

fn upgrade_response() -> HttpResponse {
    HttpResponse {
        status_code: 200,
        headers: json_headers(),
        body: Vec::new(),
        upgrade: Some(true),
    }
}

pub(crate) fn json_headers() -> Vec<HeaderField> {
    vec![
        (
            "content-type".to_string(),
            HTTP_JSON_CONTENT_TYPE.to_string(),
        ),
        ("access-control-allow-origin".to_string(), "*".to_string()),
        (
            "access-control-allow-methods".to_string(),
            HTTP_CORS_ALLOW_METHODS.to_string(),
        ),
        (
            "access-control-allow-headers".to_string(),
            HTTP_CORS_ALLOW_HEADERS.to_string(),
        ),
        ("access-control-max-age".to_string(), "600".to_string()),
    ]
}

pub(crate) fn token_scope_role(scope: DatabaseTokenScope) -> &'static str {
    match scope {
        DatabaseTokenScope::Read => "reader",
        DatabaseTokenScope::Write => "writer",
        DatabaseTokenScope::Owner => "owner",
    }
}
