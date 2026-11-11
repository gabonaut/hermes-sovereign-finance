// Sovereign Finance pane for Hermes Desktop. Built from pane/src by pane/build.mjs: edit the
// sources, not this file.
// Bundles uqr 0.1.3 (MIT), Copyright (c) Project Nayuki, Copyright (c) 2023 Anthony Fu, with its
// string-to-bytes helper swapped for TextEncoder (see build.mjs).

// src/app.tsx
import { Button as Button7, ErrorState, Skeleton as Skeleton3 } from "@hermes/plugin-sdk";
import { useCallback as useCallback2, useEffect as useEffect3, useMemo as useMemo2, useRef as useRef3, useState as useState8, useSyncExternalStore } from "react";

// src/format.ts
var ELLIPSIS = "\u2026";
function shortHex(value, head = 6, tail = 4) {
  return value.length > head + tail + 2 ? value.slice(0, head) + ELLIPSIS + value.slice(-tail) : value;
}
var DECIMAL_RE = /^(\d*)(?:\.(\d*))?$/;
function parseDec(value) {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) return null;
  const whole = m[1] ?? "";
  const frac = m[2] ?? "";
  if (whole === "" && frac === "") return null;
  return { digits: BigInt((whole || "0") + frac), scale: frac.length };
}
var isDecimal = (value) => parseDec(value) !== null;
function isPositive(value) {
  const d = parseDec(value);
  return d !== null && d.digits > 0n;
}
function fractionDigits(value) {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m || (m[1] ?? "") === "" && (m[2] ?? "") === "") return -1;
  return (m[2] ?? "").replace(/0+$/, "").length;
}
function compareDecimal(a, b) {
  const x = parseDec(a);
  const y = parseDec(b);
  if (!x || !y) return null;
  const scale = Math.max(x.scale, y.scale);
  const xs = x.digits * 10n ** BigInt(scale - x.scale);
  const ys = y.digits * 10n ** BigInt(scale - y.scale);
  return xs === ys ? 0 : xs < ys ? -1 : 1;
}
function displayAmount(value) {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m || (m[1] ?? "") === "" && (m[2] ?? "") === "") return value;
  const whole = (m[1] ?? "").replace(/^0+(?=\d)/, "") || "0";
  let frac = m[2] ?? "";
  const leadingZeros = /^0*/.exec(frac)?.[0].length ?? 0;
  const keep = whole === "0" ? Math.min(18, Math.max(6, leadingZeros + 4)) : 6;
  if (frac.length > keep) frac = frac.slice(0, keep);
  const grouped = whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  return frac ? `${grouped}.${frac}` : grouped;
}
var MINUTE = 6e4;
var HOUR = 36e5;
var DAY = 864e5;
function parseTime(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
function span(ms) {
  const count = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (ms < HOUR) return count(Math.max(1, Math.round(ms / MINUTE)), "minute");
  if (ms < 2 * DAY) return count(Math.round(ms / HOUR), "hour");
  return count(Math.round(ms / DAY), "day");
}
function relativeTime(targetMs, nowMs) {
  const diff = targetMs - nowMs;
  if (Math.abs(diff) < MINUTE) return diff > 0 ? "in under a minute" : "just now";
  return diff > 0 ? `in ${span(diff)}` : `${span(-diff)} ago`;
}
var timeAgo = (thenMs, nowMs) => relativeTime(Math.min(thenMs, nowMs), nowMs);
var dateFormat = null;
var dateTimeFormat = null;
function formatDate(ms) {
  dateFormat ??= new Intl.DateTimeFormat(void 0, { dateStyle: "medium" });
  return dateFormat.format(ms);
}
function formatDateTime(ms) {
  dateTimeFormat ??= new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" });
  return dateTimeFormat.format(ms);
}
function rangePosition(lower, upper, current) {
  const lo = Number(lower);
  const hi = Number(upper);
  const cur = Number(current);
  if (![lo, hi, cur].every((n) => Number.isFinite(n) && n > 0) || hi <= lo) return null;
  return (Math.log(cur) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
}
function parseUrl(value) {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
function isWebUrl(value) {
  const url = parseUrl(value);
  return url !== null && (url.protocol === "http:" || url.protocol === "https:");
}
function isLoopbackUrl(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host3 = url.hostname.toLowerCase();
  return host3 === "localhost" || host3.endsWith(".localhost") || host3 === "127.0.0.1" || host3 === "[::1]";
}
var isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value.trim());

// src/header.tsx
import { Badge, ConfirmDialog, SegmentedControl, Skeleton } from "@hermes/plugin-sdk";
import { useState as useState2 } from "react";

// src/api.ts
var SLOW_TIMEOUT_MS = 25e3;
var ApiError = class extends Error {
  code;
  /** HTTP status when the request itself failed, otherwise null. */
  status;
  constructor(code, message, status = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
  /** The caller is not the local Desktop app. Nothing in the pane can fix that. */
  get forbidden() {
    return this.status === 403;
  }
};
var MAX_DETAIL = 280;
function clip(value) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > MAX_DETAIL ? flat.slice(0, MAX_DETAIL - 1) + ELLIPSIS : flat;
}
function bodyDetail(body) {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const candidate = parsed.error?.message ?? parsed.detail ?? parsed.message;
      if (typeof candidate === "string" && candidate.trim()) return clip(candidate);
    } catch {
    }
  }
  return clip(trimmed);
}
function httpError(status, body) {
  const detail = bodyDetail(body);
  if (status === 403) {
    return new ApiError(
      "forbidden",
      "The wallet backend only answers Hermes Desktop running on this computer.",
      status
    );
  }
  if (status === 404) {
    return new ApiError(
      "not_found",
      "The Sovereign Finance backend is not mounted. Enable the plugin for this profile, then restart the gateway.",
      status
    );
  }
  return new ApiError("http_" + status, detail ? `The backend answered ${status}: ${detail}` : `The backend answered ${status}.`, status);
}
function toApiError(err) {
  if (err instanceof ApiError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const http = /(?:^|\s)([1-5]\d\d):\s?([\s\S]*)$/.exec(raw);
  if (http) return httpError(Number(http[1]), http[2] ?? "");
  if (/timed out/i.test(raw)) return new ApiError("timeout", "The backend did not answer in time.");
  return new ApiError("unreachable", clip(raw) || "The backend could not be reached.");
}
function unwrap(res) {
  const env = res !== null && typeof res === "object" ? res : null;
  if (env && env.ok === true) return env.data;
  if (env && env.ok === false) {
    const code = typeof env.error?.code === "string" && env.error.code ? env.error.code : "error";
    const message = typeof env.error?.message === "string" ? env.error.message.trim() : "";
    throw new ApiError(code, message || `The backend refused the request (${code}).`);
  }
  throw new ApiError("bad_response", "The backend sent a response the pane cannot read.");
}
function createApi(ctx) {
  const call = async (path, init) => {
    let res;
    try {
      res = await ctx.rest(path, init);
    } catch (err) {
      throw toApiError(err);
    }
    return unwrap(res);
  };
  return {
    get: (path, timeoutMs) => call(path, timeoutMs ? { timeoutMs } : {}),
    post: (path, body, timeoutMs) => call(path, timeoutMs ? { method: "POST", body, timeoutMs } : { method: "POST", body })
  };
}
function errorText(err) {
  return toApiError(err).message;
}

// src/icons.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function Glyph({ children, ...props }) {
  return /* @__PURE__ */ jsx(
    "svg",
    {
      "aria-hidden": "true",
      fill: "none",
      focusable: "false",
      height: "14",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: "2",
      viewBox: "0 0 24 24",
      width: "14",
      ...props,
      children
    }
  );
}
var IconCheck = (props) => /* @__PURE__ */ jsx(Glyph, { strokeWidth: "2.5", ...props, children: /* @__PURE__ */ jsx("path", { d: "M5 12.5l4.5 4.5L19 7.5" }) });
var IconChevron = (props) => /* @__PURE__ */ jsx(Glyph, { ...props, children: /* @__PURE__ */ jsx("path", { d: "M9 6l6 6-6 6" }) });
var IconExternal = (props) => /* @__PURE__ */ jsxs(Glyph, { ...props, children: [
  /* @__PURE__ */ jsx("path", { d: "M7 17L17 7" }),
  /* @__PURE__ */ jsx("path", { d: "M9 7h8v8" })
] });
var IconAlert = (props) => /* @__PURE__ */ jsxs(Glyph, { ...props, children: [
  /* @__PURE__ */ jsx("path", { d: "M12 9v4" }),
  /* @__PURE__ */ jsx("path", { d: "M12 16.5v.01" }),
  /* @__PURE__ */ jsx("path", { d: "M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" })
] });
var AltanaMark = ({ size = 16 }) => /* @__PURE__ */ jsxs("svg", { "aria-hidden": "true", fill: "none", focusable: "false", height: size, viewBox: "-4.737 -26.701 449.183 449.183", width: size, children: [
  /* @__PURE__ */ jsx("path", { d: "M298.4 361.864L156.979 220.442L298.4 79.0211L383.253 163.874C414.495 195.116 414.495 245.769 383.253 277.011L298.4 361.864Z", fill: "#E2622E" }),
  /* @__PURE__ */ jsx("path", { d: "M141.421 361.45L56.5686 276.597C25.3266 245.355 25.3266 194.702 56.5686 163.46L141.421 78.6075L282.843 220.029L141.421 361.45Z", fill: "#F2CB45" }),
  /* @__PURE__ */ jsx("path", { d: "M163.617 56.7248C194.858 25.4828 245.512 25.4828 276.754 56.7248L361.96 141.931L220.066 283.825L78.2908 142.051L163.617 56.7248Z", fill: "#3665E4" })
] });
var BNB_MARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADgAAAA4CAYAAACohjseAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAeGVYSWZNTQAqAAAACAAEARoABQAAAAEAAAA+ARsABQAAAAEAAABGASgAAwAAAAEAAgAAh2kABAAAAAEAAABOAAAAAAAAASAAAAABAAABIAAAAAEAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAOKADAAQAAAABAAAAOAAAAACY5gKxAAAACXBIWXMAACxLAAAsSwGlPZapAAAOyElEQVRoBcVbCZAU1Rl+r+eenpmd3QU8wKSoEFFzmFQsAVEisrcgsYh4RxBNFDV4lIAEZEEhkiIJopGyjMHSiscWKWMQ2ANESoiLR4yJkhjPeCDCsjtXz9ndL98/u73T09N7spBXtfR7/f73v/9///n+Hhg7gS3S7JsT3xW4SQjGT9S2J2SjI9uCp/vc+nIwdZXkYA5VZ81C0xvLalP7jzejx5XBzrbyMhfL3MYYv8PjZhWpDGOQHvN6GFNVlhZcPJbNiF9VNqQ+P16MHi8GeWRnYK6DiXs9LnZWJsuYphezIGFnYjSTY1/ogq/rdCYeGz+dpYuhjn004gxGm33ncqfU6JRYPYO0smr/RDodjLmcjOU0tl8TrLGsSmnuf8XQZkeMwY6tvrEen7QYTP3U7WJeUkdrI2Y4dszZMA1JM9imwPyzQuf3BasT/7KuH874mBn8eDPzjhrrX8AlvhSMjUuDMR2SMzdDHZU0+1xiTPF52ESoZonaEvM+N9RWZREcxUYt7dgQnhntMuMaav+YGIy2ybUS541up5hMUlG10u2JYKhfWjDxuKSztX7Vm4g507c7JL4IB9LreMwrHTgFOCWyz/dA4H3yXuUZ3sgsVmxe0Xd/WAwmdson6UL8zinxOXTqJA1rI7uiOR0hQbMJCUd2BCd6HPpywFzldDKJHJG1EQ5Sa9jxKxnBfzZqGGqLsxp6S3l9SV3n+6GKBx0ggFTQaHT6fm8+HBzQdH6lPENpsIt3o+vj74VqlGs1zmp1le8jSRMzRqPDyTOXYzGElnYvF53G3FCeJtKGsqwb9uh23zi3my/ljC/AaXvz0syyTsbFho64+6Hxl0ZgSwM30cTciYrAfM7EPVDbr0PqhiNqymp8dWVd4t2BsdhDDMhgtMU3yemQliNW/V11On9dPr2U6GhbaLLEtdXwoEdEVloVujj+H+t23V6WL8NhVArBV9l5ycPb5JMhySUOBz83p+lry6qT26x43t/OPGNcgRth95dkVfGgHYx5TZ8MJnf5xkLFlnLObzBJ599Qy9WhauVZSMviK81oC/08Qc7ADQ5J5L0szcBmI0yHl8zae8nGRibhr8SpRFrkakniq9wuMYUIz3bbfhOMfVWwKnGgsGuhV8KgaGFyTATmS06xFLFprNntmxxHi9D42sCrib19eTexmzkjaX+Dw8mXAc8ks5c1e0nY17qgjAM7j6UKZBX3OnfI38XeS/D2CrNDIpPwwnbhhKLwCRt5hm8MzYp3mFeXOJkY998VCoqHsHZsEomTOaYRkUQc5qo1JurYTGZyC2a06GeZByf7IxA2iXCYQwilbYQLxE0Eg5crXXKZZXXvEEu55OBTILlLAC/1SC0/T3ltT35bFpLFCt2tP9i7sKdTwiByiTAS4SKCCNYNl01/UK9tOU2cG65VlvFzmE2A6MbMa5lSXqdcD/gqVRX76KTJKxpeFkwfUFL8Cqh7feBi5VAPPSUPHKYI1yQezWUc30vl2BNYrxIucyOnRGEGEg2b31O/hEHBS3WfiAJB72Z1fjkImhmuTb5pRtTUxBzRVvmaaKu/wfye+uEaZdenXcmLcCg3Yfg5iIhkMmJlTrjPC9cmnrPacrTNN1nBnfFQy0myGVe4IfphqEqZr2q8NqeKvVIJ5YAWpbTjgIpbpFVeL3vYXUir8o3sDir1D5W5p1VUd0WLoRnrbA1OdXF9lcvFZuS65fkMztI2l1Ra/aeqzCmX1cTet+KhOZ3xJVxiN3rd3JfOird0XTSGapJ/scK+i7ByWljegpAyK92TIJBUIcUXy2qVWWZ4u3Mwz+eDOBiMWJk7uNX3tXhbYJOb6y/hEGYYzggO5UrEwb9GWwOro82hCjMyuSZ50Moc5bLx1sAtQuL7PR72c6ibL5ESDBL6PuzuhfhO/5bObfJ3zHi+NRcWLvghWymaAdEvYRAidZFKFjUhit5EmuWqsCy1e9ziJlxx3MYpktEn6RYhWNjnESskp/YqVPdaUuEifD2DaLNcN3qc/LLbLR7Gq3Fmp0bORENu63byOT4f2xdpCS4w48DFowhnnlnOLNZpwyCuKvvgGDoo3SI3bNfAx9lQiVOIIGLK2shL0hxSuNPhmJ6sL5ebY62+qQYcJH9mvFV+RnKy7Uj1JpEnNHtZA45Q0xxUMci4PsV4b33idkLrU0Jnu6xzsLDiFq5LNB1+wfM3r8+5HAReg6zeYUjIBKnaEWSaz3cpFFDDYVTlVGlapMX/eygfpXK3QpXDKdhPxuYG0r2q8C8dGI6728ILr/MXZTDPYPvb06poHFWffN00ne+WMEhvx8zOfICt50V2yE/BcNcgmykRvRVRf2M6IGiDG85jIecif/vIq3J/iwaaE8ybVfn7UOUV8MZNALfRJRsVNeMN1yu7Dv1XuRB3tyWisdRezbAD9UmViVFSOYpbx9okSXrkaIznQw1w2TJHe5RIULzB/AjgSYOA8fOpEJR42Rjnn9CzvuyzCG4kB7z4gEM18X1W9Ae3Mv8ps1iKkgNjroTB2FH/4uRuXqYyaU1oenFeZyzCVp0kEdJ/c+rUOz+CHcp+XOQvBSvKMc1bEGMhv3wbMrDTOVOKvG2R+88vknjI5+e3c01rj7XK83BXK3LHBBOuVJ5OpvllcOP/JG9bElbMuw+zT5dowo32aVThC8syiTV2qKJt/otDPnmP7OcPYP5UK0wJg5CMrqKCAh38BrKTzUqF3BrbESxy0ZSDwrC3pJO+qbCre0DLkf7CinXT/sYUmcjtg8EkcP82pYrJ2GsTn1UwG1oPmibG2+TnJMZfxAGfkwHNWNvjtws7lDBoTJGLpwTW72EXaVxbb7w3P0fP7ogjN31A5c7J2Sz7g4OXJsJm+IH6pPK4DtFNY6uqi2nAfefouuSXdut0SV8cCLC5dFNB3O6z9cmgsaJncb9+L1wV/ShQrSzATR3xju2hvDBvNwaSAZ6k4qQBpPK41/04UKVcYk3o7VDkIAC7RMMMOyCDZmCj39ninxVpDVxmjI1nsCaxJ+BUqnABvR6p1IeDsc2efPJwWmVLSeVRyviTgc94djUHpnc1y/ON8VCew2IQej8x6GdN8bbSRJhPZypUazMkuWgwyTBJW8WtPjRDWUcqbyb+aIvvNKR1j8h+0YpbxgXmucH2h8Ug1CKHqwzCBJ/j8vC9sdbAmtju4CjzpihpZAdSHwMe+S/Cf6EdbmIBJOmL3JK0Hwn9zSASllkMU4DuvzcsBgklEd9dLhAh2SeWiYz2PJIEuImehvKZ0R3EswjWUyY/DA3ZgGQin9CTIxluGzaDxoaUduUZ5YhB8dKYacAN5YnDG0cJxGAS+oHwDotBMOUyV6G7N+GDuBcMRE7PPGdFuMhZCSGGlfAPi0E4mdcRhD8m1z4YRzJItkrAKN+lPeCVO0DoSyUAg3gxSAZ5URwsb0js0XJ8MphcDwT0OYyOuMiOBrF3vyD0dQmJg4Y9nsxmHFNQa/lj8YLBacyADJKBQ0qjDrUExpg3CNYmDiMc3J3LiQtQj9kGIIkqoWaYYfdxdwTO15Bg12KP68rqYrifFtohFKclLsZ1X4QL7+16AzJIKRts4KyApCP59t/wxqMmTwmM5Q3Jt+QqZSYykHmfvFe4pthtNph3cDBc16QVHR3KhQGUHK1rYs3+2bIkv4LjrKdUcqBWcl2C3pfc9cibuZx8vFtij50xQb62q5k3ltcldpuRV9TFXzGPUYxCUcz8xr5PdkZ7GrPoQ2fie42x8UQmc7bTyVdi+lKy+z6uaSU3n17EBiIUbo4QYVQPNTeSJOyB4ccF01xO0YqPoJtRFpxghjH3HZIehQplKVPpq1FyTWEGX3+P9gUTh2lgr3Vgbi++KF1Kamlljr5REi4g+sqKp4TBMk35TTTJ5iFT+cDOSxKT2MQJhPMcKAvGdvqXHd1eEbIirqhLtQtdn46D2UUOw3xgRBBuKcTcW5msmP22W3nOul7AFMgkuEO0Y6/FCBOB7sSiAEnSJxrx+CqmsMWq7llUmO3uYc6+xXYGK1GvvxNFoluxQYgYs6ZeFJ+IeLjxd9QcbyxrTzzPG4vL51QTrS2Xr5aYWOFx8wm0IW4oX8F5rU/qyqaT8Q3DSkFXS2Ca0yHux43kApIYaY+1kWbg238O+v2EmlXXltenP7HC0LhPBg3gzpbAt10OcS/EfxkFd7u7F/2gB17vcE72TRh9fnHCbOA5uDU4KuDR74a1VWo57f6+CCJ4fAdsD/nZpFhvZcjA0q0JdLBgbrdQpZUhi+0XILt7AzJoLKDSgAO/qICqnUMnak6jSOUw/kLXPGdVNnTGjDXDfUKC+7wucZ75MMmxkNQyWf4B1HVNMKI8xecWZzx2+5XYoB0QvaNPxbGU8sN0jt0BVf0yr/v9HM+RFv8PYrvkeX2V7Y19Ym3+2VTCN8bWJ9kZJRJ4xrIZ9kuR5lPw44UnBsMc4Ro0gwR8KuoiZdXKhqyuT4Jz2ARVyfTlJR0aG+NDTaehQt4R2+krqukQrlhL8AzUVJ72eaU/65ydSe+sjTxjPiSofEsuw85HXFxm/YJrXWMdW4KBddp+XFmb+gwzC+GInsKPBVahDF+NcgM56t6GeK1RIIbdVqso28d3Bh7PpLS1ktebwC8Qb2eSvsjjYOXkuZDlFVVVEOucXg8KgCnxptDEqlCtsrUX8RA7Q5KgFXeoKv5qYK9Sh28M18FdHUjoGqyxuJH3hcf0eFxiodMttUta9jVclMnXllP53uqZqYKOwzkI5pbAJKaFapPDZo4oGZYEzSx0hwXlSRRft3wtgO92No3yWfraBGmOI7OleNZXW4WJW9Len5Rbyhd9wQ/0/pgZNDYg+zT69ISaOZDeFXlbs+c1YCn0kEoa40bItpHZhxoDZijPY1LR/jbSuOMj2OA75G0pblmbUbmGCn+mMv62dX6kxjZbjwxq+i1aTvVMTWfELyCio+awkq9cSywFVd2oxMXk0ZbEfWQo6MbSTyQbuW0Ot4a+6efacpji1UgKHMhBd+B3NivLqko/WI7crv8HTPTfCiItgZvhOU/IwRKL/wN7nvjr2m6GEAAAAABJRU5ErkJggg==";
var NetworkMark = ({ network: network2, size = 14 }) => network2 === "bnb" ? /* @__PURE__ */ jsx(
  "img",
  {
    alt: "",
    "aria-hidden": "true",
    height: size,
    onError: (event) => {
      event.currentTarget.style.display = "none";
    },
    src: BNB_MARK,
    width: size
  }
) : /* @__PURE__ */ jsxs("svg", { "aria-hidden": "true", focusable: "false", height: size, viewBox: "0 0 256 417", width: Math.round(size * 256 / 417), children: [
  /* @__PURE__ */ jsx("path", { d: "M127.96 0l-2.8 9.5v275.67l2.8 2.79 127.96-75.64z", fill: "#627EEA", fillOpacity: ".75" }),
  /* @__PURE__ */ jsx("path", { d: "M127.96 0L0 212.32l127.96 75.64V154.16z", fill: "#627EEA", fillOpacity: ".5" }),
  /* @__PURE__ */ jsx("path", { d: "M127.96 312.19l-1.57 1.92v98.2l1.57 4.6L256 236.59z", fill: "#627EEA", fillOpacity: ".75" }),
  /* @__PURE__ */ jsx("path", { d: "M127.96 416.91V312.19L0 236.59z", fill: "#627EEA", fillOpacity: ".5" }),
  /* @__PURE__ */ jsx("path", { d: "M127.96 287.96l127.96-75.64-127.96-58.16z", fill: "#627EEA" }),
  /* @__PURE__ */ jsx("path", { d: "M0 212.32l127.96 75.64V154.16z", fill: "#627EEA", fillOpacity: ".8" })
] });

// src/ui.tsx
import { CopyButton, Tip } from "@hermes/plugin-sdk";
import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from "react";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var PaneContext = createContext(null);
function usePane() {
  const env = useContext(PaneContext);
  if (!env) throw new Error("PaneContext is missing");
  return env;
}
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      if (mounted.current) setError(errorText(err));
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);
  const clear = useCallback(() => setError(null), []);
  return { busy, error, run, clear };
}
function useRemembered(key, initial) {
  const { store } = usePane();
  const [, rerender] = useReducer((n) => n + 1, 0);
  if (!store.memory.has(key)) store.memory.set(key, initial());
  const value = store.memory.get(key);
  const update = useCallback(
    (next) => {
      const prev = store.memory.get(key);
      store.memory.set(key, typeof next === "function" ? next(prev) : next);
      rerender();
    },
    [store, key]
  );
  return [value, update];
}
function InlineError({ children }) {
  return /* @__PURE__ */ jsxs2("div", { className: "sf-alert", "data-tone": "error", role: "alert", children: [
    /* @__PURE__ */ jsx2(IconAlert, {}),
    /* @__PURE__ */ jsx2("span", { children })
  ] });
}
function Warning({ children }) {
  return /* @__PURE__ */ jsxs2("div", { className: "sf-alert", "data-tone": "warn", children: [
    /* @__PURE__ */ jsx2(IconAlert, {}),
    /* @__PURE__ */ jsx2("span", { children })
  ] });
}
function Num({ value, symbol, strong }) {
  const shown = displayAmount(value);
  const full = symbol ? `${value} ${symbol}` : value;
  return /* @__PURE__ */ jsxs2("span", { className: "sf-amt", "data-strong": strong || void 0, title: shown !== value ? full : void 0, children: [
    /* @__PURE__ */ jsx2("span", { className: "sf-num", children: shown }),
    symbol ? /* @__PURE__ */ jsx2("span", { className: "sf-sym", children: symbol }) : null
  ] });
}
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function ExtLink({ href, children }) {
  const { store } = usePane();
  const [failed, setFailed] = useState(false);
  if (!isWebUrl(href)) return null;
  return /* @__PURE__ */ jsxs2("span", { className: "sf-link-wrap", children: [
    /* @__PURE__ */ jsx2(Tip, { label: hostOf(href), children: /* @__PURE__ */ jsxs2(
      "button",
      {
        className: "sf-link",
        onClick: () => {
          void store.open(href).then((ok) => setFailed(!ok));
        },
        role: "link",
        type: "button",
        children: [
          children,
          /* @__PURE__ */ jsx2(IconExternal, {})
        ]
      }
    ) }),
    failed ? /* @__PURE__ */ jsx2(CopyButton, { appearance: "inline", label: "Copy link", text: href, children: "Copy link" }) : null
  ] });
}
function Hex({ value, copyLabel, fit }) {
  return /* @__PURE__ */ jsxs2("span", { className: "sf-hex", "data-fit": fit || void 0, children: [
    fit ? /* @__PURE__ */ jsxs2("span", { className: "sf-hex-text", title: value, children: [
      /* @__PURE__ */ jsx2("span", { className: "sf-hex-head", children: value.slice(0, -6) }),
      /* @__PURE__ */ jsx2("span", { className: "sf-hex-tail", children: value.slice(-6) })
    ] }) : /* @__PURE__ */ jsx2("span", { className: "sf-hex-text", title: value, children: shortHex(value) }),
    /* @__PURE__ */ jsx2(CopyButton, { appearance: "icon", buttonSize: "icon-xs", label: copyLabel, text: value })
  ] });
}

// src/header.tsx
import { Fragment, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var MODES = [
  { id: "testnet", label: "Testnet" },
  { id: "mainnet", label: "Mainnet" }
];
function Header({ mode, loading, pending, disabled, onSwitch }) {
  const [askMainnet, setAskMainnet] = useState2(false);
  const [error, setError] = useState2(null);
  const shown = pending ?? mode;
  return /* @__PURE__ */ jsxs3(Fragment, { children: [
    /* @__PURE__ */ jsxs3("header", { className: "sf-header", children: [
      /* @__PURE__ */ jsx3(AltanaMark, { size: 18 }),
      /* @__PURE__ */ jsx3("h2", { className: "sf-title", children: "Sovereign Finance" }),
      shown === "mainnet" ? /* @__PURE__ */ jsx3(Badge, { variant: "warn", children: "Real funds" }) : null,
      shown === null ? loading ? /* @__PURE__ */ jsx3(Skeleton, { style: { width: 132, height: 24 } }) : null : /* @__PURE__ */ jsx3(
        SegmentedControl,
        {
          disabled: disabled || pending !== null,
          onChange: (id) => {
            if (id === shown) return;
            setError(null);
            if (id === "mainnet") setAskMainnet(true);
            else void onSwitch("testnet").catch((err) => setError(errorText(err)));
          },
          options: MODES,
          value: shown
        }
      ),
      /* @__PURE__ */ jsx3(
        ConfirmDialog,
        {
          confirmLabel: "Switch to mainnet",
          description: "Mainnet uses real funds.",
          dismissOnConfirm: true,
          onClose: () => setAskMainnet(false),
          onConfirm: () => onSwitch("mainnet"),
          open: askMainnet,
          title: "Switch to mainnet?"
        }
      )
    ] }),
    error ? /* @__PURE__ */ jsx3("div", { className: "sf-strip", children: /* @__PURE__ */ jsx3(InlineError, { children: error }) }) : null
  ] });
}

// src/job-banner.tsx
import { Badge as Badge2, Button, CopyButton as CopyButton2, Loader } from "@hermes/plugin-sdk";

// src/store.ts
import { host } from "@hermes/plugin-sdk";

// src/normalize.ts
var dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
var list = (v) => Array.isArray(v) ? v : [];
function text(v, fallback = "") {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}
function textOrNull(v) {
  const s = text(v).trim();
  return s === "" ? null : s;
}
function int(v, fallback = 0) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
var lines = (v) => list(v).map((item) => text(item).trim()).filter(Boolean);
function amounts(v) {
  const out = [];
  for (const item of list(v)) {
    const d = dict(item);
    const symbol = d ? text(d.symbol).trim() : "";
    if (d && symbol) out.push({ symbol, amount: text(d.amount, "0") });
  }
  return out;
}
function balances(v) {
  const d = dict(v);
  return d ? { native: text(d.native, "0"), tokens: amounts(d.tokens) } : null;
}
function session(v) {
  const d = dict(v);
  if (!d) return null;
  return {
    status: text(d.status).trim().toLowerCase(),
    keyId: text(d.keyId),
    expiry: int(d.expiry),
    scopeText: lines(d.scopeText),
    keystoreKeyUrl: text(d.keystoreKeyUrl),
    grantTxUrl: textOrNull(d.grantTxUrl),
    revokeTxUrl: textOrNull(d.revokeTxUrl)
  };
}
function position(v) {
  const d = dict(v);
  if (!d) return null;
  return {
    tokenId: text(d.tokenId),
    pair: text(d.pair),
    feePct: text(d.feePct),
    inRange: d.inRange === true,
    priceLower: text(d.priceLower),
    priceUpper: text(d.priceUpper),
    priceCurrent: text(d.priceCurrent),
    priceUnit: text(d.priceUnit),
    amounts: amounts(d.amounts),
    unclaimedFees: amounts(d.unclaimedFees),
    mintedAt: textOrNull(d.mintedAt)
  };
}
function network(v) {
  const d = dict(v);
  const key = d ? text(d.key).trim() : "";
  if (!d || !key) return null;
  const name = text(d.name, key);
  return {
    key,
    chainId: int(d.chainId),
    name,
    shortName: text(d.shortName, name),
    nativeSymbol: text(d.nativeSymbol),
    dex: text(d.dex),
    explorerUrl: text(d.explorerUrl),
    addressUrl: textOrNull(d.addressUrl),
    keystoreAccountUrl: textOrNull(d.keystoreAccountUrl),
    asOf: textOrNull(d.asOf),
    error: textOrNull(d.error),
    balances: balances(d.balances),
    session: session(d.session),
    positions: list(d.positions).map(position).filter((p) => p !== null)
  };
}
var JOB_STATUSES = ["running", "waiting_passkey", "done", "error"];
function leg(v) {
  const d = dict(v);
  const key = d ? text(d.network).trim() : "";
  if (!d || !key) return null;
  return {
    network: key,
    status: text(d.status).trim().toLowerCase(),
    txUrl: textOrNull(d.txUrl),
    keystoreKeyUrl: textOrNull(d.keystoreKeyUrl),
    charged: textOrNull(d.charged),
    nativeSymbol: text(d.nativeSymbol),
    error: textOrNull(d.error)
  };
}
function jobResult(v) {
  const d = dict(v);
  if (!d) return null;
  const result = {};
  const address = textOrNull(d.address);
  if (address) result.address = address;
  if (Array.isArray(d.legs)) result.legs = d.legs.map(leg).filter((l) => l !== null);
  const key = textOrNull(d.network);
  if (key) result.network = key;
  if ("txUrl" in d) result.txUrl = textOrNull(d.txUrl);
  return result;
}
function job(v) {
  const d = dict(v);
  if (!d) return null;
  const err = dict(d.error);
  return {
    id: text(d.id),
    kind: text(d.kind).trim(),
    // An unknown status keeps the admin buttons locked, the same as a running job.
    status: JOB_STATUSES.find((s) => s === d.status) ?? "running",
    step: text(d.step),
    passkeyUrl: textOrNull(d.passkeyUrl),
    passkeyPrompt: textOrNull(d.passkeyPrompt),
    result: jobResult(d.result),
    error: err ? { code: text(err.code, "error"), message: text(err.message) } : null,
    startedAt: text(d.startedAt),
    finishedAt: textOrNull(d.finishedAt)
  };
}
function presetNetwork(v) {
  const d = dict(v);
  if (!d) return null;
  const native = dict(d.native) ?? {};
  const tokens = [];
  for (const item of list(d.tokens)) {
    const t = dict(item);
    const symbol = t ? text(t.symbol).trim() : "";
    if (t && symbol) {
      const decimals = int(t.decimals, -1);
      tokens.push({ symbol, decimals: decimals >= 0 ? decimals : null, cap: text(t.cap), checked: t.checked === true });
    }
  }
  return {
    native: { symbol: text(native.symbol), cap: text(native.cap), feeHeadroom: text(native.feeHeadroom) },
    tokens
  };
}
function preset(v) {
  const d = dict(v) ?? {};
  const networks = {};
  for (const [key, value] of Object.entries(dict(d.networks) ?? {})) {
    const parsed = presetNetwork(value);
    if (parsed) networks[key] = parsed;
  }
  return { id: text(d.id, "v3-lp"), title: text(d.title, "V3 LP"), durationDays: int(d.durationDays, 30), networks };
}
function draftNetwork(v) {
  const d = dict(v);
  if (!d) return null;
  const cost = dict(d.cost) ?? {};
  return {
    scopeText: lines(d.scopeText),
    cost: {
      keystoreFee: text(cost.keystoreFee, "0"),
      relayFeeEstimate: text(cost.relayFeeEstimate, "0"),
      total: text(cost.total, "0"),
      nativeSymbol: text(cost.nativeSymbol),
      firstAction: cost.firstAction === true
    },
    balance: text(d.balance, "0"),
    sufficient: d.sufficient !== false,
    approvals: Math.max(1, int(d.approvals, 1))
  };
}
function normalizeDraft(v) {
  const d = dict(v);
  const id = d ? text(d.id) : "";
  if (!d || !id) return null;
  const networks = {};
  for (const [key, value] of Object.entries(dict(d.networks) ?? {})) {
    const parsed = draftNetwork(value);
    if (parsed) networks[key] = parsed;
  }
  return { id, createdAt: text(d.createdAt), durationDays: int(d.durationDays), expiry: int(d.expiry), networks };
}
function normalizeState(v) {
  const d = dict(v);
  if (!d || d.mode !== "mainnet" && d.mode !== "testnet") return null;
  const wallet = dict(d.wallet);
  const address = wallet ? text(wallet.address).trim() : "";
  return {
    mode: d.mode,
    wallet: address ? { address } : null,
    networks: list(d.networks).map(network).filter((n) => n !== null),
    job: job(d.job),
    preset: preset(d.preset),
    draft: normalizeDraft(d.draft),
    otherWallets: list(d.otherWallets).map((w) => {
      const o = dict(w);
      const a = o ? text(o.address).trim() : "";
      return a ? { address: a, setAsideAt: o && typeof o.setAsideAt === "string" ? o.setAsideAt : null } : null;
    }).filter((w) => w !== null)
  };
}

// src/store.ts
var PLUGIN_ID = "sovereign-finance";
var PANE_ID = "main";
var FAST_POLL_MS = 2e3;
var SLOW_POLL_MS = 1e4;
var OPENED_STORAGE_KEY = "openedPasskeyPages";
var OPENED_KEEP_MS = 36e5;
var OPENED_KEEP_COUNT = 16;
function jobIsActive(job2) {
  return job2 != null && (job2.status === "running" || job2.status === "waiting_passkey");
}
function passkeyKey(job2) {
  return `${job2.id}
${job2.passkeyUrl ?? ""}`;
}
function createStore(ctx) {
  const api = createApi(ctx);
  const listeners = /* @__PURE__ */ new Set();
  const probes = /* @__PURE__ */ new Set();
  const memory = /* @__PURE__ */ new Map();
  let snapshot = { state: null, error: null, loading: true, passkeyOpenFailed: null };
  let lastJson = "";
  let inflight = null;
  let epoch = 0;
  let lastStart = 0;
  let pollMs = 0;
  let stopPoll = null;
  const set = (patch) => {
    let changed = false;
    for (const key of Object.keys(patch)) {
      if (snapshot[key] !== patch[key]) changed = true;
    }
    if (!changed) return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const documentVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
  const isActive = () => probes.size > 0 && documentVisible();
  const onScreen = () => {
    for (const probe of probes) {
      try {
        if (probe()) return true;
      } catch {
        return true;
      }
    }
    return false;
  };
  const readOpened = () => {
    const cutoff = Date.now() - OPENED_KEEP_MS;
    try {
      const stored = ctx.storage.get(OPENED_STORAGE_KEY, []);
      if (!Array.isArray(stored)) return [];
      return stored.filter(
        (e) => e !== null && typeof e === "object" && typeof e.k === "string" && typeof e.t === "number" && e.t > cutoff
      );
    } catch {
      return [];
    }
  };
  const openedThisLoad = /* @__PURE__ */ new Set();
  const wasOpened = (key) => openedThisLoad.has(key) || readOpened().some((e) => e.k === key);
  const rememberOpened = (key) => {
    openedThisLoad.add(key);
    try {
      const next = [...readOpened().filter((e) => e.k !== key), { k: key, t: Date.now() }];
      ctx.storage.set(OPENED_STORAGE_KEY, next.slice(-OPENED_KEEP_COUNT));
    } catch {
    }
  };
  const open = async (url) => {
    if (!isWebUrl(url)) return false;
    try {
      return await ctx.os.openExternal(url) !== false;
    } catch {
      return false;
    }
  };
  const openPasskeyFor = async (job2) => {
    const key = passkeyKey(job2);
    const ok = await open(job2.passkeyUrl);
    const current = snapshot.state?.job;
    if (current && passkeyKey(current) === key) set({ passkeyOpenFailed: ok ? null : key });
    return ok;
  };
  const maybeOpenPasskey = () => {
    const job2 = snapshot.state?.job;
    if (!job2 || job2.status !== "waiting_passkey" || !job2.passkeyUrl) {
      if (snapshot.passkeyOpenFailed !== null) set({ passkeyOpenFailed: null });
      return;
    }
    if (!isActive()) return;
    const key = passkeyKey(job2);
    if (wasOpened(key) || !isLoopbackUrl(job2.passkeyUrl)) return;
    rememberOpened(key);
    void openPasskeyFor(job2);
  };
  const syncPolling = () => {
    const want = isActive() ? jobIsActive(snapshot.state?.job) ? FAST_POLL_MS : SLOW_POLL_MS : 0;
    if (want === pollMs) return;
    stopPoll?.();
    stopPoll = null;
    pollMs = want;
    if (want > 0) {
      stopPoll = ctx.setInterval(() => {
        if (isActive() && (snapshot.state === null || onScreen())) void refresh();
      }, want);
    }
  };
  const refresh = () => {
    if (inflight) return inflight;
    const startedIn = epoch;
    lastStart = Date.now();
    const run = (async () => {
      try {
        const data = await api.get("/state", SLOW_TIMEOUT_MS);
        if (startedIn !== epoch) return;
        const state = normalizeState(data);
        if (!state) throw new ApiError("bad_response", "The backend sent a state the pane cannot read.");
        const json = JSON.stringify(state);
        const unchanged = json === lastJson && snapshot.state !== null;
        lastJson = json;
        set({ state: unchanged ? snapshot.state : state, error: null, loading: false });
      } catch (err) {
        if (startedIn !== epoch) return;
        set({ error: toApiError(err), loading: false });
      }
    })();
    inflight = run.finally(() => {
      inflight = null;
      if (startedIn !== epoch) {
        void refresh();
        return;
      }
      maybeOpenPasskey();
      syncPolling();
    });
    return inflight;
  };
  const fresh = async () => {
    epoch += 1;
    if (inflight) await inflight;
    await (inflight ?? refresh());
  };
  const post = async (path, body, timeoutMs) => {
    let result;
    try {
      result = await api.post(path, body, timeoutMs);
    } catch (err) {
      void fresh();
      throw err;
    }
    await fresh();
    return result;
  };
  const onActivityChange = () => {
    syncPolling();
    if (!isActive()) return;
    if (Date.now() - lastStart > 1e3) void refresh();
    else maybeOpenPasskey();
  };
  try {
    const visibility = typeof host.paneVisibility === "function" ? host.paneVisibility(`${PLUGIN_ID}:${PANE_ID}`) : null;
    if (visibility) {
      ctx.onDispose(visibility.listen(() => onActivityChange()));
    }
  } catch {
  }
  if (typeof document !== "undefined") ctx.addEventListener(document, "visibilitychange", onActivityChange);
  ctx.onDispose(() => {
    stopPoll?.();
    stopPoll = null;
    pollMs = 0;
    probes.clear();
    listeners.clear();
  });
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    attach: (probe) => {
      probes.add(probe);
      onActivityChange();
      return () => {
        probes.delete(probe);
        syncPolling();
      };
    },
    refresh,
    post,
    open,
    reopenPasskey: async () => {
      const job2 = snapshot.state?.job;
      if (!job2 || !job2.passkeyUrl) return false;
      rememberOpened(passkeyKey(job2));
      return openPasskeyFor(job2);
    },
    memory
  };
}

// src/job-banner.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var DONE_TITLE = {
  create: "Wallet created",
  recover: "Wallet recovered",
  revoke: "Session revoked",
  withdraw: "Withdrawal sent"
};
var ERROR_TITLE = {
  create: "Wallet creation failed",
  recover: "Recovery failed",
  activate: "Activation failed",
  revoke: "Revoke failed",
  withdraw: "Withdrawal failed"
};
var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function activationSummary(legs) {
  const confirmed = legs.filter((leg2) => leg2.status === "confirmed").length;
  if (legs.length === 0) return { title: "Activation finished", tone: "done" };
  if (confirmed === legs.length) return { title: `Activated on ${plural(confirmed, "network")}`, tone: "done" };
  if (confirmed === 0) return { title: `Activation failed on ${plural(legs.length, "network")}`, tone: "error" };
  return { title: `Activated on ${confirmed} of ${legs.length} networks`, tone: "partial" };
}
function hostOf2(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
var RUNNING_TITLE = {
  create: "Creating the wallet",
  recover: "Recovering the wallet",
  activate: "Activating",
  revoke: "Revoking",
  withdraw: "Sending"
};
function JobBanner({ job: job2, networks, openFailed }) {
  const { store } = usePane();
  const cancel = useAction();
  const dismiss = useAction();
  const reopen = useAction();
  const nameOf = (key) => networks.find((n) => n.key === key)?.name ?? key;
  const dismissButton = /* @__PURE__ */ jsx4(
    Button,
    {
      loading: dismiss.busy,
      onClick: () => void dismiss.run(() => store.post("/job/dismiss", {})),
      size: "sm",
      type: "button",
      variant: "outline",
      children: "Dismiss"
    }
  );
  if (job2.status === "waiting_passkey") {
    const url = job2.passkeyUrl;
    const local = isLoopbackUrl(url);
    const failed = openFailed !== null && openFailed === passkeyKey(job2);
    return /* @__PURE__ */ jsxs4("section", { "aria-live": "polite", className: "sf-job", "data-tone": "wait", children: [
      /* @__PURE__ */ jsx4("span", { className: "sf-job-icon", children: /* @__PURE__ */ jsx4("span", { className: "sf-pulse" }) }),
      /* @__PURE__ */ jsxs4("div", { className: "sf-job-main", children: [
        /* @__PURE__ */ jsx4("div", { className: "sf-job-title", children: "Approve with your passkey in the browser" }),
        job2.passkeyPrompt ? /* @__PURE__ */ jsx4("div", { className: "sf-job-detail", children: job2.passkeyPrompt }) : null,
        url && !local ? /* @__PURE__ */ jsxs4("div", { className: "sf-job-detail", children: [
          "The approval page is on ",
          hostOf2(url),
          "."
        ] }) : null,
        /* @__PURE__ */ jsxs4("div", { className: "sf-job-actions", children: [
          url ? /* @__PURE__ */ jsx4(
            Button,
            {
              loading: reopen.busy,
              onClick: () => void reopen.run(() => store.reopenPasskey()),
              size: "sm",
              type: "button",
              children: local ? "Reopen" : "Open approval page"
            }
          ) : null,
          /* @__PURE__ */ jsx4(
            Button,
            {
              loading: cancel.busy,
              onClick: () => void cancel.run(() => store.post("/job/cancel", {})),
              size: "sm",
              type: "button",
              variant: "ghost",
              children: "Cancel"
            }
          )
        ] }),
        failed && url ? /* @__PURE__ */ jsxs4("div", { className: "sf-job-fallback", children: [
          /* @__PURE__ */ jsx4("span", { children: "The browser did not open. Copy the link and open it yourself." }),
          /* @__PURE__ */ jsxs4("span", { className: "sf-job-url", children: [
            /* @__PURE__ */ jsx4("code", { children: url }),
            /* @__PURE__ */ jsx4(CopyButton2, { appearance: "icon", buttonSize: "icon-xs", label: "Copy link", text: url })
          ] })
        ] }) : null,
        cancel.error ? /* @__PURE__ */ jsx4(InlineError, { children: cancel.error }) : null
      ] })
    ] });
  }
  if (job2.status === "running") {
    const staged = /step (\d+) of (\d+)/i.exec(job2.step ?? "");
    const at = staged ? Number(staged[1]) : 0;
    const of = staged ? Number(staged[2]) : 0;
    return /* @__PURE__ */ jsxs4("section", { "aria-live": "polite", className: "sf-job sf-job-busy", "data-tone": "run", children: [
      /* @__PURE__ */ jsx4("span", { className: "sf-job-icon", children: /* @__PURE__ */ jsx4(Loader, { label: "Working", style: { width: 18, height: 18 } }) }),
      /* @__PURE__ */ jsxs4("div", { className: "sf-job-main", children: [
        /* @__PURE__ */ jsx4("div", { className: "sf-job-title", children: RUNNING_TITLE[job2.kind] ?? "Working" }),
        /* @__PURE__ */ jsx4("div", { className: "sf-job-step", children: job2.step || "Working" }),
        of > 1 ? /* @__PURE__ */ jsx4("div", { "aria-hidden": "true", className: "sf-job-dots", children: Array.from({ length: of }, (_, i) => /* @__PURE__ */ jsx4("span", { "data-state": i + 1 < at ? "done" : i + 1 === at ? "now" : "next" }, i)) }) : null,
        /* @__PURE__ */ jsx4("div", { className: "sf-job-bar" }),
        /* @__PURE__ */ jsx4("div", { className: "sf-job-detail", children: job2.kind === "activate" ? "Keep the browser tab open. It asks for each approval in turn, and this can take a minute or two." : "Waiting for the network to confirm." })
      ] })
    ] });
  }
  if (job2.status === "error") {
    return /* @__PURE__ */ jsxs4("section", { "aria-live": "polite", className: "sf-job", "data-tone": "error", children: [
      /* @__PURE__ */ jsx4("span", { className: "sf-job-icon", children: /* @__PURE__ */ jsx4(IconAlert, { height: 16, width: 16 }) }),
      /* @__PURE__ */ jsxs4("div", { className: "sf-job-main", children: [
        /* @__PURE__ */ jsx4("div", { className: "sf-job-title", children: ERROR_TITLE[job2.kind] ?? "The request failed" }),
        /* @__PURE__ */ jsx4("div", { className: "sf-job-detail", children: job2.error?.message || job2.error?.code || job2.step || "No reason was given." }),
        /* @__PURE__ */ jsx4("div", { className: "sf-job-actions", children: dismissButton }),
        dismiss.error ? /* @__PURE__ */ jsx4(InlineError, { children: dismiss.error }) : null
      ] })
    ] });
  }
  const result = job2.result;
  const legs = result?.legs ?? [];
  const summary = job2.kind === "activate" ? activationSummary(legs) : { title: DONE_TITLE[job2.kind] ?? "Done", tone: "done" };
  return /* @__PURE__ */ jsxs4("section", { "aria-live": "polite", className: "sf-job", "data-tone": summary.tone, children: [
    /* @__PURE__ */ jsx4("span", { className: "sf-job-icon", children: summary.tone === "done" ? /* @__PURE__ */ jsx4(IconCheck, { height: 16, width: 16 }) : /* @__PURE__ */ jsx4(IconAlert, { height: 16, width: 16 }) }),
    /* @__PURE__ */ jsxs4("div", { className: "sf-job-main", children: [
      /* @__PURE__ */ jsx4("div", { className: "sf-job-title", children: summary.title }),
      result?.address ? /* @__PURE__ */ jsx4("div", { className: "sf-job-detail", children: /* @__PURE__ */ jsx4(Hex, { copyLabel: "Copy address", fit: true, value: result.address }) }) : null,
      legs.length > 0 ? /* @__PURE__ */ jsx4("ul", { className: "sf-legs", children: legs.map((leg2) => /* @__PURE__ */ jsxs4("li", { className: "sf-leg", children: [
        /* @__PURE__ */ jsx4("span", { className: "sf-leg-name", children: nameOf(leg2.network) }),
        /* @__PURE__ */ jsx4(Badge2, { variant: leg2.status === "confirmed" ? "success" : "destructive", children: leg2.status === "confirmed" ? "Confirmed" : leg2.status === "failed" ? "Failed" : leg2.status }),
        leg2.charged ? /* @__PURE__ */ jsxs4("span", { className: "sf-leg-charged", children: [
          /* @__PURE__ */ jsx4("span", { className: "sf-dim", children: "Charged" }),
          " ",
          /* @__PURE__ */ jsx4(Num, { symbol: leg2.nativeSymbol, value: leg2.charged })
        ] }) : null,
        /* @__PURE__ */ jsxs4("span", { className: "sf-links", children: [
          /* @__PURE__ */ jsx4(ExtLink, { href: leg2.txUrl, children: "Transaction" }),
          /* @__PURE__ */ jsx4(ExtLink, { href: leg2.keystoreKeyUrl, children: "Keystore" })
        ] }),
        leg2.error ? /* @__PURE__ */ jsx4("span", { className: "sf-leg-error", children: leg2.error }) : null
      ] }, leg2.network)) }) : null,
      result?.network && legs.length === 0 ? /* @__PURE__ */ jsxs4("div", { className: "sf-job-detail sf-leg-inline", children: [
        /* @__PURE__ */ jsx4("span", { children: nameOf(result.network) }),
        /* @__PURE__ */ jsx4(ExtLink, { href: result.txUrl, children: "Transaction" })
      ] }) : null,
      /* @__PURE__ */ jsx4("div", { className: "sf-job-actions", children: dismissButton }),
      dismiss.error ? /* @__PURE__ */ jsx4(InlineError, { children: dismiss.error }) : null
    ] })
  ] });
}

// src/live.tsx
import { Badge as Badge3, Button as Button3, ConfirmDialog as ConfirmDialog2, StatusDot } from "@hermes/plugin-sdk";
import { useState as useState4 } from "react";

// src/plays-view.tsx
import { Button as Button2, host as host2, Input } from "@hermes/plugin-sdk";
import { useId, useState as useState3 } from "react";

// src/plays.ts
var PLAYS = [
  {
    id: "find",
    when: "both",
    title: "Find a pool",
    blurb: "Ranks the most traded pools by fee income and suggests one.",
    actions: [
      {
        label: "Ask",
        request: (c) => `List the most traded V3 pools on ${c.network} with their fee APR, and tell me which one you would pick for a small position and why.`
      }
    ]
  },
  {
    id: "open",
    when: "both",
    title: "Open a position",
    blurb: "Wraps, swaps half and provides liquidity around the current price, in one batch.",
    sized: true,
    actions: [
      {
        label: "Ask",
        request: (c) => `Open a liquidity position in the ${c.pair} pool on ${c.network} with ${c.amount} ${c.native}, ${c.rangePct}% either side of the price.`
      }
    ]
  },
  {
    id: "keep",
    when: "holding",
    title: "Keep it in range",
    blurb: "Closes a position the price has left and reopens it around the current price.",
    actions: [
      {
        label: "Now",
        request: (c) => `Check my positions on ${c.network}. Close any that is out of range and reopen it around the current price.`
      },
      {
        label: "Every 30 min",
        request: (c) => `Set up a scheduled job that runs every 30 minutes with the sovereign-finance:v3-range skill: check my positions on ${c.network}, close any that is out of range and reopen it around the current price, otherwise answer with one line of status.`
      }
    ]
  },
  {
    id: "compound",
    when: "holding",
    title: "Compound fees",
    blurb: "Collects the fees a position has earned and adds them back to it.",
    actions: [
      { label: "Ask", request: (c) => `Collect the fees my positions on ${c.network} have earned and add them back to the same positions.` }
    ]
  },
  {
    id: "exit",
    when: "holding",
    title: "Cash out",
    blurb: "Closes every position and swaps everything back to the native coin.",
    actions: [
      { label: "Ask", request: (c) => `Close all my positions on ${c.network} and swap everything back to ${c.native}.` }
    ]
  }
];
var STABLES = ["USDT", "USDC", "BUSD"];
function defaultsFor(network2) {
  const symbols = (network2.balances?.tokens ?? []).map((t) => t.symbol);
  const wrapped = symbols.find((s) => s === "WBNB" || s === "WETH") ?? (network2.key === "bnb" ? "WBNB" : "WETH");
  const stable = STABLES.find((s) => symbols.includes(s)) ?? (network2.key === "bnb" ? "USDT" : "USDC");
  return { pair: `${stable}/${wrapped}`, amount: network2.key === "bnb" ? "0.002" : "0.001", rangePct: "3" };
}

// src/plays-view.tsx
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
async function hand(text2) {
  const composer = host2.composer;
  try {
    if (composer && typeof composer.setDraft === "function") {
      for (const target of [null, "new"]) {
        if (await composer.setDraft(target, text2)) {
          composer.focus?.(target);
          return "chat";
        }
      }
    }
  } catch {
  }
  try {
    await navigator.clipboard.writeText(text2);
    return "copied";
  } catch {
    return "failed";
  }
}
var NOTE = {
  chat: "Written into the chat box. Press Enter to send it.",
  copied: "Copied. Paste it into a chat and send it.",
  failed: "Open a chat first, then press the button again."
};
function Plays({ network: network2, stage }) {
  const uid = useId();
  const defaults = defaultsFor(network2);
  const [amount, setAmount] = useState3(defaults.amount);
  const [rangePct, setRangePct] = useState3(defaults.rangePct);
  const [note, setNote] = useState3(null);
  const context = {
    network: network2.key,
    networkName: network2.name,
    native: network2.nativeSymbol,
    pair: defaults.pair,
    amount: amount.trim() || defaults.amount,
    rangePct: rangePct.trim() || defaults.rangePct
  };
  const run = async (play, request) => {
    setNote({ id: play.id, kind: await hand(request(context)) });
  };
  return /* @__PURE__ */ jsxs5("section", { className: "sf-plays", "data-stage": stage, children: [
    /* @__PURE__ */ jsxs5("div", { className: "sf-plays-head", children: [
      /* @__PURE__ */ jsx5("h4", { className: "sf-section", children: stage === "start" ? "Next: put the agent to work" : "Ask the agent" }),
      /* @__PURE__ */ jsx5("span", { className: "sf-hint", children: "A button writes the request into the chat box. You send it." })
    ] }),
    /* @__PURE__ */ jsx5("ul", { className: "sf-play-list", children: PLAYS.filter((play) => play.when === "both" || play.when === stage).map((play) => /* @__PURE__ */ jsxs5("li", { className: "sf-play", children: [
      /* @__PURE__ */ jsxs5("div", { className: "sf-play-text", children: [
        /* @__PURE__ */ jsx5("span", { className: "sf-play-title", children: play.title }),
        /* @__PURE__ */ jsx5("span", { className: "sf-play-blurb", children: play.blurb }),
        play.sized ? /* @__PURE__ */ jsxs5("span", { className: "sf-play-fields", children: [
          /* @__PURE__ */ jsx5("label", { className: "sf-play-field", htmlFor: `${uid}-amount`, children: /* @__PURE__ */ jsx5(
            Input,
            {
              className: "sf-num-input",
              id: `${uid}-amount`,
              inputMode: "decimal",
              onChange: (e) => setAmount(e.target.value),
              suffix: network2.nativeSymbol,
              value: amount
            }
          ) }),
          /* @__PURE__ */ jsx5("label", { className: "sf-play-field", htmlFor: `${uid}-range`, children: /* @__PURE__ */ jsx5(
            Input,
            {
              className: "sf-num-input",
              id: `${uid}-range`,
              inputMode: "decimal",
              onChange: (e) => setRangePct(e.target.value),
              suffix: "% range",
              value: rangePct
            }
          ) }),
          /* @__PURE__ */ jsx5("span", { className: "sf-hint", children: defaults.pair })
        ] }) : null,
        note?.id === play.id ? /* @__PURE__ */ jsx5("span", { className: "sf-play-note", children: NOTE[note.kind] }) : null
      ] }),
      /* @__PURE__ */ jsx5("div", { className: "sf-play-actions", children: play.actions.map((action) => /* @__PURE__ */ jsx5(
        Button2,
        {
          onClick: () => void run(play, action.request),
          size: "sm",
          type: "button",
          variant: stage === "start" && play.id === "open" ? "default" : "outline",
          children: action.label
        },
        action.label
      )) })
    ] }, play.id)) })
  ] });
}

// src/live.tsx
import { jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
var STATUS = {
  active: { label: "Active", tone: "good" },
  expired: { label: "Expired", tone: "warn" },
  revoked: { label: "Revoked", tone: "muted" }
};
function statusOf(session2) {
  return STATUS[session2.status] ?? { label: session2.status || "Unknown", tone: "muted" };
}
function RangeBar({ position: position2, at }) {
  if (at === null) return null;
  const inside = at >= 0 && at <= 1;
  const left = inside ? 14 + at * 72 : at < 0 ? 5 : 95;
  const where = inside ? "inside" : at < 0 ? "below" : "above";
  return /* @__PURE__ */ jsxs6(
    "div",
    {
      "aria-label": `Current price ${position2.priceCurrent} is ${where} the range ${position2.priceLower} to ${position2.priceUpper} ${position2.priceUnit}`,
      className: "sf-range",
      "data-in": inside || void 0,
      role: "img",
      children: [
        /* @__PURE__ */ jsx6("span", { className: "sf-range-band" }),
        /* @__PURE__ */ jsx6("span", { className: "sf-range-mark", style: { left: `${left}%` } })
      ]
    }
  );
}
function Ledger({ rows }) {
  const columns = Math.max(1, ...rows.map((row) => row.items.length));
  return /* @__PURE__ */ jsx6("dl", { className: "sf-ledger", style: { gridTemplateColumns: `minmax(0,1fr) repeat(${columns},minmax(0,auto))` }, children: rows.map((row) => /* @__PURE__ */ jsxs6("div", { children: [
    /* @__PURE__ */ jsx6("dt", { children: row.label }),
    Array.from({ length: columns }, (_, i) => {
      const item = row.items[i];
      return /* @__PURE__ */ jsx6("dd", { children: item ? /* @__PURE__ */ jsx6(Num, { symbol: item.symbol, value: item.amount }) : null }, i);
    })
  ] }, row.label)) });
}
function PositionBlock({ position: position2, dex }) {
  const minted = parseTime(position2.mintedAt);
  const at = rangePosition(position2.priceLower, position2.priceUpper, position2.priceCurrent);
  const order = at !== null && at < 0 ? ["current", "lower", "upper"] : at !== null && at > 1 ? ["lower", "upper", "current"] : ["lower", "current", "upper"];
  return /* @__PURE__ */ jsxs6("li", { className: "sf-pos", children: [
    /* @__PURE__ */ jsxs6("div", { className: "sf-pos-head", children: [
      /* @__PURE__ */ jsx6("span", { className: "sf-pos-pair", children: position2.pair }),
      position2.feePct ? /* @__PURE__ */ jsxs6("span", { className: "sf-pos-fee", children: [
        position2.feePct,
        "%"
      ] }) : null,
      /* @__PURE__ */ jsx6(Badge3, { variant: position2.inRange ? "success" : "warn", children: position2.inRange ? "In range" : "Out of range" })
    ] }),
    /* @__PURE__ */ jsx6(RangeBar, { at, position: position2 }),
    /* @__PURE__ */ jsx6("div", { className: "sf-pos-prices", children: order.map(
      (cell) => cell === "current" ? /* @__PURE__ */ jsxs6("span", { className: "sf-pos-current", children: [
        /* @__PURE__ */ jsx6("span", { className: "sf-num", "data-strong": "true", children: position2.priceCurrent }),
        /* @__PURE__ */ jsx6("span", { className: "sf-dim", children: position2.priceUnit })
      ] }, cell) : /* @__PURE__ */ jsx6("span", { className: "sf-num", children: cell === "lower" ? position2.priceLower : position2.priceUpper }, cell)
    ) }),
    /* @__PURE__ */ jsx6(
      Ledger,
      {
        rows: [
          { label: "Amounts", items: position2.amounts },
          { label: "Unclaimed fees", items: position2.unclaimedFees }
        ]
      }
    ),
    /* @__PURE__ */ jsxs6("div", { className: "sf-pos-foot sf-dim", children: [
      dex ? /* @__PURE__ */ jsx6("span", { children: dex }) : null,
      position2.tokenId ? /* @__PURE__ */ jsxs6("span", { className: "sf-mono", children: [
        "#",
        position2.tokenId
      ] }) : null,
      minted !== null ? /* @__PURE__ */ jsxs6("span", { children: [
        "since ",
        formatDate(minted)
      ] }) : null
    ] })
  ] });
}
function SessionCard({ network: network2, session: session2 }) {
  const { store, now, locked } = usePane();
  const [confirming, setConfirming] = useState4(false);
  const status = statusOf(session2);
  const expiry = session2.expiry > 0 ? session2.expiry * 1e3 : null;
  const asOf = parseTime(network2.asOf);
  const canRevoke = session2.status !== "revoked" && session2.status !== "expired";
  const holding = network2.positions.length > 0;
  return /* @__PURE__ */ jsxs6("li", { className: "sf-card", "data-net": network2.key, "data-status": session2.status, children: [
    /* @__PURE__ */ jsxs6("div", { className: "sf-card-head", children: [
      /* @__PURE__ */ jsxs6("span", { className: "sf-card-net", children: [
        /* @__PURE__ */ jsx6(NetworkMark, { network: network2.key }),
        network2.name
      ] }),
      /* @__PURE__ */ jsxs6("span", { className: "sf-card-status", children: [
        /* @__PURE__ */ jsx6(StatusDot, { tone: status.tone }),
        status.label
      ] }),
      canRevoke ? /* @__PURE__ */ jsx6(Button3, { disabled: locked, onClick: () => setConfirming(true), size: "xs", type: "button", variant: "outline", children: "Revoke" }) : null
    ] }),
    network2.error ? /* @__PURE__ */ jsxs6(Warning, { children: [
      "Chain read failed. Showing the last good read",
      asOf !== null ? ` (${timeAgo(asOf, now)})` : "",
      "."
    ] }) : null,
    session2.status === "revoked" || session2.status === "expired" ? /* @__PURE__ */ jsxs6("p", { className: "sf-dim", children: [
      "The agent cannot act on ",
      network2.name,
      " until new permissions are activated."
    ] }) : null,
    expiry !== null && session2.status !== "revoked" ? /* @__PURE__ */ jsxs6("div", { className: "sf-card-expiry", children: [
      /* @__PURE__ */ jsxs6("span", { children: [
        expiry <= now ? "Expired" : "Expires",
        " ",
        formatDateTime(expiry)
      ] }),
      /* @__PURE__ */ jsx6("span", { className: "sf-dim", children: relativeTime(expiry, now) })
    ] }) : null,
    holding === false && session2.status === "active" ? /* @__PURE__ */ jsx6(Plays, { network: network2, stage: "start" }) : null,
    network2.positions.length > 0 ? /* @__PURE__ */ jsx6("h4", { className: "sf-section", children: "Positions" }) : null,
    network2.positions.length > 0 ? /* @__PURE__ */ jsx6("ul", { className: "sf-positions", children: network2.positions.map((position2) => /* @__PURE__ */ jsx6(PositionBlock, { dex: network2.dex, position: position2 }, position2.tokenId || position2.pair)) }) : null,
    holding && session2.status === "active" ? /* @__PURE__ */ jsx6(Plays, { network: network2, stage: "holding" }) : null,
    session2.scopeText.length > 0 ? /* @__PURE__ */ jsxs6("details", { className: "sf-more", open: session2.status !== "active" || void 0, children: [
      /* @__PURE__ */ jsx6("summary", { children: "What the agent may do" }),
      /* @__PURE__ */ jsx6("ul", { className: "sf-scope", children: session2.scopeText.map((line, i) => /* @__PURE__ */ jsx6("li", { children: line }, i)) })
    ] }) : null,
    /* @__PURE__ */ jsxs6("div", { className: "sf-card-foot", children: [
      session2.keyId ? /* @__PURE__ */ jsxs6("span", { className: "sf-card-key", children: [
        /* @__PURE__ */ jsx6("span", { className: "sf-dim", children: "Session key" }),
        /* @__PURE__ */ jsx6(Hex, { copyLabel: "Copy session key id", value: session2.keyId })
      ] }) : null,
      /* @__PURE__ */ jsxs6("span", { className: "sf-links", children: [
        /* @__PURE__ */ jsx6(ExtLink, { href: session2.keystoreKeyUrl, children: "Verify in Keystore" }),
        /* @__PURE__ */ jsx6(ExtLink, { href: session2.grantTxUrl, children: "Grant transaction" }),
        /* @__PURE__ */ jsx6(ExtLink, { href: session2.revokeTxUrl, children: "Revoke transaction" })
      ] })
    ] }),
    /* @__PURE__ */ jsx6(
      ConfirmDialog2,
      {
        confirmLabel: "Revoke",
        description: `The agent's session key stops working on ${network2.name}. This needs one passkey approval.`,
        destructive: true,
        dismissOnConfirm: true,
        onClose: () => setConfirming(false),
        onConfirm: async () => {
          await store.post("/revoke", { network: network2.key });
        },
        open: confirming,
        title: `Revoke the session on ${network2.name}?`
      }
    )
  ] });
}
function LiveSection({ networks }) {
  const live = networks.filter((n) => n.session !== null);
  if (live.length === 0) return null;
  return /* @__PURE__ */ jsxs6("section", { className: "sf-live", children: [
    /* @__PURE__ */ jsx6("h3", { className: "sf-section-title", children: "Agent sessions" }),
    /* @__PURE__ */ jsx6("ul", { className: "sf-cards", children: live.map((n) => n.session ? /* @__PURE__ */ jsx6(SessionCard, { network: n, session: n.session }, n.key) : null) })
  ] });
}

// src/permissions.tsx
import { Badge as Badge4, Button as Button4, Checkbox, ConfirmDialog as ConfirmDialog3, Input as Input2, SegmentedControl as SegmentedControl2 } from "@hermes/plugin-sdk";
import { useId as useId2, useState as useState5 } from "react";
import { Fragment as Fragment2, jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
var tokenId = (key, symbol) => `${key}/${symbol}`;
function initialForm(preset2, draft) {
  const form = { days: String(draft?.durationDays || preset2.durationDays), caps: {}, tokens: {} };
  for (const [key, net] of Object.entries(preset2.networks)) {
    if (!net) continue;
    form.caps[key] = net.native.cap;
    for (const token of net.tokens) form.tokens[tokenId(key, token.symbol)] = { checked: token.checked, cap: token.cap };
  }
  return form;
}
function tidyDecimal(value) {
  let v = value.trim();
  if (v.startsWith(".")) v = "0" + v;
  if (v.endsWith(".")) v = v.slice(0, -1);
  return v;
}
function checkForm(form, preset2, keys) {
  const errors = {};
  const networks = {};
  const days = form.days.trim();
  if (!/^\d+$/.test(days) || Number(days) < 1) errors.days = "Enter a whole number of days.";
  for (const key of keys) {
    const net = preset2.networks[key];
    if (!net) continue;
    const cap = form.caps[key] ?? "";
    if (!isDecimal(cap)) errors[`cap:${key}`] = "Enter an amount.";
    const tokens = [];
    for (const token of net.tokens) {
      const id = tokenId(key, token.symbol);
      const field = form.tokens[id];
      if (!field?.checked) continue;
      if (!isPositive(field.cap)) errors[`tok:${id}`] = "Enter an amount above 0, or untick.";
      else if (token.decimals !== null && fractionDigits(field.cap) > token.decimals) {
        errors[`tok:${id}`] = `${token.symbol} has ${token.decimals} decimals.`;
      }
      tokens.push({ symbol: token.symbol, cap: tidyDecimal(field.cap) });
    }
    networks[key] = { nativeCap: tidyDecimal(cap), tokens };
  }
  const valid = Object.keys(errors).length === 0;
  const request = valid ? { durationDays: Number(days), networks } : null;
  return { errors, request };
}
function FieldError({ id, children }) {
  return /* @__PURE__ */ jsx7("span", { className: "sf-field-error", id, role: "alert", children });
}
function ScopeLists({ draft, networks }) {
  const { now } = usePane();
  const created = parseTime(draft.createdAt);
  const known = networks.filter((n) => draft.networks[n.key]);
  return /* @__PURE__ */ jsxs7("div", { className: "sf-review", children: [
    /* @__PURE__ */ jsxs7("div", { className: "sf-review-head", children: [
      /* @__PURE__ */ jsx7("span", { className: "sf-strong", children: "Reviewed permissions" }),
      created !== null ? /* @__PURE__ */ jsx7("span", { className: "sf-dim", children: timeAgo(created, now) }) : null
    ] }),
    known.map((n) => /* @__PURE__ */ jsxs7("div", { className: "sf-review-net", children: [
      /* @__PURE__ */ jsx7("div", { className: "sf-review-name", children: n.name }),
      /* @__PURE__ */ jsx7("ul", { className: "sf-scope", children: (draft.networks[n.key]?.scopeText ?? []).map((line, i) => /* @__PURE__ */ jsx7("li", { children: line }, i)) })
    ] }, n.key)),
    /* @__PURE__ */ jsxs7("div", { className: "sf-dim", children: [
      draft.durationDays > 0 ? `${draft.durationDays} ${draft.durationDays === 1 ? "day" : "days"}` : null,
      draft.durationDays > 0 && draft.expiry > 0 ? ", " : null,
      draft.expiry > 0 ? `until ${formatDate(draft.expiry * 1e3)}` : null
    ] })
  ] });
}
function PermissionsStep({ state, draft, onDraft }) {
  const { store, locked } = usePane();
  const { preset: preset2, mode } = state;
  const uid = useId2();
  const keys = [
    ...state.networks.map((n) => n.key).filter((key) => preset2.networks[key]),
    ...Object.keys(preset2.networks).filter((key) => !state.networks.some((n) => n.key === key))
  ];
  const [form, setForm] = useRemembered(`form:${mode}:${preset2.id}`, () => initialForm(preset2, draft));
  const [attempted, setAttempted] = useState5(false);
  const review = useAction();
  const reviewedKey = `reviewed:${mode}`;
  const { errors, request } = checkForm(form, preset2, keys);
  const shownErrors = attempted ? errors : {};
  const reviewed = store.memory.get(reviewedKey);
  const edited = draft !== null && typeof reviewed === "string" && request !== null && JSON.stringify(request) !== reviewed;
  const nameOf = (key) => state.networks.find((n) => n.key === key)?.name ?? key;
  const submit = (event) => {
    event.preventDefault();
    setAttempted(true);
    if (!request || locked || review.busy) return;
    void review.run(async () => {
      const data = await store.post("/grant", request, SLOW_TIMEOUT_MS);
      store.memory.set(reviewedKey, JSON.stringify(request));
      onDraft(normalizeDraft(data?.draft));
    });
  };
  return /* @__PURE__ */ jsxs7("form", { className: "sf-form", noValidate: true, onSubmit: submit, children: [
    /* @__PURE__ */ jsxs7("div", { className: "sf-field", children: [
      /* @__PURE__ */ jsx7("span", { className: "sf-label", children: "Preset" }),
      /* @__PURE__ */ jsx7(SegmentedControl2, { onChange: () => void 0, options: [{ id: preset2.id, label: preset2.title }], value: preset2.id })
    ] }),
    /* @__PURE__ */ jsx7("div", { className: "sf-cols", children: keys.map((key) => {
      const net = preset2.networks[key];
      if (!net) return null;
      const capId = `${uid}-cap-${key}`;
      const capError = shownErrors[`cap:${key}`];
      return /* @__PURE__ */ jsxs7("div", { "aria-labelledby": `${capId}-title`, className: "sf-col", role: "group", children: [
        /* @__PURE__ */ jsx7("div", { className: "sf-col-title", id: `${capId}-title`, children: nameOf(key) }),
        /* @__PURE__ */ jsxs7("div", { className: "sf-cap", children: [
          /* @__PURE__ */ jsx7("label", { className: "sf-label", htmlFor: capId, children: "Daily cap" }),
          /* @__PURE__ */ jsx7(
            Input2,
            {
              "aria-describedby": capError ? `${capId}-error` : `${capId}-hint`,
              "aria-invalid": capError ? true : void 0,
              className: "sf-num-input",
              containerClassName: capError ? "sf-invalid" : void 0,
              id: capId,
              inputMode: "decimal",
              onChange: (e) => {
                const value = e.target.value;
                setForm((prev) => ({ ...prev, caps: { ...prev.caps, [key]: value } }));
              },
              size: "sm",
              suffix: net.native.symbol,
              value: form.caps[key] ?? ""
            }
          ),
          capError ? /* @__PURE__ */ jsx7(FieldError, { id: `${capId}-error`, children: capError }) : net.native.feeHeadroom ? /* @__PURE__ */ jsxs7("span", { className: "sf-hint", id: `${capId}-hint`, children: [
            "includes about ",
            net.native.feeHeadroom,
            " ",
            net.native.symbol,
            " for relay fees"
          ] }) : null
        ] }),
        net.tokens.map((token) => {
          const id = tokenId(key, token.symbol);
          const field = form.tokens[id] ?? { checked: false, cap: token.cap };
          const boxId = `${uid}-box-${id}`;
          const inputId = `${uid}-tok-${id}`;
          const error = shownErrors[`tok:${id}`];
          const patch = (next) => setForm((prev) => ({ ...prev, tokens: { ...prev.tokens, [id]: { ...field, ...next } } }));
          return /* @__PURE__ */ jsxs7("div", { className: "sf-token", children: [
            /* @__PURE__ */ jsx7(Checkbox, { checked: field.checked, id: boxId, onCheckedChange: (checked) => patch({ checked: checked === true }) }),
            /* @__PURE__ */ jsxs7("label", { className: "sf-token-name", htmlFor: boxId, children: [
              /* @__PURE__ */ jsx7("span", { className: "sf-strong", children: token.symbol }),
              token.decimals !== null ? /* @__PURE__ */ jsxs7("span", { className: "sf-dim", children: [
                token.decimals,
                " decimals"
              ] }) : null
            ] }),
            /* @__PURE__ */ jsx7(
              Input2,
              {
                "aria-describedby": error ? `${inputId}-error` : void 0,
                "aria-invalid": error ? true : void 0,
                "aria-label": `${token.symbol} daily cap on ${nameOf(key)}`,
                className: "sf-num-input",
                disabled: !field.checked,
                id: inputId,
                inputMode: "decimal",
                onChange: (e) => patch({ cap: e.target.value }),
                size: "sm",
                value: field.cap
              }
            ),
            error ? /* @__PURE__ */ jsx7(FieldError, { id: `${inputId}-error`, children: error }) : null
          ] }, token.symbol);
        })
      ] }, key);
    }) }),
    /* @__PURE__ */ jsxs7("div", { className: "sf-field", children: [
      /* @__PURE__ */ jsx7("label", { className: "sf-label", htmlFor: `${uid}-days`, children: "Duration" }),
      /* @__PURE__ */ jsx7(
        Input2,
        {
          "aria-describedby": shownErrors.days ? `${uid}-days-error` : void 0,
          "aria-invalid": shownErrors.days ? true : void 0,
          className: "sf-num-input",
          containerClassName: shownErrors.days ? "sf-days sf-invalid" : "sf-days",
          id: `${uid}-days`,
          inputMode: "numeric",
          onChange: (e) => {
            const value = e.target.value;
            setForm((prev) => ({ ...prev, days: value }));
          },
          size: "sm",
          suffix: "days",
          value: form.days
        }
      ),
      shownErrors.days ? /* @__PURE__ */ jsx7(FieldError, { id: `${uid}-days-error`, children: shownErrors.days }) : null
    ] }),
    /* @__PURE__ */ jsxs7("div", { className: "sf-submit", children: [
      /* @__PURE__ */ jsxs7("span", { className: "sf-hint", children: [
        "Nothing is signed in this step.",
        edited ? " The form changed since the last review." : ""
      ] }),
      /* @__PURE__ */ jsx7(Button4, { disabled: locked, loading: review.busy, size: "sm", type: "submit", variant: draft && !edited ? "outline" : "default", children: "Review permissions" })
    ] }),
    review.error ? /* @__PURE__ */ jsx7(InlineError, { children: review.error }) : null,
    draft ? /* @__PURE__ */ jsx7(ScopeLists, { draft, networks: state.networks }) : null
  ] });
}
function permissionsSummary(preset2, draft) {
  const days = draft?.durationDays || preset2.durationDays;
  return `${preset2.title}, ${days} ${days === 1 ? "day" : "days"}`;
}
function ActivateStep({ state, draft, onActivated }) {
  const { store, locked } = usePane();
  const uid = useId2();
  const [ticks, setTicks] = useRemembered(`ticks:${draft.id}`, () => ({}));
  const [confirming, setConfirming] = useState5(false);
  const rows = [];
  for (const network2 of state.networks) {
    const part = draft.networks[network2.key];
    if (!part) continue;
    const live = network2.balances ? compareDecimal(network2.balances.native, part.cost.total) : null;
    const enough = live !== null ? live >= 0 : part.sufficient;
    rows.push({ network: network2, part, enough, ticked: enough && ticks[network2.key] !== false });
  }
  const chosen = rows.filter((row) => row.ticked);
  const approvalsHint = chosen.every((row) => row.part.approvals === 1) ? "Each network needs one passkey approval." : `Passkey approvals: ${chosen.map((row) => `${row.part.approvals} on ${row.network.name}`).join(", ")}.`;
  return /* @__PURE__ */ jsxs7(Fragment2, { children: [
    /* @__PURE__ */ jsx7("ul", { className: "sf-costs", children: rows.map(({ network: network2, part, enough, ticked }) => {
      const boxId = `${uid}-${network2.key}`;
      const symbol = part.cost.nativeSymbol || network2.nativeSymbol;
      return /* @__PURE__ */ jsxs7("li", { className: "sf-cost", "data-off": !ticked || void 0, children: [
        /* @__PURE__ */ jsxs7("div", { className: "sf-cost-head", children: [
          /* @__PURE__ */ jsx7(
            Checkbox,
            {
              checked: ticked,
              disabled: !enough || locked,
              id: boxId,
              onCheckedChange: (checked) => setTicks((prev) => ({ ...prev, [network2.key]: checked === true }))
            }
          ),
          /* @__PURE__ */ jsx7("label", { className: "sf-strong", htmlFor: boxId, children: network2.name })
        ] }),
        /* @__PURE__ */ jsxs7("dl", { className: "sf-kv", children: [
          /* @__PURE__ */ jsxs7("div", { children: [
            /* @__PURE__ */ jsx7("dt", { children: "Keystore fee" }),
            /* @__PURE__ */ jsx7("dd", { children: /* @__PURE__ */ jsx7(Num, { symbol, value: part.cost.keystoreFee }) })
          ] }),
          /* @__PURE__ */ jsxs7("div", { children: [
            /* @__PURE__ */ jsxs7("dt", { children: [
              "Relay fee",
              /* @__PURE__ */ jsx7(Badge4, { size: "xs", variant: "muted", children: "estimate" })
            ] }),
            /* @__PURE__ */ jsx7("dd", { children: /* @__PURE__ */ jsx7(Num, { symbol, value: part.cost.relayFeeEstimate }) })
          ] }),
          /* @__PURE__ */ jsxs7("div", { className: "sf-kv-total", children: [
            /* @__PURE__ */ jsx7("dt", { children: "Total" }),
            /* @__PURE__ */ jsx7("dd", { children: /* @__PURE__ */ jsx7(Num, { strong: true, symbol, value: part.cost.total }) })
          ] })
        ] }),
        !enough ? /* @__PURE__ */ jsxs7(Warning, { children: [
          "Balance too low: send at least ",
          part.cost.total,
          " ",
          symbol
        ] }) : null
      ] }, network2.key);
    }) }),
    /* @__PURE__ */ jsxs7("div", { className: "sf-submit", children: [
      /* @__PURE__ */ jsx7("span", { className: "sf-hint", children: approvalsHint }),
      /* @__PURE__ */ jsx7(Button4, { disabled: locked || chosen.length === 0, onClick: () => setConfirming(true), size: "sm", type: "button", children: "Activate" })
    ] }),
    /* @__PURE__ */ jsx7(
      ConfirmDialog3,
      {
        confirmLabel: "Activate",
        description: approvalsHint,
        dismissOnConfirm: true,
        onClose: () => setConfirming(false),
        onConfirm: async () => {
          await store.post("/activate", { draftId: draft.id, networks: chosen.map((row) => row.network.key) });
          onActivated();
        },
        open: confirming,
        title: chosen.length === 1 ? "Activate on 1 network?" : `Activate on ${chosen.length} networks?`,
        children: /* @__PURE__ */ jsx7("ul", { className: "sf-dialog sf-confirm-list", children: chosen.map(({ network: network2, part }) => /* @__PURE__ */ jsxs7("li", { children: [
          /* @__PURE__ */ jsx7("span", { children: network2.name }),
          /* @__PURE__ */ jsx7(Num, { strong: true, symbol: part.cost.nativeSymbol || network2.nativeSymbol, value: part.cost.total })
        ] }, network2.key)) })
      }
    )
  ] });
}
function activateSummary(networks) {
  const active = networks.filter((n) => n.session?.status === "active").length;
  return active > 0 ? `${active} of ${networks.length} active` : null;
}

// src/steps.tsx
import { Badge as Badge5, Button as Button5, CopyButton as CopyButton3, Skeleton as Skeleton2 } from "@hermes/plugin-sdk";
import { useId as useId3, useState as useState6 } from "react";

// src/qr.tsx
import { useMemo } from "react";

// node_modules/uqr/dist/index.mjs
var QrCodeDataType = /* @__PURE__ */ ((QrCodeDataType2) => {
  QrCodeDataType2[QrCodeDataType2["Border"] = -1] = "Border";
  QrCodeDataType2[QrCodeDataType2["Data"] = 0] = "Data";
  QrCodeDataType2[QrCodeDataType2["Function"] = 1] = "Function";
  QrCodeDataType2[QrCodeDataType2["Position"] = 2] = "Position";
  QrCodeDataType2[QrCodeDataType2["Timing"] = 3] = "Timing";
  QrCodeDataType2[QrCodeDataType2["Alignment"] = 4] = "Alignment";
  return QrCodeDataType2;
})(QrCodeDataType || {});
var LOW = [0, 1];
var MEDIUM = [1, 0];
var QUARTILE = [2, 3];
var HIGH = [3, 2];
var EccMap = {
  L: LOW,
  M: MEDIUM,
  Q: QUARTILE,
  H: HIGH
};
var NUMERIC_REGEX = /^\d*$/;
var ALPHANUMERIC_REGEX = /^[A-Z0-9 $%*+./:-]*$/;
var ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
var MIN_VERSION = 1;
var MAX_VERSION = 40;
var PENALTY_N1 = 3;
var PENALTY_N2 = 3;
var PENALTY_N3 = 40;
var PENALTY_N4 = 10;
var ECC_CODEWORDS_PER_BLOCK = [
  // Version: (note that index 0 is for padding, and is set to an illegal value)
  // 0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // Low
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // Medium
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // Quartile
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  // High
];
var NUM_ERROR_CORRECTION_BLOCKS = [
  // Version: (note that index 0 is for padding, and is set to an illegal value)
  // 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  // Low
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  // Medium
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  // Quartile
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  // High
];
var QrCode = class {
  /* -- Constructor (low level) and fields -- */
  // Creates a new QR Code with the given version number,
  // error correction level, data codeword bytes, and mask number.
  // This is a low-level API that most users should not use directly.
  // A mid-level API is the encodeSegments() function.
  constructor(version, ecc, dataCodewords, msk) {
    this.version = version;
    this.ecc = ecc;
    if (version < MIN_VERSION || version > MAX_VERSION)
      throw new RangeError("Version value out of range");
    if (msk < -1 || msk > 7)
      throw new RangeError("Mask value out of range");
    this.size = version * 4 + 17;
    const row = Array.from({ length: this.size }).fill(false);
    for (let i = 0; i < this.size; i++) {
      this.modules.push(row.slice());
      this.types.push(row.map(() => 0));
    }
    this.drawFunctionPatterns();
    const allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);
    if (msk === -1) {
      let minPenalty = 1e9;
      for (let i = 0; i < 8; i++) {
        this.applyMask(i);
        this.drawFormatBits(i);
        const penalty = this.getPenaltyScore();
        if (penalty < minPenalty) {
          msk = i;
          minPenalty = penalty;
        }
        this.applyMask(i);
      }
    }
    this.mask = msk;
    this.applyMask(msk);
    this.drawFormatBits(msk);
  }
  /* -- Fields -- */
  // The width and height of this QR Code, measured in modules, between
  // 21 and 177 (inclusive). This is equal to version * 4 + 17.
  size;
  // The index of the mask pattern used in this QR Code, which is between 0 and 7 (inclusive).
  // Even if a QR Code is created with automatic masking requested (mask = -1),
  // the resulting object still has a mask value between 0 and 7.
  mask;
  // The modules of this QR Code (false = light, true = dark).
  // Immutable after constructor finishes. Accessed through getModule().
  modules = [];
  types = [];
  /* -- Accessor methods -- */
  // Returns the color of the module (pixel) at the given coordinates, which is false
  // for light or true for dark. The top left corner has the coordinates (x=0, y=0).
  // If the given coordinates are out of bounds, then false (light) is returned.
  getModule(x, y) {
    return x >= 0 && x < this.size && y >= 0 && y < this.size && this.modules[y][x];
  }
  /* -- Private helper methods for constructor: Drawing function modules -- */
  // Reads this object's version field, and draws and marks all function modules.
  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0, QrCodeDataType.Timing);
      this.setFunctionModule(i, 6, i % 2 === 0, QrCodeDataType.Timing);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);
    const alignPatPos = this.getAlignmentPatternPositions();
    const numAlign = alignPatPos.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        if (!(i === 0 && j === 0 || i === 0 && j === numAlign - 1 || i === numAlign - 1 && j === 0))
          this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  }
  // Draws two copies of the format bits (with its own error correction code)
  // based on the given mask and this object's error correction level field.
  drawFormatBits(mask) {
    const data = this.ecc[1] << 3 | mask;
    let rem = data;
    for (let i = 0; i < 10; i++)
      rem = rem << 1 ^ (rem >>> 9) * 1335;
    const bits = (data << 10 | rem) ^ 21522;
    for (let i = 0; i <= 5; i++)
      this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++)
      this.setFunctionModule(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++)
      this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++)
      this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true);
  }
  // Draws two copies of the version bits (with its own error correction code),
  // based on this object's version field, iff 7 <= version <= 40.
  drawVersion() {
    if (this.version < 7)
      return;
    let rem = this.version;
    for (let i = 0; i < 12; i++)
      rem = rem << 1 ^ (rem >>> 11) * 7973;
    const bits = this.version << 12 | rem;
    for (let i = 0; i < 18; i++) {
      const color = getBit(bits, i);
      const a = this.size - 11 + i % 3;
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  }
  // Draws a 9*9 finder pattern including the border separator,
  // with the center module at (x, y). Modules can be out of bounds.
  drawFinderPattern(x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size)
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4, QrCodeDataType.Position);
      }
    }
  }
  // Draws a 5*5 alignment pattern, with the center module
  // at (x, y). All modules must be in bounds.
  drawAlignmentPattern(x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(
          x + dx,
          y + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          QrCodeDataType.Alignment
        );
      }
    }
  }
  // Sets the color of a module and marks it as a function module.
  // Only used by the constructor. Coordinates must be in bounds.
  setFunctionModule(x, y, isDark, type = QrCodeDataType.Function) {
    this.modules[y][x] = isDark;
    this.types[y][x] = type;
  }
  /* -- Private helper methods for constructor: Codewords and masking -- */
  // Returns a new byte string representing the given data with the appropriate error correction
  // codewords appended to it, based on this object's version and error correction level.
  addEccAndInterleave(data) {
    const ver = this.version;
    const ecl = this.ecc;
    if (data.length !== getNumDataCodewords(ver, ecl))
      throw new RangeError("Invalid argument");
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl[0]][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl[0]][ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - rawCodewords % numBlocks;
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const blocks = [];
    const rsDiv = reedSolomonComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks)
        dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)
          result.push(block[i]);
      });
    }
    return result;
  }
  // Draws the given sequence of 8-bit codewords (data and error correction) onto the entire
  // data area of this QR Code. Function modules need to be marked off before this is called.
  drawCodewords(data) {
    if (data.length !== Math.floor(getNumRawDataModules(this.version) / 8))
      throw new RangeError("Invalid argument");
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6)
        right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = (right + 1 & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.types[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }
  // XORs the codeword modules in this QR Code with the given mask pattern.
  // The function modules must be marked and the codeword bits must be drawn
  // before masking. Due to the arithmetic of XOR, calling applyMask() with
  // the same mask value a second time will undo the mask. A final well-formed
  // QR Code needs exactly one (not zero, two, etc.) mask applied.
  applyMask(mask) {
    if (mask < 0 || mask > 7)
      throw new RangeError("Mask value out of range");
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = x * y % 2 + x * y % 3 === 0;
            break;
          case 6:
            invert = (x * y % 2 + x * y % 3) % 2 === 0;
            break;
          case 7:
            invert = ((x + y) % 2 + x * y % 3) % 2 === 0;
            break;
          default:
            throw new Error("Unreachable");
        }
        if (!this.types[y][x] && invert)
          this.modules[y][x] = !this.modules[y][x];
      }
    }
  }
  // Calculates and returns the penalty score based on state of this QR Code's current modules.
  // This is used by the automatic mask choice algorithm to find the mask pattern that yields the lowest score.
  getPenaltyScore() {
    let result = 0;
    for (let y = 0; y < this.size; y++) {
      let runColor = false;
      let runX = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < this.size; x++) {
        if (this.modules[y][x] === runColor) {
          runX++;
          if (runX === 5)
            result += PENALTY_N1;
          else if (runX > 5)
            result++;
        } else {
          this.finderPenaltyAddHistory(runX, runHistory);
          if (!runColor)
            result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runX = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * PENALTY_N3;
    }
    for (let x = 0; x < this.size; x++) {
      let runColor = false;
      let runY = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < this.size; y++) {
        if (this.modules[y][x] === runColor) {
          runY++;
          if (runY === 5)
            result += PENALTY_N1;
          else if (runY > 5)
            result++;
        } else {
          this.finderPenaltyAddHistory(runY, runHistory);
          if (!runColor)
            result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runY = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * PENALTY_N3;
    }
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color = this.modules[y][x];
        if (color === this.modules[y][x + 1] && color === this.modules[y + 1][x] && color === this.modules[y + 1][x + 1]) {
          result += PENALTY_N2;
        }
      }
    }
    let dark = 0;
    for (const row of this.modules)
      dark = row.reduce((sum, color) => sum + (color ? 1 : 0), dark);
    const total = this.size * this.size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  }
  /* -- Private helper functions -- */
  // Returns an ascending list of positions of alignment patterns for this version number.
  // Each position is in the range [0,177), and are used on both the x and y axes.
  // This could be implemented as lookup table of 40 variable-length lists of integers.
  getAlignmentPatternPositions() {
    if (this.version === 1) {
      return [];
    } else {
      const numAlign = Math.floor(this.version / 7) + 2;
      const step = this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
      const result = [6];
      for (let pos = this.size - 7; result.length < numAlign; pos -= step)
        result.splice(1, 0, pos);
      return result;
    }
  }
  // Can only be called immediately after a light run is added, and
  // returns either 0, 1, or 2. A helper function for getPenaltyScore().
  finderPenaltyCountPatterns(runHistory) {
    const n = runHistory[1];
    const core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
    return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
  }
  // Must be called at the end of a line (row or column) of modules. A helper function for getPenaltyScore().
  finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory) {
    if (currentRunColor) {
      this.finderPenaltyAddHistory(currentRunLength, runHistory);
      currentRunLength = 0;
    }
    currentRunLength += this.size;
    this.finderPenaltyAddHistory(currentRunLength, runHistory);
    return this.finderPenaltyCountPatterns(runHistory);
  }
  // Pushes the given value to the front and drops the last value. A helper function for getPenaltyScore().
  finderPenaltyAddHistory(currentRunLength, runHistory) {
    if (runHistory[0] === 0)
      currentRunLength += this.size;
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  }
};
function appendBits(val, len, bb) {
  if (len < 0 || len > 31 || val >>> len !== 0)
    throw new RangeError("Value out of range");
  for (let i = len - 1; i >= 0; i--)
    bb.push(val >>> i & 1);
}
function getBit(x, i) {
  return (x >>> i & 1) !== 0;
}
var QrSegment = class {
  // Creates a new QR Code segment with the given attributes and data.
  // The character count (numChars) must agree with the mode and the bit buffer length,
  // but the constraint isn't checked. The given bit buffer is cloned and stored.
  constructor(mode, numChars, bitData) {
    this.mode = mode;
    this.numChars = numChars;
    this.bitData = bitData;
    if (numChars < 0)
      throw new RangeError("Invalid argument");
    this.bitData = bitData.slice();
  }
  /* -- Methods -- */
  // Returns a new copy of the data bits of this segment.
  getData() {
    return this.bitData.slice();
  }
};
var MODE_NUMERIC = [1, 10, 12, 14];
var MODE_ALPHANUMERIC = [2, 9, 11, 13];
var MODE_BYTE = [4, 8, 16, 16];
function numCharCountBits(mode, ver) {
  return mode[Math.floor((ver + 7) / 17) + 1];
}
function makeBytes(data) {
  const bb = [];
  for (const b of data)
    appendBits(b, 8, bb);
  return new QrSegment(MODE_BYTE, data.length, bb);
}
function makeNumeric(digits) {
  if (!isNumeric(digits))
    throw new RangeError("String contains non-numeric characters");
  const bb = [];
  for (let i = 0; i < digits.length; ) {
    const n = Math.min(digits.length - i, 3);
    appendBits(Number.parseInt(digits.substring(i, i + n), 10), n * 3 + 1, bb);
    i += n;
  }
  return new QrSegment(MODE_NUMERIC, digits.length, bb);
}
function makeAlphanumeric(text2) {
  if (!isAlphanumeric(text2))
    throw new RangeError("String contains unencodable characters in alphanumeric mode");
  const bb = [];
  let i;
  for (i = 0; i + 2 <= text2.length; i += 2) {
    let temp = ALPHANUMERIC_CHARSET.indexOf(text2.charAt(i)) * 45;
    temp += ALPHANUMERIC_CHARSET.indexOf(text2.charAt(i + 1));
    appendBits(temp, 11, bb);
  }
  if (i < text2.length)
    appendBits(ALPHANUMERIC_CHARSET.indexOf(text2.charAt(i)), 6, bb);
  return new QrSegment(MODE_ALPHANUMERIC, text2.length, bb);
}
function makeSegments(text2) {
  if (text2 === "")
    return [];
  else if (isNumeric(text2))
    return [makeNumeric(text2)];
  else if (isAlphanumeric(text2))
    return [makeAlphanumeric(text2)];
  else
    return [makeBytes(toUtf8ByteArray(text2))];
}
function isNumeric(text2) {
  return NUMERIC_REGEX.test(text2);
}
function isAlphanumeric(text2) {
  return ALPHANUMERIC_REGEX.test(text2);
}
function getTotalBits(segs, version) {
  let result = 0;
  for (const seg of segs) {
    const ccbits = numCharCountBits(seg.mode, version);
    if (seg.numChars >= 1 << ccbits)
      return Number.POSITIVE_INFINITY;
    result += 4 + ccbits + seg.bitData.length;
  }
  return result;
}
function toUtf8ByteArray(str) {
  return Array.from(new TextEncoder().encode(str));
}
function getNumRawDataModules(ver) {
  if (ver < MIN_VERSION || ver > MAX_VERSION)
    throw new RangeError("Version number out of range");
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7)
      result -= 36;
  }
  return result;
}
function getNumDataCodewords(ver, ecl) {
  return Math.floor(getNumRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl[0]][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl[0]][ver];
}
function reedSolomonComputeDivisor(degree) {
  if (degree < 1 || degree > 255)
    throw new RangeError("Degree out of range");
  const result = [];
  for (let i = 0; i < degree - 1; i++)
    result.push(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length)
        result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 2);
  }
  return result;
}
function reedSolomonComputeRemainder(data, divisor) {
  const result = divisor.map((_) => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => result[i] ^= reedSolomonMultiply(coef, factor));
  }
  return result;
}
function reedSolomonMultiply(x, y) {
  if (x >>> 8 !== 0 || y >>> 8 !== 0)
    throw new RangeError("Byte out of range");
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = z << 1 ^ (z >>> 7) * 285;
    z ^= (y >>> i & 1) * x;
  }
  return z;
}
function encodeSegments(segs, ecl, minVersion = 1, maxVersion = 40, mask = -1, boostEcl = true) {
  if (!(MIN_VERSION <= minVersion && minVersion <= maxVersion && maxVersion <= MAX_VERSION) || mask < -1 || mask > 7) {
    throw new RangeError("Invalid value");
  }
  let version;
  let dataUsedBits;
  for (version = minVersion; ; version++) {
    const dataCapacityBits2 = getNumDataCodewords(version, ecl) * 8;
    const usedBits = getTotalBits(segs, version);
    if (usedBits <= dataCapacityBits2) {
      dataUsedBits = usedBits;
      break;
    }
    if (version >= maxVersion)
      throw new RangeError("Data too long");
  }
  for (const newEcl of [MEDIUM, QUARTILE, HIGH]) {
    if (boostEcl && dataUsedBits <= getNumDataCodewords(version, newEcl) * 8)
      ecl = newEcl;
  }
  const bb = [];
  for (const seg of segs) {
    appendBits(seg.mode[0], 4, bb);
    appendBits(seg.numChars, numCharCountBits(seg.mode, version), bb);
    for (const b of seg.getData())
      bb.push(b);
  }
  const dataCapacityBits = getNumDataCodewords(version, ecl) * 8;
  appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
  appendBits(0, (8 - bb.length % 8) % 8, bb);
  for (let padByte = 236; bb.length < dataCapacityBits; padByte ^= 236 ^ 17)
    appendBits(padByte, 8, bb);
  const dataCodewords = Array.from({ length: Math.ceil(bb.length / 8) }, () => 0);
  bb.forEach((b, i) => dataCodewords[i >>> 3] |= b << 7 - (i & 7));
  return new QrCode(version, ecl, dataCodewords, mask);
}
function encode(data, options) {
  const {
    ecc = "L",
    boostEcc = false,
    minVersion = 1,
    maxVersion = 40,
    maskPattern = -1,
    border = 1
  } = options || {};
  const segment = typeof data === "string" ? makeSegments(data) : Array.isArray(data) ? [makeBytes(data)] : void 0;
  if (!segment)
    throw new Error(`uqr only supports encoding string and binary data, but got: ${typeof data}`);
  const qr = encodeSegments(
    segment,
    EccMap[ecc],
    minVersion,
    maxVersion,
    maskPattern,
    boostEcc
  );
  const result = addBorder({
    version: qr.version,
    maskPattern: qr.mask,
    size: qr.size,
    data: qr.modules,
    types: qr.types
  }, border);
  if (options?.invert)
    result.data = result.data.map((row) => row.map((mod) => !mod));
  options?.onEncoded?.(result);
  return result;
}
function addBorder(input, border = 1) {
  if (!border)
    return input;
  const { size } = input;
  const newSize = size + border * 2;
  input.size = newSize;
  input.data.forEach((row) => {
    for (let i = 0; i < border; i++) {
      row.unshift(false);
      row.push(false);
    }
  });
  for (let i = 0; i < border; i++) {
    input.data.unshift(Array.from({ length: newSize }, (_) => false));
    input.data.push(Array.from({ length: newSize }, (_) => false));
  }
  const b = QrCodeDataType.Border;
  input.types.forEach((row) => {
    for (let i = 0; i < border; i++) {
      row.unshift(b);
      row.push(b);
    }
  });
  for (let i = 0; i < border; i++) {
    input.types.unshift(Array.from({ length: newSize }, (_) => b));
    input.types.push(Array.from({ length: newSize }, (_) => b));
  }
  return input;
}

// src/qr.tsx
import { jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
var QUIET = 4;
function modulePath(rows) {
  let d = "";
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? [];
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (row[x + run]) run++;
      d += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return d;
}
function QrCode2({ value, label, className }) {
  const symbol = useMemo(() => {
    try {
      const bytes = Array.from(new TextEncoder().encode(value));
      const qr = encode(bytes, { ecc: "M", border: 0 });
      return { d: modulePath(qr.data), size: qr.size + QUIET * 2 };
    } catch {
      return null;
    }
  }, [value]);
  if (!symbol) return null;
  return /* @__PURE__ */ jsxs8(
    "svg",
    {
      "aria-label": label,
      className,
      role: "img",
      shapeRendering: "crispEdges",
      viewBox: `0 0 ${symbol.size} ${symbol.size}`,
      children: [
        /* @__PURE__ */ jsx8("rect", { fill: "#fff", height: symbol.size, width: symbol.size }),
        /* @__PURE__ */ jsx8("path", { d: symbol.d, fill: "#000" })
      ]
    }
  );
}

// src/steps.tsx
import { Fragment as Fragment3, jsx as jsx9, jsxs as jsxs9 } from "react/jsx-runtime";
function Step({ n, title, status, summary, blocked, open, onToggle, children }) {
  const bodyId = useId3();
  const shown = open && !blocked;
  const label = /* @__PURE__ */ jsxs9(Fragment3, { children: [
    /* @__PURE__ */ jsxs9("span", { className: "sf-step-title", children: [
      /* @__PURE__ */ jsxs9("span", { className: "sf-sr", children: [
        "Step ",
        n,
        ": "
      ] }),
      title,
      status === "done" ? /* @__PURE__ */ jsx9("span", { className: "sf-sr", children: " (done)" }) : null
    ] }),
    blocked ? /* @__PURE__ */ jsx9("span", { className: "sf-step-summary", children: blocked }) : null,
    !blocked && !shown && summary ? /* @__PURE__ */ jsx9("span", { className: "sf-step-summary", children: summary }) : null
  ] });
  return /* @__PURE__ */ jsxs9("li", { className: "sf-step", "data-status": status, children: [
    /* @__PURE__ */ jsx9("span", { "aria-hidden": "true", className: "sf-step-marker", children: status === "done" ? /* @__PURE__ */ jsx9(IconCheck, { height: 12, width: 12 }) : n }),
    blocked ? /* @__PURE__ */ jsx9("div", { className: "sf-step-head", children: label }) : /* @__PURE__ */ jsxs9("button", { "aria-controls": bodyId, "aria-expanded": shown, className: "sf-step-head", onClick: onToggle, type: "button", children: [
      label,
      /* @__PURE__ */ jsx9(IconChevron, { className: "sf-step-caret", height: 12, width: 12 })
    ] }),
    /* @__PURE__ */ jsx9("span", { "aria-hidden": "true", className: "sf-step-rail" }),
    /* @__PURE__ */ jsx9("div", { className: "sf-step-body", id: bodyId, children: shown ? children : null })
  ] });
}
function GroupedAddress({ value }) {
  const groups = [value.slice(0, 6)];
  for (let i = 6; i < value.length; i += 4) groups.push(value.slice(i, i + 4));
  return /* @__PURE__ */ jsx9("span", { className: "sf-address", children: groups.map((group, i) => /* @__PURE__ */ jsx9("span", { children: group }, i)) });
}
function EarlierWallets({ others, disabled, onUse }) {
  if (others.length === 0) return null;
  return /* @__PURE__ */ jsxs9("div", { className: "sf-earlier", children: [
    /* @__PURE__ */ jsx9("h3", { className: "sf-earlier-title", children: "Earlier wallets" }),
    /* @__PURE__ */ jsx9("ul", { className: "sf-earlier-list", children: others.map((w) => /* @__PURE__ */ jsxs9("li", { children: [
      /* @__PURE__ */ jsx9("span", { className: "sf-mono", title: w.address, children: shortHex(w.address, 8, 6) }),
      /* @__PURE__ */ jsx9(Button5, { disabled, onClick: () => onUse(w.address), size: "xs", type: "button", variant: "outline", children: "Use" })
    ] }, w.address)) })
  ] });
}
function leftBehind(networks) {
  const lines2 = [];
  const held = networks.flatMap((n) => {
    const b = n.balances;
    if (!b) return [];
    const parts = [isPositive(b.native) ? `${displayAmount(b.native)} ${n.nativeSymbol}` : "", ...b.tokens.filter((t) => isPositive(t.amount)).map((t) => `${displayAmount(t.amount)} ${t.symbol}`)].filter(Boolean);
    return parts.length ? [`${parts.join(", ")} on ${n.name}`] : [];
  });
  if (held.length) lines2.push(`It holds ${held.join(" and ")}. Funds stay at this address. Withdraw them first, or come back to this wallet for them.`);
  const open = networks.filter((n) => n.positions.length > 0).map((n) => n.name);
  if (open.length) lines2.push(`It has an open position on ${open.join(" and ")}. The position stays in this wallet.`);
  const live = networks.filter((n) => n.session?.status === "active").map((n) => n.name);
  if (live.length) lines2.push(`The agent can still act for this wallet on ${live.join(" and ")} until you revoke that session or it expires. Revoke first to end it now.`);
  return lines2;
}
function WalletStep({ address, networks, others, onSwitched }) {
  const { store, locked } = usePane();
  const create = useAction();
  const recover = useAction();
  const change = useAction();
  const [switching, setSwitching] = useState6(false);
  const use = (target) => void change.run(async () => {
    await store.post("/wallet/use", { address: target });
    setSwitching(false);
    onSwitched();
  });
  if (address) {
    const warnings = switching ? leftBehind(networks) : [];
    return /* @__PURE__ */ jsxs9(Fragment3, { children: [
      /* @__PURE__ */ jsxs9("div", { className: "sf-wallet", children: [
        /* @__PURE__ */ jsxs9("div", { className: "sf-wallet-main", children: [
          /* @__PURE__ */ jsx9(GroupedAddress, { value: address }),
          /* @__PURE__ */ jsx9(CopyButton3, { buttonSize: "xs", buttonVariant: "outline", label: "Copy address", text: address, children: "Copy address" })
        ] }),
        /* @__PURE__ */ jsx9(QrCode2, { className: "sf-qr", label: "QR code of the wallet address", value: address })
      ] }),
      switching ? /* @__PURE__ */ jsxs9("div", { className: "sf-switch", children: [
        /* @__PURE__ */ jsx9("h3", { className: "sf-switch-title", children: "Use another wallet" }),
        warnings.map((line) => /* @__PURE__ */ jsx9(Warning, { children: line }, line)),
        /* @__PURE__ */ jsx9("p", { className: "sf-copy", children: "This wallet is set aside, not deleted. To return to it, pick it under Earlier wallets or use Recover from passkey." }),
        /* @__PURE__ */ jsx9(EarlierWallets, { disabled: locked || change.busy, onUse: use, others }),
        /* @__PURE__ */ jsxs9("div", { className: "sf-actions", children: [
          /* @__PURE__ */ jsx9(
            Button5,
            {
              disabled: locked,
              loading: change.busy,
              onClick: () => void change.run(async () => {
                await store.post("/wallet/set-aside", {});
                setSwitching(false);
                onSwitched();
              }),
              size: "sm",
              type: "button",
              children: "Set aside and start a new one"
            }
          ),
          /* @__PURE__ */ jsx9(
            Button5,
            {
              disabled: change.busy,
              onClick: () => {
                change.clear();
                setSwitching(false);
              },
              size: "sm",
              type: "button",
              variant: "outline",
              children: "Cancel"
            }
          )
        ] }),
        change.error ? /* @__PURE__ */ jsx9(InlineError, { children: change.error }) : null
      ] }) : /* @__PURE__ */ jsx9("button", { className: "sf-link sf-switch-open", disabled: locked, onClick: () => setSwitching(true), type: "button", children: "Use another wallet" })
    ] });
  }
  return /* @__PURE__ */ jsxs9(Fragment3, { children: [
    /* @__PURE__ */ jsx9("p", { className: "sf-copy", children: "The admin key is a passkey that stays on your device." }),
    /* @__PURE__ */ jsxs9("div", { className: "sf-actions", children: [
      /* @__PURE__ */ jsx9(
        Button5,
        {
          disabled: locked || recover.busy || change.busy,
          loading: create.busy,
          onClick: () => {
            recover.clear();
            void create.run(() => store.post("/create", {}));
          },
          size: "sm",
          type: "button",
          children: "Create Smart Agentic Wallet"
        }
      ),
      /* @__PURE__ */ jsx9(
        Button5,
        {
          disabled: locked || create.busy || change.busy,
          loading: recover.busy,
          onClick: () => {
            create.clear();
            void recover.run(() => store.post("/recover", {}));
          },
          size: "sm",
          type: "button",
          variant: "outline",
          children: "Recover from passkey"
        }
      )
    ] }),
    create.error ? /* @__PURE__ */ jsx9(InlineError, { children: create.error }) : null,
    recover.error ? /* @__PURE__ */ jsx9(InlineError, { children: recover.error }) : null,
    /* @__PURE__ */ jsx9(EarlierWallets, { disabled: locked || create.busy || recover.busy || change.busy, onUse: use, others }),
    change.error ? /* @__PURE__ */ jsx9(InlineError, { children: change.error }) : null
  ] });
}
var walletSummary = (address) => address ? /* @__PURE__ */ jsx9("span", { className: "sf-mono", children: shortHex(address) }) : null;
function NetworkRow({ network: network2 }) {
  const { now } = usePane();
  const asOf = parseTime(network2.asOf);
  const held = (network2.balances?.tokens ?? []).filter((t) => isPositive(t.amount));
  return /* @__PURE__ */ jsxs9("li", { className: "sf-net", children: [
    /* @__PURE__ */ jsxs9("div", { className: "sf-net-id", children: [
      /* @__PURE__ */ jsx9("span", { className: "sf-net-name", children: network2.name }),
      /* @__PURE__ */ jsxs9("span", { className: "sf-links", children: [
        /* @__PURE__ */ jsx9(ExtLink, { href: network2.addressUrl, children: "Explorer" }),
        /* @__PURE__ */ jsx9(ExtLink, { href: network2.keystoreAccountUrl, children: "Keystore" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs9("div", { className: "sf-net-figures", children: [
      /* @__PURE__ */ jsx9("span", { className: "sf-net-balance", children: network2.balances ? /* @__PURE__ */ jsx9(Num, { strong: true, symbol: network2.nativeSymbol, value: network2.balances.native }) : network2.error ? /* @__PURE__ */ jsx9("span", { className: "sf-dim", children: "unavailable" }) : /* @__PURE__ */ jsx9(Skeleton2, { style: { width: 96, height: 14 } }) }),
      held.map((token) => /* @__PURE__ */ jsx9("span", { className: "sf-net-token", children: /* @__PURE__ */ jsx9(Num, { symbol: token.symbol, value: token.amount }) }, token.symbol)),
      /* @__PURE__ */ jsx9("span", { className: "sf-net-asof", children: asOf !== null ? timeAgo(asOf, now) : null })
    ] }),
    network2.error ? /* @__PURE__ */ jsx9("div", { className: "sf-net-error", children: /* @__PURE__ */ jsx9(Warning, { children: network2.error }) }) : null
  ] });
}
function FundStep({ address, networks, onWithdraw }) {
  const { locked } = usePane();
  const anything = networks.some(
    (n) => n.balances !== null && (isPositive(n.balances.native) || n.balances.tokens.some((t) => isPositive(t.amount)))
  );
  return /* @__PURE__ */ jsxs9(Fragment3, { children: [
    /* @__PURE__ */ jsxs9("div", { className: "sf-fund-address", children: [
      /* @__PURE__ */ jsx9("span", { className: "sf-badges", children: networks.map((n) => /* @__PURE__ */ jsx9(Badge5, { variant: "muted", children: n.shortName }, n.key)) }),
      /* @__PURE__ */ jsx9(Hex, { copyLabel: "Copy address", fit: true, value: address })
    ] }),
    /* @__PURE__ */ jsx9("p", { className: "sf-copy", children: "Same address on both networks. Send ETH only on Ethereum. Send BNB only on BNB Chain." }),
    /* @__PURE__ */ jsx9("ul", { className: "sf-nets", children: networks.map((n) => /* @__PURE__ */ jsx9(NetworkRow, { network: n }, n.key)) }),
    /* @__PURE__ */ jsx9("div", { className: "sf-actions", children: /* @__PURE__ */ jsx9(Button5, { disabled: locked || !anything, onClick: onWithdraw, size: "sm", type: "button", variant: "outline", children: "Withdraw" }) })
  ] });
}
function fundSummary(networks) {
  const parts = networks.filter((n) => n.balances !== null);
  if (parts.length === 0) return null;
  return /* @__PURE__ */ jsx9("span", { className: "sf-summary-nums", children: parts.map((n) => /* @__PURE__ */ jsx9(Num, { symbol: n.nativeSymbol, value: n.balances?.native ?? "0" }, n.key)) });
}

// src/styles.ts
var PANE_CSS = `
.sf-root,.sf-dialog{
  --sf-fg:var(--foreground);
  --sf-fg2:var(--ui-text-secondary);
  --sf-fg3:var(--ui-text-tertiary);
  --sf-line:var(--ui-stroke-secondary);
  --sf-accent:var(--ui-accent);
  --sf-red:var(--ui-red);
  --sf-green:var(--ui-green);
  --sf-yellow:var(--ui-yellow);
  --sf-mono:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  --sf-wash:color-mix(in srgb,var(--foreground) 4%,transparent);
  --sf-warn-text:color-mix(in srgb,var(--ui-yellow) 72%,var(--foreground));
  --sf-input-w:144px;
  --sf-cap-w:144px;
  color:var(--sf-fg);
  font-size:12px;
  line-height:1.5;
  text-align:left;
}
.sf-root *,.sf-root *::before,.sf-root *::after,.sf-dialog *,.sf-dialog *::before,.sf-dialog *::after{box-sizing:border-box}
:where(.sf-root,.sf-dialog) :where(h2,h3,p,ul,ol,dl,li):where([class^="sf-"],[class*=" sf-"]),
:where(ul).sf-dialog,
:where(.sf-scope,.sf-confirm-list) > li,
:where(.sf-kv,.sf-ledger) :where(dt,dd){margin:0;padding:0;list-style:none}

.sf-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;container:sf / inline-size}

.sf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.sf-dim{color:var(--sf-fg3)}
.sf-strong{font-weight:600}
.sf-mono{font-family:var(--sf-mono);font-variant-ligatures:none}
.sf-copy{color:var(--sf-fg2);max-width:52ch}
.sf-hint{color:var(--sf-fg3);font-size:11px;line-height:1.45;text-wrap:balance}
.sf-label{color:var(--sf-fg2)}
.sf-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}

.sf-amt{display:inline-flex;align-items:baseline;gap:.4em;white-space:nowrap;-webkit-user-select:text;user-select:text}
.sf-num{font-family:var(--sf-mono);font-variant-numeric:tabular-nums;font-variant-ligatures:none;white-space:nowrap}
.sf-sym{color:var(--sf-fg2);font-size:11px}
.sf-amt[data-strong] .sf-num,.sf-num[data-strong]{font-weight:600}

.sf-alert{display:flex;align-items:flex-start;gap:6px;font-size:11.5px;line-height:1.45;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.sf-alert svg{flex:none;width:13px;height:13px;margin-top:2px}
.sf-alert[data-tone=error]{color:var(--sf-red)}
.sf-alert[data-tone=warn]{color:var(--sf-warn-text)}
.sf-alert[data-tone=warn] svg{color:var(--sf-yellow)}

.sf-links{display:flex;flex-wrap:wrap;align-items:center;column-gap:12px;row-gap:2px}
.sf-link-wrap{display:inline-flex;align-items:center;gap:4px}
.sf-link{display:inline-flex;align-items:center;gap:3px;margin:0;padding:0;border:0;border-radius:2px;background:none;font:inherit;font-size:11.5px;color:var(--sf-accent);cursor:pointer;text-decoration:underline;text-decoration-color:color-mix(in srgb,currentColor 28%,transparent);text-underline-offset:3px}
.sf-link:hover{text-decoration-color:currentColor}
.sf-link svg{flex:none;width:11px;height:11px}
.sf-link:focus-visible,.sf-step-head:focus-visible,.sf-asset:focus-visible{outline:2px solid var(--sf-accent);outline-offset:2px}

.sf-hex{display:inline-flex;align-items:center;gap:2px;min-width:0;max-width:100%}
.sf-hex-text{display:flex;min-width:0;font-family:var(--sf-mono);font-size:11.5px;font-variant-ligatures:none;white-space:nowrap;-webkit-user-select:text;user-select:text}
.sf-hex-head{min-width:0;overflow:hidden;text-overflow:ellipsis}
.sf-hex-tail{flex:none}

/* Header and the strips pinned under it */
.sf-header{flex:none;display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px;border-bottom:1px solid var(--sf-line)}
.sf-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
.sf-strip{flex:none;padding:8px 16px;border-bottom:1px solid var(--sf-line)}

.sf-job{flex:none;display:grid;grid-template-columns:18px minmax(0,1fr);column-gap:10px;max-height:60%;overflow-y:auto;padding:10px 16px 12px;border-bottom:1px solid var(--sf-line);background:var(--sf-wash)}
.sf-job[data-tone=wait]{background:color-mix(in srgb,var(--sf-accent) 7%,transparent)}
.sf-job[data-tone=done]{background:color-mix(in srgb,var(--sf-green) 9%,transparent)}
.sf-job[data-tone=partial]{background:color-mix(in srgb,var(--sf-yellow) 10%,transparent)}
.sf-job[data-tone=error]{background:color-mix(in srgb,var(--sf-red) 8%,transparent)}
.sf-job-busy{padding-top:14px;padding-bottom:16px;background:color-mix(in srgb,var(--sf-accent) 9%,transparent);border-bottom:2px solid var(--sf-accent)}
.sf-job-busy .sf-job-title{font-size:14px}
.sf-job-dots{display:flex;gap:6px;margin-top:2px}
.sf-job-dots span{width:22px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--sf-accent) 22%,transparent)}
.sf-job-dots span[data-state=done]{background:var(--sf-accent)}
.sf-job-dots span[data-state=now]{background:var(--sf-accent);animation:sf-blink 1.1s ease-in-out infinite}
.sf-job-bar{position:relative;height:2px;margin-top:4px;overflow:hidden;border-radius:1px;background:color-mix(in srgb,var(--sf-accent) 16%,transparent)}
.sf-job-bar::after{content:"";position:absolute;inset:0 auto 0 0;width:35%;background:var(--sf-accent);animation:sf-slide 1.4s ease-in-out infinite}
@keyframes sf-slide{0%{transform:translateX(-100%)}100%{transform:translateX(290%)}}
@keyframes sf-blink{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.sf-job-bar::after,.sf-job-dots span[data-state=now]{animation:none}}
.sf-content[data-busy]{opacity:.45;pointer-events:none;transition:opacity .2s}
.sf-job-icon{display:flex;align-items:center;justify-content:center;height:20px}
.sf-job[data-tone=done] .sf-job-icon{color:var(--sf-green)}
.sf-job[data-tone=partial] .sf-job-icon{color:var(--sf-yellow)}
.sf-job[data-tone=error] .sf-job-icon{color:var(--sf-red)}
.sf-job-main{display:flex;flex-direction:column;gap:4px;min-width:0}
.sf-job-title{font-size:13px;font-weight:600;line-height:20px}
.sf-job-step{font-size:12.5px;line-height:20px;overflow-wrap:anywhere}
.sf-job-detail{color:var(--sf-fg2);overflow-wrap:anywhere;white-space:pre-wrap;-webkit-user-select:text;user-select:text}
.sf-job-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.sf-job-fallback{display:flex;flex-direction:column;gap:2px;margin-top:4px;color:var(--sf-fg2)}
.sf-job-url{display:flex;align-items:center;gap:2px;min-width:0}
.sf-job-url code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--sf-mono);font-size:11px;-webkit-user-select:text;user-select:text}
.sf-pulse{position:relative;width:8px;height:8px;border-radius:50%;background:var(--sf-accent)}
.sf-pulse::after{content:"";position:absolute;inset:-5px;border:1px solid var(--sf-accent);border-radius:50%;opacity:0;animation:sf-pulse 1.8s ease-out infinite}
@keyframes sf-pulse{0%{transform:scale(.45);opacity:.75}100%{transform:scale(1.15);opacity:0}}
@media (prefers-reduced-motion:reduce){.sf-pulse::after{animation:none}.sf-step-caret{transition:none}}
.sf-legs{display:flex;flex-direction:column;gap:8px;margin-top:2px}
.sf-leg{display:grid;grid-template-columns:minmax(0,auto) auto minmax(0,1fr);align-items:center;column-gap:8px;row-gap:2px}
.sf-leg-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-leg-charged{justify-self:end;white-space:nowrap}
.sf-leg .sf-links,.sf-leg-error{grid-column:1 / -1}
.sf-leg-error{color:var(--sf-red);font-size:11.5px;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.sf-leg-inline{display:flex;flex-wrap:wrap;align-items:center;gap:12px}

/* Scrolling body */
.sf-scroll{flex:1;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:14px 8px 28px 16px}
.sf-content{display:flex;flex-direction:column;gap:14px;transition:opacity .12s ease}
.sf-root[data-page] .sf-content,.sf-root[data-page] .sf-header,.sf-root[data-page] .sf-job{width:min(100%,46rem);margin-left:auto;margin-right:auto}
.sf-content[data-pending]{opacity:.45;pointer-events:none}
.sf-loading{display:flex;flex-direction:column;gap:18px;padding-top:4px}
.sf-loading-row{display:flex;align-items:center;gap:12px}
.sf-failed{display:grid;place-items:center;min-height:100%;padding:24px 8px}
.sf-failed-actions{display:flex;justify-content:center}

/* Steps */
.sf-steps{display:flex;flex-direction:column}
.sf-step{display:grid;grid-template-columns:20px minmax(0,1fr);column-gap:12px}
.sf-step-marker{grid-column:1;grid-row:1;display:grid;place-items:center;width:20px;height:20px;margin-top:4px;border-radius:3px;box-shadow:inset 0 0 0 1px var(--sf-line);color:var(--sf-fg2);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1}
.sf-step[data-status=current] .sf-step-marker{background:var(--sf-fg);box-shadow:none;color:var(--background)}
.sf-step[data-status=done] .sf-step-marker{background:color-mix(in srgb,var(--sf-accent) 14%,transparent);box-shadow:none;color:var(--sf-accent)}
.sf-step[data-status=locked] .sf-step-marker{color:var(--sf-fg3)}
.sf-step-head{grid-column:2;grid-row:1;display:flex;align-items:center;gap:8px;width:100%;min-height:28px;margin:0;padding:0;border:0;border-radius:2px;background:none;color:inherit;font:inherit;text-align:left}
button.sf-step-head{cursor:pointer}
.sf-step-title{flex:none;font-size:13px;font-weight:600}
.sf-step[data-status=locked] .sf-step-title{color:var(--sf-fg3);font-weight:500}
.sf-step-summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--sf-fg3);font-size:11px}
.sf-step-summary .sf-sym{font-size:inherit;color:inherit}
.sf-summary-nums{display:inline-flex;gap:10px}
.sf-step-caret{flex:none;margin-left:auto;color:var(--sf-fg3);transition:transform .12s ease}
.sf-step-summary + .sf-step-caret{margin-left:0}
.sf-step-head[aria-expanded=true] .sf-step-caret{transform:rotate(90deg)}
button.sf-step-head:hover .sf-step-caret{color:var(--sf-fg)}
.sf-step-rail{grid-column:1;grid-row:2;justify-self:center;width:1px;min-height:10px;margin:4px 0;background:var(--sf-line)}
.sf-step:last-child .sf-step-rail{visibility:hidden}
.sf-step-body{grid-column:2;grid-row:2;display:flex;flex-direction:column;gap:10px;min-width:0}
.sf-step-body:not(:empty){padding:4px 0 18px}
.sf-step:last-child .sf-step-body:not(:empty){padding-bottom:4px}

/* Step 1 */
.sf-wallet{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.sf-switch-open{margin-top:10px}
.sf-switch-open:disabled{opacity:.5;cursor:default}
.sf-switch{display:flex;flex-direction:column;gap:10px;margin-top:12px;padding:12px;border:1px solid var(--sf-line);border-radius:6px;background:var(--sf-wash)}
.sf-switch-title,.sf-earlier-title{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--sf-fg2)}
.sf-earlier{display:flex;flex-direction:column;gap:6px;margin-top:4px}
.sf-earlier-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0}
.sf-earlier-list > li{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;padding:0;list-style:none}
.sf-wallet-main{display:flex;flex-direction:column;align-items:flex-start;gap:10px;min-width:0}
.sf-address{display:block;max-width:25ch;font-family:var(--sf-mono);font-size:12px;font-variant-ligatures:none;line-height:1.6;-webkit-user-select:text;user-select:text}
.sf-address span{display:inline-block;margin-right:.45ch}
.sf-qr{flex:none;display:block;width:96px;height:96px;border-radius:4px;box-shadow:0 0 0 1px var(--sf-line)}

/* Step 2 */
.sf-fund-address{display:flex;align-items:center;gap:8px;min-width:0}
.sf-badges{flex:none;display:flex;gap:4px}
.sf-nets{display:flex;flex-direction:column;border-block:1px solid var(--sf-line)}
.sf-net{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:12px;row-gap:4px;padding:8px 0}
.sf-net + .sf-net{border-top:1px solid var(--sf-line)}
.sf-net-id{display:flex;flex-direction:column;gap:2px;min-width:0}
.sf-net-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-net-figures{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.sf-net-balance{display:flex;align-items:center;min-height:18px}
.sf-net-balance .sf-num{font-size:13px}
.sf-net-token{color:var(--sf-fg2)}
.sf-net-asof{min-height:16px;color:var(--sf-fg3);font-size:11px;white-space:nowrap}
.sf-net-error{grid-column:1 / -1}

/* Step 3 */
.sf-form{display:flex;flex-direction:column;gap:12px}
.sf-field{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 10px}
.sf-field .sf-field-error{grid-column:1 / -1;text-align:right}
.sf-days{width:var(--sf-cap-w)}
.sf-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
.sf-col{display:flex;flex-direction:column;gap:8px;min-width:0;padding-top:10px;border-top:1px solid var(--sf-line)}
.sf-col-title{font-weight:600}
.sf-cap{display:grid;grid-template-columns:minmax(0,1fr) var(--sf-cap-w);align-items:center;gap:3px 8px}
.sf-cap .sf-hint,.sf-cap .sf-field-error{grid-column:1 / -1;text-align:right}
.sf-token{display:grid;grid-template-columns:16px minmax(0,1fr) var(--sf-input-w);align-items:center;gap:3px 8px}
.sf-token .sf-field-error{grid-column:1 / -1;text-align:right}
.sf-token-name{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;min-width:0;cursor:pointer}
.sf-token-name .sf-dim{font-size:11px;white-space:nowrap}
.sf-num-input{font-family:var(--sf-mono);font-variant-numeric:tabular-nums;text-align:right}
.sf-mono-input{font-family:var(--sf-mono);font-variant-ligatures:none}
.sf-invalid{border-color:var(--sf-red)}
.sf-field-error{color:var(--sf-red);font-size:11px;line-height:1.4}
.sf-submit{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}
.sf-submit .sf-hint{flex:1 1 140px;min-width:0}
.sf-review{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:4px;background:var(--sf-wash)}
.sf-review-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.sf-review-name{color:var(--sf-fg2);font-weight:600;margin-bottom:2px}
.sf-scope{display:flex;flex-direction:column;gap:2px;-webkit-user-select:text;user-select:text}
.sf-scope li{position:relative;padding-left:12px;overflow-wrap:anywhere}
.sf-scope li::before{content:"";position:absolute;left:1px;top:.62em;width:4px;height:4px;border-radius:1px;background:var(--sf-fg3)}
@container sf (min-width:440px){
  .sf-form{--sf-input-w:96px;--sf-cap-w:136px}
  .sf-cols{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
}

/* Step 4 */
.sf-costs{display:flex;flex-direction:column}
.sf-cost{display:flex;flex-direction:column;gap:6px;padding:10px 0;border-top:1px solid var(--sf-line)}
.sf-cost:last-child{border-bottom:1px solid var(--sf-line)}
.sf-cost-head{display:flex;align-items:center;gap:8px}
.sf-cost-head label{cursor:pointer}
.sf-cost .sf-kv,.sf-cost .sf-alert{padding-left:24px}
.sf-cost[data-off] .sf-kv{opacity:.55}
.sf-kv{display:flex;flex-direction:column;gap:3px}
.sf-kv > div{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.sf-kv dt{display:flex;align-items:center;gap:6px;color:var(--sf-fg2);white-space:nowrap}
.sf-kv dd{min-width:0;text-align:right}
.sf-kv-total dt{color:var(--sf-fg);font-weight:600}
.sf-confirm-list{display:flex;flex-direction:column;border-block:1px solid var(--sf-line)}
.sf-confirm-list li{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:8px 0}
.sf-confirm-list li + li{border-top:1px solid var(--sf-line)}

/* Agent sessions */
.sf-live{display:flex;flex-direction:column;gap:10px;padding-top:14px;border-top:1px solid var(--sf-line)}
.sf-section-title{font-size:13px;font-weight:600}
.sf-cards{display:flex;flex-direction:column;gap:12px}
.sf-section{margin:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--sf-fg2)}
.sf-card > .sf-section{margin-top:6px}
.sf-plays{display:flex;flex-direction:column;gap:6px;margin-top:6px;padding:10px 12px 4px;border:1px solid var(--sf-line);border-radius:6px;background:var(--sf-wash)}
.sf-plays[data-stage=start] .sf-section{color:var(--sf-accent);font-size:12px}
.sf-plays[data-stage=start]{margin-top:2px;padding:10px 12px 4px;border:1px solid color-mix(in srgb,var(--sf-accent) 45%,transparent);border-radius:6px;background:color-mix(in srgb,var(--sf-accent) 7%,transparent)}
.sf-card[data-net=bnb]{--sf-net:#e0a800}
.sf-card[data-net=ethereum]{--sf-net:#627eea}
.sf-card[data-net]{border-left:2px solid color-mix(in srgb,var(--sf-net) 55%,transparent)}
.sf-card-net{display:inline-flex;align-items:center;gap:6px}
.sf-net-dot{width:8px;height:8px;border-radius:50%;background:var(--sf-net,var(--sf-fg3))}
.sf-more{border-top:1px solid var(--sf-line);padding-top:8px}
.sf-more summary{cursor:pointer;color:var(--sf-fg2);font-size:12px;list-style-position:inside}
.sf-more[open] summary{margin-bottom:6px}
.sf-plays-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}
.sf-play-list{display:flex;flex-direction:column;gap:0;margin:0;padding:0;list-style:none}
.sf-play{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:1px solid color-mix(in srgb,var(--sf-line) 60%,transparent)}
.sf-play:first-child{border-top:0}
.sf-play-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.sf-play-title{font-size:12.5px;font-weight:600}
.sf-play-blurb{color:var(--sf-fg2);font-size:12px;line-height:1.4}
.sf-play-fields{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px}
.sf-play-field{width:150px}
.sf-play-field:nth-of-type(2){width:104px}
.sf-play-note{color:var(--sf-accent);font-size:11.5px;margin-top:2px}
.sf-play-actions{flex:none;display:flex;flex-direction:column;gap:4px;align-items:stretch}
.sf-card{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px;border:1px solid var(--sf-line);border-radius:4px}
.sf-card-head{display:flex;align-items:center;gap:10px;min-height:22px}
.sf-card-net{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
.sf-card-status{flex:none;display:inline-flex;align-items:center;gap:6px;margin-right:auto;color:var(--sf-fg2)}
.sf-card-expiry{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:0 12px}
.sf-card[data-status=revoked] .sf-scope,.sf-card[data-status=expired] .sf-scope{color:var(--sf-fg3)}
.sf-card-foot{display:flex;flex-direction:column;gap:4px}
.sf-card-key{display:flex;align-items:center;gap:8px;min-width:0}
.sf-positions{display:flex;flex-direction:column;margin-top:2px;border-top:1px solid var(--sf-line)}
.sf-pos{display:flex;flex-direction:column;gap:6px;padding-top:10px}
.sf-pos + .sf-pos{margin-top:10px;border-top:1px solid var(--sf-line)}
.sf-pos-head{display:flex;align-items:center;gap:8px}
.sf-pos-pair{font-weight:600}
.sf-pos-fee{margin-right:auto;color:var(--sf-fg2);font-family:var(--sf-mono);font-size:11.5px}
.sf-range{position:relative;height:14px;margin:2px 0 0}
.sf-range::before{content:"";position:absolute;left:0;right:0;top:6px;height:2px;border-radius:1px;background:var(--sf-line)}
.sf-range-band{position:absolute;left:14%;right:14%;top:4px;height:6px;border-radius:2px;background:color-mix(in srgb,var(--sf-fg3) 45%,transparent)}
.sf-range[data-in] .sf-range-band{background:color-mix(in srgb,var(--sf-green) 40%,transparent)}
.sf-range-mark{position:absolute;top:0;width:2px;height:14px;margin-left:-1px;border-radius:1px;background:var(--sf-yellow)}
.sf-range[data-in] .sf-range-mark{background:var(--sf-green)}
.sf-pos-prices{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:start;gap:8px;color:var(--sf-fg2);-webkit-user-select:text;user-select:text}
.sf-pos-prices > :nth-child(2){text-align:center;align-items:center}
.sf-pos-prices > :last-child{text-align:right;align-items:flex-end}
.sf-pos-current{display:flex;flex-direction:column;align-items:flex-start;color:var(--sf-fg)}
.sf-pos-current .sf-dim{font-size:11px;white-space:nowrap}
.sf-ledger{display:grid;column-gap:14px;row-gap:3px;align-items:baseline}
.sf-ledger > div{display:contents}
.sf-ledger dt{color:var(--sf-fg2);white-space:nowrap}
.sf-ledger dd{min-width:0;overflow:hidden;text-align:right}
.sf-ledger .sf-amt{max-width:100%}
.sf-ledger .sf-num{min-width:0;overflow:hidden;text-overflow:ellipsis}
.sf-pos-foot{display:flex;flex-wrap:wrap;gap:0 10px;font-size:11px}
.sf-empty{margin-top:2px;padding-top:10px;border-top:1px solid var(--sf-line);color:var(--sf-fg3)}

/* Dialog bodies */
.sf-dialog-shell{max-width:26rem}
.sf-stack{display:flex;flex-direction:column;gap:4px}
.sf-label-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.sf-assets{display:flex;flex-direction:column;border-block:1px solid var(--sf-line)}
.sf-asset{display:grid;grid-template-columns:14px minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;margin:0;padding:7px 2px;border:0;border-radius:2px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.sf-asset + .sf-asset{border-top:1px solid var(--sf-line)}
.sf-asset:disabled{cursor:default;opacity:.5}
.sf-asset-dot{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1px var(--sf-fg3)}
.sf-asset[aria-checked=true] .sf-asset-dot{box-shadow:inset 0 0 0 4px var(--sf-accent)}
.sf-asset:enabled:hover .sf-asset-dot{box-shadow:inset 0 0 0 1px var(--sf-fg)}
.sf-asset[aria-checked=true]:enabled:hover .sf-asset-dot{box-shadow:inset 0 0 0 4px var(--sf-accent)}
`;

// src/withdraw.tsx
import {
  Button as Button6,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input as Input3,
  SegmentedControl as SegmentedControl3
} from "@hermes/plugin-sdk";
import { useEffect as useEffect2, useId as useId4, useRef as useRef2, useState as useState7 } from "react";
import { jsx as jsx10, jsxs as jsxs10 } from "react/jsx-runtime";
function assetsOf(network2) {
  if (!network2) return [];
  const native = { symbol: network2.nativeSymbol, amount: network2.balances?.native ?? "" };
  return [native, ...network2.balances?.tokens ?? []];
}
var hasFunds = (network2) => assetsOf(network2).some((asset) => isPositive(asset.amount));
function WithdrawDialog(props) {
  const send = useAction();
  const { open } = props;
  const { clear } = send;
  useEffect2(() => {
    if (open) clear();
  }, [open, clear]);
  return /* @__PURE__ */ jsx10(Dialog, { onOpenChange: (next) => !next && !send.busy && props.onClose(), open, children: open ? /* @__PURE__ */ jsx10(WithdrawForm, { ...props, send }) : null });
}
function WithdrawForm({ onClose, address, networks, send }) {
  const { store } = usePane();
  const uid = useId4();
  const [networkKey, setNetworkKey] = useState7(() => (networks.find(hasFunds) ?? networks[0])?.key ?? "");
  const [symbol, setSymbol] = useState7(null);
  const [amount, setAmount] = useState7("");
  const [to, setTo] = useState7("");
  const [attempted, setAttempted] = useState7(false);
  const amountRef = useRef2(null);
  const network2 = networks.find((n) => n.key === networkKey);
  const assets = assetsOf(network2);
  const empty = (a) => isDecimal(a.amount) && !isPositive(a.amount);
  const pickable = assets.filter((a) => !empty(a));
  const asset = pickable.find((a) => a.symbol === symbol) ?? pickable[0];
  const isNative = asset !== void 0 && network2 !== void 0 && asset.symbol === network2.nativeSymbol;
  const known = asset !== void 0 && isDecimal(asset.amount);
  const isMax = amount.trim().toLowerCase() === "max";
  let amountError = null;
  if (isMax) amountError = null;
  else if (!isPositive(amount)) amountError = "Enter an amount above 0.";
  else if (asset && known && compareDecimal(amount, asset.amount) === 1) amountError = `More than the ${asset.symbol} balance.`;
  let toError = null;
  const target = to.trim();
  if (!isAddress(target)) toError = "Enter a 0x address with 40 hex characters.";
  else if (target.toLowerCase() === address.toLowerCase()) toError = "This is the wallet itself.";
  const pickAsset = (next) => {
    if (next === asset?.symbol) return;
    setSymbol(next);
    setAmount("");
  };
  const onAssetKey = (event) => {
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 || pickable.length === 0) return;
    event.preventDefault();
    const index = Math.max(0, pickable.findIndex((a) => a.symbol === asset?.symbol));
    const next = pickable[(index + step + pickable.length) % pickable.length];
    if (!next) return;
    pickAsset(next.symbol);
    event.currentTarget.querySelector(`[data-asset="${CSS.escape(next.symbol)}"]`)?.focus();
  };
  const submit = (event) => {
    event.preventDefault();
    setAttempted(true);
    if (!network2 || !asset || amountError || toError || send.busy) return;
    void send.run(() => store.post("/withdraw", { network: network2.key, asset: asset.symbol, amount: amount.trim(), to: target })).then((ok) => {
      if (ok) onClose();
    });
  };
  return /* @__PURE__ */ jsxs10(
    DialogContent,
    {
      className: "sf-dialog-shell",
      onOpenAutoFocus: (event) => {
        event.preventDefault();
        amountRef.current?.focus();
      },
      children: [
        /* @__PURE__ */ jsxs10(DialogHeader, { children: [
          /* @__PURE__ */ jsx10(DialogTitle, { children: "Withdraw" }),
          /* @__PURE__ */ jsx10(DialogDescription, { children: "You approve the withdrawal with your passkey in the browser." })
        ] }),
        /* @__PURE__ */ jsxs10("form", { className: "sf-dialog sf-form", id: `${uid}-form`, noValidate: true, onSubmit: submit, children: [
          /* @__PURE__ */ jsxs10("div", { className: "sf-field", children: [
            /* @__PURE__ */ jsx10("span", { className: "sf-label", children: "Network" }),
            /* @__PURE__ */ jsx10(
              SegmentedControl3,
              {
                onChange: (key) => {
                  setNetworkKey(key);
                  setSymbol(null);
                  setAmount("");
                },
                options: networks.map((n) => ({ id: n.key, label: n.name })),
                sizing: "content",
                value: networkKey
              }
            )
          ] }),
          /* @__PURE__ */ jsx10("div", { "aria-label": "Asset", className: "sf-assets", onKeyDown: onAssetKey, role: "radiogroup", children: assets.map((a) => {
            const selected = a.symbol === asset?.symbol;
            return /* @__PURE__ */ jsxs10(
              "button",
              {
                "aria-checked": selected,
                className: "sf-asset",
                "data-asset": a.symbol,
                disabled: empty(a),
                onClick: () => pickAsset(a.symbol),
                role: "radio",
                tabIndex: selected ? 0 : -1,
                type: "button",
                children: [
                  /* @__PURE__ */ jsx10("span", { className: "sf-asset-dot" }),
                  /* @__PURE__ */ jsx10("span", { className: "sf-strong", children: a.symbol }),
                  isDecimal(a.amount) ? /* @__PURE__ */ jsx10(Num, { value: a.amount }) : /* @__PURE__ */ jsx10("span", { className: "sf-dim", children: "balance not read" })
                ]
              },
              a.symbol
            );
          }) }),
          /* @__PURE__ */ jsxs10("div", { className: "sf-stack", children: [
            /* @__PURE__ */ jsxs10("div", { className: "sf-label-row", children: [
              /* @__PURE__ */ jsx10("label", { className: "sf-label", htmlFor: `${uid}-amount`, children: "Amount" }),
              asset && known && isPositive(asset.amount) ? /* @__PURE__ */ jsx10(Button6, { onClick: () => setAmount(isNative ? "max" : asset.amount), size: "inline", type: "button", variant: "text", children: "Max" }) : null
            ] }),
            /* @__PURE__ */ jsx10(
              Input3,
              {
                "aria-describedby": attempted && amountError ? `${uid}-amount-error` : void 0,
                "aria-invalid": attempted && amountError ? true : void 0,
                className: "sf-num-input",
                containerClassName: attempted && amountError ? "sf-invalid" : void 0,
                id: `${uid}-amount`,
                inputMode: "text",
                onChange: (e) => setAmount(e.target.value),
                placeholder: "0.0",
                ref: amountRef,
                suffix: asset?.symbol,
                value: amount
              }
            ),
            attempted && amountError ? /* @__PURE__ */ jsx10("span", { className: "sf-field-error", id: `${uid}-amount-error`, role: "alert", children: amountError }) : null,
            isNative ? /* @__PURE__ */ jsx10("span", { className: "sf-hint", children: isMax ? "Sends everything except the network fee." : "The network fee is paid from this balance. Max leaves it behind." }) : null
          ] }),
          /* @__PURE__ */ jsxs10("div", { className: "sf-stack", children: [
            /* @__PURE__ */ jsxs10("label", { className: "sf-label", htmlFor: `${uid}-to`, children: [
              "To address",
              network2 ? ` on ${network2.name}` : ""
            ] }),
            /* @__PURE__ */ jsx10(
              Input3,
              {
                "aria-describedby": attempted && toError ? `${uid}-to-error` : void 0,
                "aria-invalid": attempted && toError ? true : void 0,
                className: "sf-mono-input",
                id: `${uid}-to`,
                onChange: (e) => setTo(e.target.value),
                placeholder: "0x",
                value: to
              }
            ),
            attempted && toError ? /* @__PURE__ */ jsx10("span", { className: "sf-field-error", id: `${uid}-to-error`, role: "alert", children: toError }) : null
          ] }),
          send.error ? /* @__PURE__ */ jsx10(InlineError, { children: send.error }) : null
        ] }),
        /* @__PURE__ */ jsxs10(DialogFooter, { children: [
          /* @__PURE__ */ jsx10(Button6, { disabled: send.busy, onClick: onClose, type: "button", variant: "ghost", children: "Cancel" }),
          /* @__PURE__ */ jsx10(Button6, { disabled: !network2 || !asset, form: `${uid}-form`, loading: send.busy, type: "submit", children: "Withdraw" })
        ] })
      ]
    }
  );
}

// src/app.tsx
import { jsx as jsx11, jsxs as jsxs11 } from "react/jsx-runtime";
var CLOCK_MS = 3e4;
function pickDraft(fromState, fromGrant) {
  if (!fromGrant) return fromState;
  if (!fromState) return fromGrant;
  if (fromState.id === fromGrant.id) return fromState;
  const a = parseTime(fromState.createdAt);
  const b = parseTime(fromGrant.createdAt);
  return a !== null && b !== null && b > a ? fromGrant : fromState;
}
function LoadingBody() {
  return /* @__PURE__ */ jsx11("div", { "aria-busy": "true", "aria-label": "Loading the wallet", className: "sf-loading", role: "status", children: [168, 96, 132, 104].map((width, i) => /* @__PURE__ */ jsxs11("div", { className: "sf-loading-row", children: [
    /* @__PURE__ */ jsx11(Skeleton3, { style: { width: 20, height: 20 } }),
    /* @__PURE__ */ jsx11(Skeleton3, { style: { width, height: 14 } })
  ] }, i)) });
}
function FailedBody({ title, message, onRetry }) {
  const retry = useAction();
  return /* @__PURE__ */ jsx11("div", { className: "sf-failed", children: /* @__PURE__ */ jsx11(ErrorState, { description: message, title, children: /* @__PURE__ */ jsx11("div", { className: "sf-failed-actions", children: /* @__PURE__ */ jsx11(Button7, { loading: retry.busy, onClick: () => void retry.run(onRetry), size: "sm", type: "button", variant: "outline", children: "Try again" }) }) }) });
}
function Steps({ state, draft, onDraft, onWithdraw }) {
  const { wallet, networks, preset: preset2, mode } = state;
  const address = wallet?.address ?? null;
  const anyActive = networks.some((n) => n.session?.status === "active");
  const funded = networks.some((n) => n.balances !== null && isPositive(n.balances.native));
  const done = [address !== null, address !== null && funded, address !== null && (draft !== null || anyActive), anyActive];
  const blocked = [
    void 0,
    address === null ? "Needs a wallet" : void 0,
    address === null ? "Needs a wallet" : void 0,
    address === null ? "Needs a wallet" : draft === null ? anyActive && activateSummary(networks) || "Needs reviewed permissions" : void 0
  ];
  const current = done.findIndex((isDone, i) => !isDone && !blocked[i]);
  const statusOf2 = (i) => done[i] ? "done" : blocked[i] ? "locked" : i === current ? "current" : "todo";
  const defaults = [true, address !== null, address !== null && !anyActive, draft !== null && !anyActive];
  const [toggled, setToggled] = useRemembered(
    `open:${mode}:${address ?? ""}:${anyActive ? "live" : "setup"}`,
    () => ({})
  );
  const isOpen = (i) => toggled[i] ?? defaults[i] ?? false;
  const toggle = (i) => () => setToggled((prev) => ({ ...prev, [i]: !(prev[i] ?? defaults[i] ?? false) }));
  return /* @__PURE__ */ jsxs11("ol", { className: "sf-steps", children: [
    /* @__PURE__ */ jsx11(Step, { n: 1, onToggle: toggle(0), open: isOpen(0), status: statusOf2(0), summary: walletSummary(address), title: "Create Smart Agentic Wallet", children: /* @__PURE__ */ jsx11(WalletStep, { address, networks, onSwitched: () => onDraft(null), others: state.otherWallets }) }),
    /* @__PURE__ */ jsx11(
      Step,
      {
        blocked: blocked[1],
        n: 2,
        onToggle: toggle(1),
        open: isOpen(1),
        status: statusOf2(1),
        summary: fundSummary(networks),
        title: "Fund",
        children: address !== null ? /* @__PURE__ */ jsx11(FundStep, { address, networks, onWithdraw }) : null
      }
    ),
    /* @__PURE__ */ jsx11(
      Step,
      {
        blocked: blocked[2],
        n: 3,
        onToggle: toggle(2),
        open: isOpen(2),
        status: statusOf2(2),
        summary: permissionsSummary(preset2, draft),
        title: "Set permissions",
        children: /* @__PURE__ */ jsx11(
          PermissionsStep,
          {
            draft,
            onDraft: (next) => {
              onDraft(next);
              if (next) setToggled((prev) => ({ ...prev, 3: true }));
            },
            state
          },
          `${mode}:${preset2.id}`
        )
      }
    ),
    /* @__PURE__ */ jsx11(
      Step,
      {
        blocked: blocked[3],
        n: 4,
        onToggle: toggle(3),
        open: isOpen(3),
        status: statusOf2(3),
        summary: activateSummary(networks),
        title: "Activate",
        children: draft !== null ? /* @__PURE__ */ jsx11(ActivateStep, { draft, onActivated: () => onDraft(null), state }, draft.id) : null
      }
    )
  ] });
}
function Pane({ ctx, store, page = false }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { state, error, loading } = snapshot;
  const rootRef = useRef3(null);
  const [now, setNow] = useState8(() => Date.now());
  const [pendingMode, setPendingMode] = useState8(null);
  const [grantDraft, setGrantDraft] = useState8(null);
  const [withdrawing, setWithdrawing] = useState8(false);
  useEffect3(
    () => store.attach(() => {
      const el = rootRef.current;
      if (!el || typeof el.checkVisibility !== "function") return true;
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }),
    [store]
  );
  useEffect3(() => ctx.setInterval(() => setNow(Date.now()), CLOCK_MS), [ctx]);
  useEffect3(() => setNow(Date.now()), [state]);
  const switchMode = useCallback2(
    async (mode2) => {
      setPendingMode(mode2);
      try {
        await store.post("/mode", { mode: mode2 });
      } finally {
        setPendingMode(null);
      }
    },
    [store]
  );
  const job2 = state?.job ?? null;
  const locked = jobIsActive(job2) || pendingMode !== null;
  const env = useMemo2(() => ({ store, now, locked }), [store, now, locked]);
  const draft = state ? pickDraft(state.draft, grantDraft && grantDraft.mode === state.mode ? grantDraft.draft : null) : null;
  const mode = state?.mode ?? null;
  const onDraft = useCallback2(
    (next) => setGrantDraft(next && mode ? { mode, draft: next } : null),
    [mode]
  );
  const working = state?.networks.some((n) => n.session?.status === "active") ?? false;
  let body;
  if (error?.forbidden) {
    body = /* @__PURE__ */ jsx11(FailedBody, { message: error.message, onRetry: store.refresh, title: "Local Desktop only" });
  } else if (!state) {
    body = loading || !error ? /* @__PURE__ */ jsx11(LoadingBody, {}) : /* @__PURE__ */ jsx11(FailedBody, { message: error.message, onRetry: store.refresh, title: "Wallet not loaded" });
  } else {
    body = /* @__PURE__ */ jsxs11("div", { className: "sf-content", "data-busy": jobIsActive(job2) || void 0, "data-pending": pendingMode !== null || void 0, children: [
      error ? /* @__PURE__ */ jsxs11(Warning, { children: [
        "Not refreshed. ",
        error.message
      ] }) : null,
      working ? /* @__PURE__ */ jsx11(LiveSection, { networks: state.networks }) : null,
      /* @__PURE__ */ jsx11(Steps, { draft, onDraft, onWithdraw: () => setWithdrawing(true), state }),
      working ? null : /* @__PURE__ */ jsx11(LiveSection, { networks: state.networks })
    ] });
  }
  return /* @__PURE__ */ jsxs11(PaneContext.Provider, { value: env, children: [
    /* @__PURE__ */ jsx11("style", { children: PANE_CSS }),
    /* @__PURE__ */ jsxs11("div", { className: "sf-root", "data-mode": pendingMode ?? mode ?? void 0, "data-page": page || void 0, ref: rootRef, children: [
      /* @__PURE__ */ jsx11(Header, { disabled: jobIsActive(job2), loading, mode, onSwitch: switchMode, pending: pendingMode }),
      job2 && !error?.forbidden ? /* @__PURE__ */ jsx11(JobBanner, { job: job2, networks: state?.networks ?? [], openFailed: snapshot.passkeyOpenFailed }) : null,
      /* @__PURE__ */ jsx11("div", { className: "sf-scroll", children: body }),
      state?.wallet ? /* @__PURE__ */ jsx11(
        WithdrawDialog,
        {
          address: state.wallet.address,
          networks: state.networks,
          onClose: () => setWithdrawing(false),
          open: withdrawing
        }
      ) : null
    ] })
  ] });
}

// src/plugin.tsx
import { jsx as jsx12 } from "react/jsx-runtime";
var PANE_WIDTH = "26rem";
var PANE_MIN_WIDTH = "20rem";
var PANE_MAX_WIDTH = "36rem";
var PAGE_PATH = "/sovereign-finance";
var plugin = {
  id: PLUGIN_ID,
  name: "Sovereign Finance",
  description: "A Smart Agentic Wallet on BNB Chain and Ethereum. Self-custodial. Your passkey is the admin key. The agent holds a session key with onchain limits. Powered by Altana.",
  register(ctx) {
    const store = createStore(ctx);
    ctx.register({
      id: PANE_ID,
      area: "panes",
      title: "Sovereign Finance",
      // A right-hand side panel with a bounded width, so it never takes the chat's place.
      data: {
        placement: "right",
        collapsible: true,
        dock: { pane: "workspace", pos: "right" },
        width: PANE_WIDTH,
        minWidth: PANE_MIN_WIDTH,
        maxWidth: PANE_MAX_WIDTH
      },
      render: () => /* @__PURE__ */ jsx12(Pane, { ctx, store })
    });
    ctx.register({
      id: "page",
      area: "routes",
      title: "Sovereign Finance",
      data: { path: PAGE_PATH },
      render: () => /* @__PURE__ */ jsx12(Pane, { ctx, page: true, store })
    });
    ctx.register({
      id: "nav",
      area: "sidebar.nav",
      title: "Sovereign Finance",
      data: { codicon: "credit-card", label: "Sovereign Finance", path: PAGE_PATH }
    });
  }
};
var plugin_default = plugin;
export {
  plugin_default as default
};
