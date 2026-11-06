import { test, expect, Page, Route } from "@playwright/test";

const REGISTRY_UI_URL: string = process.env["REGISTRY_UI_URL"] || "http://localhost:8888";

const ARTIFACT_PATH = "/apis/registry/v3/groups/default/artifacts/test-artifact";

const SUBMITTED = "{\"type\":\"record\",\"name\":\"User\",\"fields\":[{\"name\":\"a\",\"type\":\"string\"},{\"name\":\"b\",\"type\":\"string\"}]}";

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/**
 * Mocks every registry call the artifact, group, search and dashboard pages make, and rejects a new
 * artifact or a new version with the given rule violation body.
 */
const EXISTING = "{\"type\":\"record\",\"name\":\"User\",\"fields\":[{\"name\":\"a\",\"type\":\"string\"}]}";

const mockRegistry = async (page: Page, violation: unknown, status: number = 400): Promise<void> => {
    await page.route("**/apis/registry/v3/**", async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path.endsWith("/system/uiConfig")) {
            return json(route, 200, {
                ui: { contextPath: "/", navPrefixPath: "/" },
                auth: { type: "none", rbacEnabled: false, obacEnabled: false },
                features: { readOnly: false, breadcrumbs: true }
            });
        }
        if (path === ARTIFACT_PATH) {
            return json(route, 200, { artifactId: "test-artifact", artifactType: "AVRO", owner: "", createdOn: "2026-10-01T00:00:00Z" });
        }
        if (path === `${ARTIFACT_PATH}/rules`) {
            return json(route, 200, ["COMPATIBILITY"]);
        }
        if (path === `${ARTIFACT_PATH}/rules/COMPATIBILITY`) {
            return json(route, 200, { ruleType: "COMPATIBILITY", config: "BACKWARD" });
        }
        if (path === `${ARTIFACT_PATH}/versions/1`) {
            return json(route, 200, { artifactId: "test-artifact", artifactType: "AVRO", version: "1", state: "ENABLED", globalId: 1, contentId: 1 });
        }
        if (path === `${ARTIFACT_PATH}/versions/1/content`) {
            return route.fulfill({ status: 200, contentType: "application/json", body: EXISTING });
        }
        if (path === `${ARTIFACT_PATH}/versions/1/comments`) {
            return json(route, 200, []);
        }
        if (path.endsWith("/admin/config/artifactTypes")) {
            return json(route, 200, [{ name: "AVRO" }, { name: "JSON" }]);
        }
        if (path.endsWith("/search/artifacts") || path.endsWith("/search/groups")) {
            return json(route, 200, { count: 0, artifacts: [], groups: [] });
        }
        if (path.endsWith("/search/versions")) {
            return json(route, 200, {
                count: 1,
                versions: [{ artifactId: "test-artifact", artifactType: "AVRO", version: "1", state: "ENABLED", globalId: 1, contentId: 1 }]
            });
        }
        if (request.method() === "POST"
            && (path === `${ARTIFACT_PATH}/versions` || path === "/apis/registry/v3/groups/default/artifacts")) {
            return json(route, status, violation);
        }
        return json(route, 404, { status: 404, title: "Not mocked", name: "NotFoundException" });
    });
};

const submitNewVersion = async (page: Page, content: string = SUBMITTED): Promise<void> => {
    await page.goto(`${REGISTRY_UI_URL}/explore/default/test-artifact`);
    await expect(page).toHaveTitle(/Apicurio Registry/);
    await page.getByTestId("btn-create-version").click();
    await page.getByTestId("form-version-content").locator("textarea").fill(content);
    await page.getByTestId("modal-btn-create").click();
};

/** Walks the create artifact wizard: coordinates, metadata, content, references, version metadata. */
const submitNewArtifact = async (page: Page): Promise<void> => {
    await page.getByTestId("create-artifact-modal-id").fill("new-artifact");
    const next = page.getByRole("button", { name: "Next" });
    await next.click();
    await next.click();
    await page.getByTestId("create-artifact-modal-file-upload").locator("textarea").fill(SUBMITTED);
    await next.click();
    await next.click();
    await page.getByRole("button", { name: "Create" }).click();
};

const ARTIFACT_VIOLATION = {
    status: 400,
    title: "Incompatible artifact: new-artifact [AVRO]",
    name: "RuleViolationException",
    causes: [{ description: "b", context: "/fields/1" }]
};

/** The report shows the cause and the content that was typed into the wizard. */
const expectReportWithSubmittedContent = async (page: Page): Promise<void> => {
    const groups = page.getByTestId("compatibility-report-group");
    await expect(groups).toHaveCount(1);
    await expect(groups.first().locator("b")).toHaveText("/fields/1");
    await expect(page.getByTestId("compatibility-report-content")).toContainText("\"name\":\"User\"");
};

const CREATE_ARTIFACT_ENTRY_POINTS = [
    { page: "Dashboard", path: "/dashboard", button: "quick-action-create" },
    { page: "Search", path: "/search", button: "empty-btn-create" },
    { page: "Group", path: "/explore/default", button: "btn-create-artifact" }
];

for (const entry of CREATE_ARTIFACT_ENTRY_POINTS) {
    test(`Compatibility report - a rejected new artifact from the ${entry.page} page shows the causes and the submitted content`, async ({ page }) => {
        await mockRegistry(page, ARTIFACT_VIOLATION);

        await page.goto(`${REGISTRY_UI_URL}${entry.path}`);
        await page.getByTestId(entry.button).click();
        await submitNewArtifact(page);

        await expectReportWithSubmittedContent(page);
    });
}

const CAUSES = [
    {
        description: "Field 'b' was added without a default value.",
        context: "/fields/1",
        direction: "BACKWARD",
        proposed: { pointer: "/fields/1" },
        existing: { pointer: "/fields", version: "1" }
    },
    {
        description: "The reader schema has no default for 'b'.",
        context: "/fields/1/type",
        direction: "BACKWARD",
        proposed: { pointer: "/fields/1" },
        existing: { pointer: "/fields", version: "1" }
    }
];

test("Compatibility report - a rejected new version lists the causes and shows the submitted content", async ({ page }) => {
    await mockRegistry(page, {
        status: 400,
        title: "Incompatible artifact: test-artifact [AVRO]",
        name: "RuleViolationException",
        // During 3.4 the server sends the causes in both places (#10518).
        ruleViolation: { ruleType: "COMPATIBILITY", causes: CAUSES },
        causes: CAUSES
    });

    await submitNewVersion(page);

    const report = page.getByTestId("compatibility-report");
    await expect(report).toBeVisible();

    // Both causes share a location, so they are listed under one group.
    const groups = report.getByTestId("compatibility-report-group");
    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toContainText("/fields/1");
    await expect(groups.first()).toContainText("Field 'b' was added without a default value.");
    await expect(groups.first()).toContainText("The reader schema has no default for 'b'.");
    await expect(groups.first()).toContainText("Breaks backward compatibility");

    // The content the user submitted is still there to look at.
    const content = report.getByTestId("compatibility-report-content");
    await expect(content).toContainText("Submitted content");
    await expect(content).toContainText("\"name\":\"b\"");
    await expect(report.getByTestId("compatibility-report-compare")).toHaveText("Compare with version 1");

    // The version the causes were found against can be put next to the submitted content.
    await report.getByTestId("compatibility-report-compare").click();
    await expect(content).toContainText("Submitted content compared with version 1");
    await expect(report.getByTestId("compatibility-report-compare")).toHaveText("Show submitted content only");
    // The diff fills the space below its toolbar rather than collapsing.
    const diffEditor = content.locator(".monaco-diff-editor");
    await expect(diffEditor.locator(".editor.original")).toContainText("\"name\":\"a\"");
    await expect(diffEditor.locator(".editor.modified")).toContainText("\"name\":\"b\"");
    const diffBox = await diffEditor.boundingBox();
    const editorAreaBox = await content.locator(".compatibility-report-editor").boundingBox();
    expect(diffBox!.height).toBeGreaterThan(200);
    expect(Math.round(editorAreaBox!.y + editorAreaBox!.height - (diffBox!.y + diffBox!.height))).toBeLessThanOrEqual(2);
});

test("Compatibility report - each cause is highlighted in the submitted content and, when comparing, in both versions", async ({ page }) => {
    await mockRegistry(page, {
        status: 400,
        title: "Incompatible artifact: test-artifact [AVRO]",
        ruleViolation: { ruleType: "COMPATIBILITY", causes: CAUSES },
        causes: CAUSES
    });

    await submitNewVersion(page);

    // Monaco draws an error marker as a squiggly decoration under the range.
    const content = page.getByTestId("compatibility-report-content");
    await expect(content.locator(".squiggly-error").first()).toBeVisible();

    await page.getByTestId("compatibility-report-compare").click();
    await expect(content).toContainText("Submitted content compared with version 1");
    await expect(content.locator(".editor.original .squiggly-error").first()).toBeVisible();
    await expect(content.locator(".editor.modified .squiggly-error").first()).toBeVisible();
});

const EXPLAINED_CODE = "READER_FIELD_MISSING_DEFAULT_VALUE";

test("Compatibility report - a cause with a code shows its explanation and an example on request, and a cause without one shows none", async ({ page }) => {
    const causes = [
        { ...CAUSES[0], code: EXPLAINED_CODE },
        { description: "The record was renamed.", context: "/name" }
    ];
    await mockRegistry(page, {
        status: 400,
        title: "Incompatible artifact: test-artifact [AVRO]",
        ruleViolation: { ruleType: "COMPATIBILITY", causes },
        causes
    });
    // The explanation endpoint (#10471) is mocked until it is merged.
    const explanationRequests: string[] = [];
    await page.route("**/apis/registry/v3/system/compatibility/**", route => {
        explanationRequests.push(new URL(route.request().url()).pathname);
        return json(route, 200, {
            code: EXPLAINED_CODE,
            description: "A field was added without a default value.",
            help: "A reader using the new schema cannot read old data, which has **no value** for the field.",
            examples: [{
                original: "{\"type\":\"record\",\"name\":\"R\",\"fields\":[]}",
                updated: "{\"type\":\"record\",\"name\":\"R\",\"fields\":[{\"name\":\"added\",\"type\":\"string\"}]}",
                direction: "BACKWARD",
                compatible: false
            }]
        });
    });

    await submitNewVersion(page);

    const groups = page.getByTestId("compatibility-report-group");
    await expect(groups).toHaveCount(2);
    // Only the cause with a code offers an explanation, and nothing is fetched until it is asked for.
    await expect(groups.nth(0).getByRole("button", { name: "Explain" })).toHaveCount(1);
    await expect(groups.nth(1).getByRole("button", { name: "Explain" })).toHaveCount(0);
    expect(explanationRequests).toEqual([]);

    await groups.nth(0).getByRole("button", { name: "Explain" }).click();

    const help = groups.nth(0).getByTestId("compatibility-report-explanation-help");
    await expect(help).toContainText("A reader using the new schema cannot read old data");
    await expect(help.locator("strong")).toHaveText("no value");
    const example = groups.nth(0).getByTestId("compatibility-report-example");
    await expect(example).toContainText("Incompatible (backward)");
    await expect(example.locator(".monaco-diff-editor .editor.modified")).toContainText("\"added\"");
    expect(explanationRequests).toEqual([`/apis/registry/v3/system/compatibility/AVRO/differences/${EXPLAINED_CODE}`]);
});

test("Compatibility report - testing content from the version page shows the causes and the tested content", async ({ page }) => {
    await mockRegistry(page, ARTIFACT_VIOLATION);

    await page.goto(`${REGISTRY_UI_URL}/explore/default/test-artifact/versions/1`);
    await page.getByTestId("version-actions-toggle").click();
    await page.getByTestId("action-test-version").click();
    await page.getByTestId("form-test-version-content").locator("textarea").fill(SUBMITTED);
    await page.getByTestId("modal-btn-test").click();

    await expectReportWithSubmittedContent(page);
});

test("Compatibility report - a version that passes the rules still opens the new version, with no report", async ({ page }) => {
    await mockRegistry(page, {
        groupId: "default", artifactId: "test-artifact", artifactType: "AVRO", version: "1", state: "ENABLED", globalId: 1, contentId: 1
    }, 200);

    await submitNewVersion(page);

    await expect(page).toHaveURL(/\/explore\/default\/test-artifact\/versions\/1$/);
    await expect(page.getByTestId("compatibility-report")).toHaveCount(0);
});

test("Compatibility report - an error that is not a rule violation still shows the page error", async ({ page }) => {
    await mockRegistry(page, {
        status: 409,
        title: "An artifact with ID 'new-artifact' in group 'default' already exists.",
        name: "ArtifactAlreadyExistsException"
    }, 409);

    await page.goto(`${REGISTRY_UI_URL}/dashboard`);
    await page.getByTestId("quick-action-create").click();
    await submitNewArtifact(page);

    await expect(page.getByText("Error creating artifact.")).toBeVisible();
    await expect(page.getByTestId("compatibility-report")).toHaveCount(0);
});

test("Compatibility report - the 3.5 body, with causes only under ruleViolation, still shows the report", async ({ page }) => {
    await mockRegistry(page, {
        status: 400,
        title: "Incompatible artifact: test-artifact [AVRO]",
        ruleViolation: { ruleType: "COMPATIBILITY", causes: [{ description: "b", context: "/fields/1" }] }
    });

    await submitNewVersion(page);

    const groups = page.getByTestId("compatibility-report-group");
    await expect(groups).toHaveCount(1);
    await expect(groups.first().locator("b")).toHaveText("/fields/1");
});

test("Compatibility report - without the new fields it shows the same rows as before", async ({ page }) => {
    // The body a 3.3 server sends: only description and context, no ruleType.
    await mockRegistry(page, {
        status: 400,
        title: "Incompatible artifact: test-artifact [AVRO]",
        name: "RuleViolationException",
        causes: [{ description: "b", context: "/fields/1" }]
    });

    await submitNewVersion(page);

    const groups = page.getByTestId("compatibility-report-group");
    await expect(groups).toHaveCount(1);
    await expect(groups.first().locator("b")).toHaveText("/fields/1");
    await expect(groups.first()).toContainText("b");
    await expect(page.getByTestId("compatibility-report-compare")).toHaveCount(0);
    await expect(page.getByTestId("compatibility-report-content")).toContainText("\"name\":\"User\"");
});

test("Compatibility report - a draft that fails to finalize shows its content, compared with the version the causes name", async ({ page }) => {
    await mockRegistry(page, undefined);
    // Routes added later take precedence over the ones in mockRegistry.
    await page.route("**/apis/registry/v3/system/uiConfig", route => json(route, 200, {
        ui: { contextPath: "/", navPrefixPath: "/" },
        auth: { type: "none", rbacEnabled: false, obacEnabled: false },
        features: { readOnly: false, breadcrumbs: true, draftMutability: true }
    }));
    await page.route("**/apis/registry/v3/search/versions*", route => json(route, 200, {
        count: 1,
        versions: [{ groupId: "default", artifactId: "test-artifact", artifactType: "AVRO", version: "2", state: "DRAFT", owner: "", createdOn: "2026-10-01T00:00:00Z" }]
    }));
    await page.route(`**${ARTIFACT_PATH}/versions/2/state*`, route => json(route, 400, {
        status: 400,
        title: "Incompatible artifact: test-artifact [AVRO]",
        name: "RuleViolationException",
        ruleViolation: { ruleType: "COMPATIBILITY", causes: CAUSES },
        causes: CAUSES
    }));
    // Holds the draft's content back until the test releases it.
    let releaseContent: () => void = () => {};
    const contentReleased = new Promise<void>(resolve => releaseContent = resolve);
    await page.route(`**${ARTIFACT_PATH}/versions/2/content`, async route => {
        await contentReleased;
        await route.fulfill({ status: 200, contentType: "application/json", body: SUBMITTED });
    });

    await page.goto(`${REGISTRY_UI_URL}/drafts`);
    await page.getByTestId("draft-actions-dropdown-0").click();
    await page.getByTestId("finalize-draft-0").click();
    await page.getByTestId("modal-btn-finalize").click();

    // While the draft's content loads, the wait modal stays up, so no other draft can be picked to finalize.
    await expect(page.getByText("Finalizing draft, please wait...")).toBeVisible();
    await expect(page.getByTestId("compatibility-report")).toHaveCount(0);
    releaseContent();

    const report = page.getByTestId("compatibility-report");
    await expect(report).toBeVisible();
    await expect(page.getByText("Finalizing draft, please wait...")).toHaveCount(0);
    const content = report.getByTestId("compatibility-report-content");
    await expect(content).toContainText("\"name\":\"b\"");

    // The comparison loads version 1 of the draft's own artifact.
    await report.getByTestId("compatibility-report-compare").click();
    await expect(content.locator(".monaco-diff-editor .editor.original")).toContainText("\"name\":\"a\"");
    await expect(content.locator(".monaco-diff-editor .editor.modified")).toContainText("\"name\":\"b\"");
});

const MANY_FIELDS = 20;

/** A record that adds 20 fields with no default, one per line group, so the last ones are far down. */
const LARGE_SUBMITTED: string = JSON.stringify({
    type: "record",
    name: "User",
    fields: [{ name: "a", type: "string" }, ...Array.from({ length: MANY_FIELDS }, (_, i) => ({
        name: `added${i + 1}`,
        type: "string",
        doc: `Field ${i + 1}, added without a default value.`
    }))]
}, null, 2);

const MANY_CAUSES = Array.from({ length: MANY_FIELDS }, (_, i) => ({
    description: `Field 'added${i + 1}' was added without a default value.`,
    context: `/fields/${i + 1}`,
    direction: "BACKWARD",
    proposed: { pointer: `/fields/${i + 1}` },
    existing: { pointer: "/fields", version: "1" }
}));

test("Compatibility report - with 20 causes, the list and the content stay side by side, and a location far down is shown next to it", async ({ page }) => {
    await mockRegistry(page, {
        status: 400,
        title: "Incompatible artifact: test-artifact [AVRO]",
        ruleViolation: { ruleType: "COMPATIBILITY", causes: MANY_CAUSES },
        causes: MANY_CAUSES
    });

    await submitNewVersion(page, LARGE_SUBMITTED);

    const report = page.getByTestId("compatibility-report");
    const groups = report.getByTestId("compatibility-report-group");
    await expect(groups).toHaveCount(MANY_FIELDS);
    const causes = report.getByLabel("Compatibility violations by location");
    const content = report.getByTestId("compatibility-report-content");
    const editor = content.locator(".monaco-editor");
    await expect(editor).toBeVisible();

    // The causes are on the left and the content on the right, both starting at the top of the report
    // (the causes panel has 8px of padding).
    const causesBox = (await causes.boundingBox())!;
    const contentBox = (await content.boundingBox())!;
    expect(causesBox.x + causesBox.width).toBeLessThanOrEqual(contentBox.x);
    expect(Math.round(causesBox.y - contentBox.y)).toBe(8);

    // The editor fits in the viewport, and scrolling the causes to the last one does not move it.
    const viewportHeight: number = page.viewportSize()!.height;
    const editorBefore = (await editor.boundingBox())!;
    expect(editorBefore.y + editorBefore.height).toBeLessThanOrEqual(viewportHeight);
    await groups.last().scrollIntoViewIfNeeded();
    expect((await editor.boundingBox())!.y).toBe(editorBefore.y);

    // The last field is below the editor's first screen until its location is clicked.
    const lastField = editor.locator(".view-line", { hasText: `"added${MANY_FIELDS}"` });
    await expect(lastField).toHaveCount(0);
    await groups.last().getByTestId("compatibility-report-location").click();
    await expect(lastField).toBeVisible();
    await expect(groups.last()).toBeInViewport();
});
