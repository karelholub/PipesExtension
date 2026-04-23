(function exposeConstants(root) {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    sdk_source_url: "https://meiro-internal.eu.pipes.meiro.io/mpt.js",
    collection_endpoint: "https://meiro-internal.eu.pipes.meiro.io/collect/meiro-io",
    app_key: "",
    user_id: "a04b882d-f5a6-42a7-8a17-4b17c7129d48",
    tracking_enabled: true,
    debug: true,
    consent_override: true,
    sending_allowed: true,
    mode: "hybrid",
    data_layer_names: ["dataLayer", "digitalData", "utag_data"],
    selector_rules: [],
    capture_scroll_depth: true,
    capture_outbound_clicks: true,
    capture_file_downloads: true
  });

  const DEFAULT_CONTRACTS = Object.freeze([
    {
      event_type: "page_view",
      required_paths: [
        "type",
        "version",
        "timestamp",
        "user_id",
        "session_id",
        "payload.page_title",
        "payload.page_url",
        "client_ids.meiro_user_id"
      ]
    },
    {
      event_type: "click",
      required_paths: [
        "type",
        "timestamp",
        "user_id",
        "session_id",
        "payload.page_url",
        "payload.custom_payload.element_tag",
        "payload.custom_payload.selector"
      ]
    },
    {
      event_type: "form_submit",
      required_paths: [
        "type",
        "timestamp",
        "user_id",
        "session_id",
        "payload.page_url",
        "payload.custom_payload.form_method",
        "payload.custom_payload.input_fields"
      ]
    }
  ]);

  const DEFAULT_PROFILES = Object.freeze([
    {
      id: "default-meiro-internal",
      name: "Meiro internal default",
      settings: DEFAULT_SETTINGS
    }
  ]);

  const MODES = Object.freeze({
    INJECT_SDK: "inject_sdk",
    SIMULATE_ONLY: "simulate_only",
    HYBRID: "hybrid"
  });

  const EVENT_VERSION = "1.2.0";
  const LOG_LIMIT = 200;
  const STORAGE_KEYS = Object.freeze({
    SETTINGS: "meiro_tracker_settings",
    IDENTITY: "meiro_tracker_identity",
    LOGS: "meiro_tracker_logs",
    CONTRACTS: "meiro_tracker_contracts",
    PROFILES: "meiro_tracker_profiles",
    ENABLED_TABS: "meiro_tracker_enabled_tabs"
  });

  const SENSITIVE_FIELD_PATTERNS = Object.freeze([
    /password/i,
    /passwd/i,
    /pwd/i,
    /card.?number/i,
    /cc.?num/i,
    /credit.?card/i,
    /cvc/i,
    /cvv/i,
    /security.?code/i,
    /ssn/i,
    /social.?security/i,
    /national.?id/i,
    /passport/i,
    /token/i,
    /auth/i,
    /secret/i,
    /csrf/i,
    /otp/i,
    /pin/i
  ]);

  const FILE_DOWNLOAD_EXTENSIONS = Object.freeze([
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "csv",
    "zip",
    "rar",
    "7z",
    "tar",
    "gz",
    "mp3",
    "mp4",
    "mov",
    "avi"
  ]);

  root.MeiroTrackerShared = Object.assign(root.MeiroTrackerShared || {}, {
    DEFAULT_SETTINGS,
    DEFAULT_CONTRACTS,
    DEFAULT_PROFILES,
    MODES,
    EVENT_VERSION,
    LOG_LIMIT,
    STORAGE_KEYS,
    SENSITIVE_FIELD_PATTERNS,
    FILE_DOWNLOAD_EXTENSIONS
  });
})(globalThis);
