(function exposeBrowserUtils(root) {
  "use strict";

  const shared = root.MeiroTrackerShared || {};

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeSettings(settings) {
    return Object.assign({}, shared.DEFAULT_SETTINGS, settings || {});
  }

  function uuid() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return root.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    root.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join("")
    ].join("-");
  }

  function isValidHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch (_error) {
      return false;
    }
  }

  function endpointPermissionPattern(value) {
    if (!isValidHttpUrl(value)) {
      return null;
    }

    const url = new URL(value);
    return `${url.protocol}//${url.host}/*`;
  }

  function pagePermissionPattern(value) {
    if (!isValidHttpUrl(value)) {
      return null;
    }

    const url = new URL(value);
    return `${url.protocol}//${url.host}/*`;
  }

  function safeTrimmedText(element, maxLength) {
    if (!element || typeof element.textContent !== "string") {
      return null;
    }

    const text = element.textContent.replace(/\s+/g, " ").trim();
    if (!text) {
      return null;
    }

    return text.slice(0, maxLength || 120);
  }

  function getClassList(element) {
    if (!element || !element.classList) {
      return [];
    }

    return Array.from(element.classList).filter(Boolean).slice(0, 20);
  }

  function cssEscape(value) {
    if (root.CSS && typeof root.CSS.escape === "function") {
      return root.CSS.escape(value);
    }

    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function simplifiedSelector(element) {
    if (!element || !element.tagName) {
      return null;
    }

    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 5) {
      const tag = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift(`${tag}#${cssEscape(current.id)}`);
        break;
      }

      const classes = getClassList(current).slice(0, 2).map((item) => `.${cssEscape(item)}`).join("");
      let selector = `${tag}${classes}`;
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      path.unshift(selector);
      current = parent;
    }

    return path.join(" > ");
  }

  function closestInteractiveElement(target) {
    if (!target || !target.closest) {
      return null;
    }

    return target.closest("a, button, input, select, textarea, label, summary, [role='button'], [role='link'], [data-meiro-event]");
  }

  function nearestHref(element) {
    const anchor = element && element.closest ? element.closest("a[href], area[href]") : null;
    return anchor ? anchor.href : null;
  }

  function isOutboundUrl(href) {
    if (!href) {
      return false;
    }

    try {
      const url = new URL(href, root.location.href);
      return url.hostname !== root.location.hostname && /^https?:$/.test(url.protocol);
    } catch (_error) {
      return false;
    }
  }

  function isDownloadUrl(href) {
    if (!href) {
      return false;
    }

    try {
      const url = new URL(href, root.location.href);
      const extension = url.pathname.split(".").pop().toLowerCase();
      return shared.FILE_DOWNLOAD_EXTENSIONS.includes(extension);
    } catch (_error) {
      return false;
    }
  }

  function isSensitiveField(field) {
    if (!field) {
      return false;
    }

    const type = (field.getAttribute("type") || "").toLowerCase();
    if (type === "password" || type === "hidden") {
      return true;
    }

    const haystack = [
      field.name,
      field.id,
      field.getAttribute("autocomplete"),
      field.getAttribute("aria-label"),
      field.placeholder
    ].filter(Boolean).join(" ");

    return shared.SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(haystack));
  }

  function inputMetadata(form) {
    if (!form || !form.elements) {
      return [];
    }

    return Array.from(form.elements)
      .filter((field) => field && field.tagName)
      .map((field) => {
        // Intentionally collect names and structural metadata only. Values are
        // never read here, and sensitive-looking fields are anonymized further.
        const tag = field.tagName.toLowerCase();
        const type = (field.getAttribute("type") || tag).toLowerCase();
        const sensitive = isSensitiveField(field);
        return {
          tag,
          type,
          name: sensitive ? null : field.name || null,
          id: sensitive ? null : field.id || null,
          sensitive_excluded: sensitive
        };
      })
      .filter((field) => field.name || field.id || field.sensitive_excluded);
  }

  function debugLog(settings, message, details) {
    if (!settings || !settings.debug) {
      return;
    }

    if (details !== undefined) {
      console.debug("[Meiro Event Simulator]", message, details);
    } else {
      console.debug("[Meiro Event Simulator]", message);
    }
  }

  root.MeiroTrackerShared = Object.assign(shared, {
    clone,
    mergeSettings,
    uuid,
    isValidHttpUrl,
    endpointPermissionPattern,
    pagePermissionPattern,
    safeTrimmedText,
    getClassList,
    simplifiedSelector,
    closestInteractiveElement,
    nearestHref,
    isOutboundUrl,
    isDownloadUrl,
    isSensitiveField,
    inputMetadata,
    debugLog
  });
})(globalThis);
