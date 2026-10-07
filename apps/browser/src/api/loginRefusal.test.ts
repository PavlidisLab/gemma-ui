/**
 * A 403 on POST /rest/v2/login can come from three layers, and the
 * sign-in dialog has to tell them apart: off-network users were being
 * told to restart a Vite dev server because every 403 was labelled CORS.
 * Bodies below are verbatim from gemma.msl.ubc.ca, 2026-10-07.
 */
import { describe, expect, it } from "vitest";

import { classifyLoginRefusal } from "./auth";

// Apache, refusing a POST from outside conf.d/msl-networks.include.
const APACHE_403 = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">
<html><head>
<title>403 Forbidden</title>
</head><body>
<h1>Forbidden</h1>
<p>You don't have permission to access this resource.</p>
</body></html>`;

// Tomcat's CorsFilter, for a POST carrying a foreign Origin.
const TOMCAT_CORS_403 =
  '<!doctype html><html lang="en"><head><title>HTTP Status 403 – Forbidden</title></head><body><h1>HTTP Status 403 – Forbidden</h1><hr class="line" /><p><b>Type</b> Status Report</p><p><b>Message</b> Invalid CORS request</p><p><b>Description</b> The server understood the request but refuses to authorize it.</p><hr class="line" /><h3>Apache Tomcat/10.1.59</h3></body></html>';

describe("classifyLoginRefusal", () => {
  it("reads Apache's stock 403 as the off-network block", () => {
    expect(classifyLoginRefusal(APACHE_403)).toBe("off-network");
  });

  it("reads Tomcat's 'Invalid CORS request' as CORS", () => {
    expect(classifyLoginRefusal(TOMCAT_CORS_403)).toBe("cors");
  });

  it("leaves Gemma's own refusals and empty bodies to Gemma", () => {
    expect(classifyLoginRefusal("Access is denied")).toBe("gemma");
    expect(classifyLoginRefusal("")).toBe("gemma");
  });
});
