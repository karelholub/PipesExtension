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
    consent: {
      storage_persistence: "granted",
      user_id: "granted",
      session_id: "granted"
    },
    mode: "hybrid",
    data_layer_names: ["dataLayer", "digitalData", "utag_data"],
    selector_rules: [],
    observe_tracking_requests: true,
    enable_web_layers: true,
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

  const DEFAULT_RECIPES = Object.freeze([
    {
      id: "cta-click",
      name: "CTA click",
      description: "Track a prominent call-to-action button or link.",
      rule: {
        event_type: "cta_click",
        name: "CTA click",
        selector: "",
        text_contains: "",
        href_contains: ""
      }
    },
    {
      id: "outbound-link",
      name: "Outbound link",
      description: "Track outbound navigation to another site.",
      rule: {
        event_type: "outbound_link_click",
        name: "Outbound link",
        selector: "a[href]",
        text_contains: "",
        href_contains: "http"
      }
    },
    {
      id: "file-download",
      name: "File download",
      description: "Track document or asset downloads from links.",
      rule: {
        event_type: "file_download",
        name: "File download",
        selector: "a[href]",
        text_contains: "",
        href_contains: ".pdf"
      }
    },
    {
      id: "lead-form",
      name: "Lead form submit",
      description: "Track a marketing or contact form submission.",
      rule: {
        event_type: "lead_form_submit",
        name: "Lead form submit",
        selector: "form",
        text_contains: "",
        href_contains: ""
      }
    },
    {
      id: "newsletter-signup",
      name: "Newsletter signup",
      description: "Track newsletter opt-in submits or clicks.",
      rule: {
        event_type: "newsletter_signup",
        name: "Newsletter signup",
        selector: "",
        text_contains: "newsletter",
        href_contains: ""
      }
    }
  ]);

  const MODES = Object.freeze({
    INJECT_SDK: "inject_sdk",
    SIMULATE_ONLY: "simulate_only",
    HYBRID: "hybrid"
  });

  // The real Pipes Web SDK (mpt.js) only accepts these predefined GA4-style
  // event names via mpt('event', name, ...) and rejects anything else with a
  // console error. Keep this in sync with the identical list hardcoded in
  // src/injected/page-bridge.js, which cannot reach this shared module because
  // it runs in the page's own JS world, not the extension's isolated world.
  const GA4_STANDARD_EVENT_NAMES = Object.freeze([
    "page_view", "click", "form_start", "form_submit", "scroll", "file_download", "search",
    "session_start", "first_visit", "user_engagement",
    "video_start", "video_progress", "video_complete",
    "add_to_cart", "remove_from_cart", "view_item", "view_item_list", "view_cart",
    "begin_checkout", "add_shipping_info", "add_payment_info", "purchase", "refund",
    "select_item", "select_promotion", "view_promotion", "add_to_wishlist",
    "generate_lead", "qualify_lead", "working_lead", "close_convert_lead",
    "close_unconvert_lead", "disqualify_lead",
    "select_content", "share", "login", "sign_up", "join_group", "view_search_results",
    "tutorial_begin", "tutorial_complete", "level_start", "level_end", "level_up",
    "post_score", "unlock_achievement", "earn_virtual_currency", "spend_virtual_currency"
  ]);

  const DEFAULT_PROFILE_API_PATH = "/profile-api/extension";
  const EVENT_VERSION = "1.2.0";
  const LOG_LIMIT = 200;
  const STORAGE_KEYS = Object.freeze({
    SETTINGS: "meiro_tracker_settings",
    IDENTITY: "meiro_tracker_identity",
    LOGS: "meiro_tracker_logs",
    CONTRACTS: "meiro_tracker_contracts",
    PROFILES: "meiro_tracker_profiles",
    ENABLED_TABS: "meiro_tracker_enabled_tabs",
    PRISM_CONNECTION: "meiro_tracker_prism_connection",
    TRANSFORM_TESTS: "meiro_tracker_transform_tests"
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
    DEFAULT_RECIPES,
    MODES,
    GA4_STANDARD_EVENT_NAMES,
    DEFAULT_PROFILE_API_PATH,
    EVENT_VERSION,
    LOG_LIMIT,
    STORAGE_KEYS,
    SENSITIVE_FIELD_PATTERNS,
    FILE_DOWNLOAD_EXTENSIONS
  });
})(globalThis);
