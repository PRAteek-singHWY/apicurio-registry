// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { markdownToSafeHtml } from "./markdown.utils";

describe("markdownToSafeHtml", () => {
    it("renders Markdown", () => {
        expect(markdownToSafeHtml("Lowering `maxLength` **rejects** longer strings."))
            .toBe("<p>Lowering <code>maxLength</code> <strong>rejects</strong> longer strings.</p>\n");
    });

    it("keeps an ordinary link", () => {
        expect(markdownToSafeHtml("[spec](https://json-schema.org)"))
            .toBe("<p><a href=\"https://json-schema.org\">spec</a></p>\n");
    });

    it("removes a script", () => {
        expect(markdownToSafeHtml("Text<script>alert(1)</script>")).toBe("<p>Text</p>\n");
    });

    it("removes an event handler", () => {
        expect(markdownToSafeHtml("<img src=\"x\" onerror=\"alert(1)\">")).toBe("<img src=\"x\">");
    });

    it("removes a javascript: link target", () => {
        expect(markdownToSafeHtml("[click](javascript:alert(1))")).toBe("<p><a>click</a></p>\n");
    });
});
