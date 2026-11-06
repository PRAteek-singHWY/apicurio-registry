import { afterEach, describe, expect, it, vi } from "vitest";

const { httpGet } = vi.hoisted(() => ({ httpGet: vi.fn() }));

vi.mock("@apitomy/common-ui-components", () => ({
    useAuth: () => ({})
}));

vi.mock("@services/useConfigService.ts", () => ({
    useConfigService: () => ({ artifactsUrl: () => "http://localhost:8080/apis/registry/v3" })
}));

vi.mock("@utils/rest.utils.ts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@utils/rest.utils.ts")>();
    return {
        ...actual,
        createAuthOptions: () => Promise.resolve({ headers: { Authorization: "Bearer token" } }),
        httpGet
    };
});

import { clearDifferenceExplanations, DifferenceExplanation, useCompatibilityService } from "./useCompatibilityService";

const EXPLANATION: DifferenceExplanation = {
    code: "STRING_TYPE_MAX_LENGTH_DECREASED",
    description: "The 'maxLength' string-length limit was decreased."
};

afterEach(() => {
    clearDifferenceExplanations();
    vi.clearAllMocks();
});

describe("useCompatibilityService", () => {
    it("asks for the explanation of a code, with the auth headers", async () => {
        httpGet.mockResolvedValue(EXPLANATION);

        const explanation = await useCompatibilityService().getDifferenceExplanation("JSON", "STRING_TYPE_MAX_LENGTH_DECREASED");

        expect(explanation).toEqual(EXPLANATION);
        expect(httpGet).toHaveBeenCalledWith(
            "http://localhost:8080/apis/registry/v3/system/compatibility/JSON/differences/STRING_TYPE_MAX_LENGTH_DECREASED",
            { headers: { Authorization: "Bearer token", Accept: "application/json" } });
    });

    it("escapes the artifact type and the code in the path", async () => {
        httpGet.mockResolvedValue(EXPLANATION);

        await useCompatibilityService().getDifferenceExplanation("MY TYPE", "A/B");

        expect(httpGet.mock.calls[0][0]).toBe("http://localhost:8080/apis/registry/v3/system/compatibility/MY%20TYPE/differences/A%2FB");
    });

    it("fetches each explanation once per session, also for two requests at the same time", async () => {
        httpGet.mockResolvedValue(EXPLANATION);
        const service = useCompatibilityService();

        await Promise.all([
            service.getDifferenceExplanation("JSON", "STRING_TYPE_MAX_LENGTH_DECREASED"),
            service.getDifferenceExplanation("JSON", "STRING_TYPE_MAX_LENGTH_DECREASED")
        ]);
        await service.getDifferenceExplanation("JSON", "STRING_TYPE_MAX_LENGTH_DECREASED");
        await service.getDifferenceExplanation("AVRO", "STRING_TYPE_MAX_LENGTH_DECREASED");

        expect(httpGet).toHaveBeenCalledTimes(2);
    });

    it("gives undefined for a code without an explanation, and does not ask again", async () => {
        httpGet.mockRejectedValue({ status: 404 });
        const service = useCompatibilityService();

        expect(await service.getDifferenceExplanation("JSON", "UNKNOWN")).toBeUndefined();
        expect(await service.getDifferenceExplanation("JSON", "UNKNOWN")).toBeUndefined();
        expect(httpGet).toHaveBeenCalledTimes(1);
    });

    it("passes on any other failure, and asks again next time", async () => {
        httpGet.mockRejectedValueOnce({ status: 500 }).mockResolvedValueOnce(EXPLANATION);
        const service = useCompatibilityService();

        await expect(service.getDifferenceExplanation("JSON", "STRING_TYPE_MAX_LENGTH_DECREASED")).rejects.toEqual({ status: 500 });
        expect(await service.getDifferenceExplanation("JSON", "STRING_TYPE_MAX_LENGTH_DECREASED")).toEqual(EXPLANATION);
        expect(httpGet).toHaveBeenCalledTimes(2);
    });
});
