import { ConfigService, useConfigService } from "@services/useConfigService.ts";
import { AuthService, useAuth } from "@apitomy/common-ui-components";
import { createAuthOptions, createEndpoint, httpGet, isErrorStatus } from "@utils/rest.utils.ts";

// The explanation endpoint (#10471) is not in the generated SDK yet, so its response is typed here.
// Once it is, these can be replaced by the SDK's models.

/** A worked example of a kind of difference: a pair of schemas and whether the change is compatible. */
export type CompatibilityExample = {
    original: string;
    updated: string;
    direction?: string;
    compatible: boolean;
};

/** What a kind of compatibility difference means, with optional Markdown help and examples. */
export type DifferenceExplanation = {
    code: string;
    description: string;
    help?: string;
    examples?: CompatibilityExample[];
};

// Explanations are fixed per release, so each is fetched once per session. The promise is cached, so
// two causes with the same code share one request.
const explanations: Map<string, Promise<DifferenceExplanation | undefined>> = new Map();

const getDifferenceExplanation = (config: ConfigService, auth: AuthService, artifactType: string,
    code: string): Promise<DifferenceExplanation | undefined> => {
    const key: string = `${artifactType}/${code}`;
    const cached: Promise<DifferenceExplanation | undefined> | undefined = explanations.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const endpoint: string = createEndpoint(config.artifactsUrl(),
        "/system/compatibility/:artifactType/differences/:code", { artifactType, code });
    const explanation: Promise<DifferenceExplanation | undefined> = createAuthOptions(auth)
        .then(options => httpGet<DifferenceExplanation>(endpoint, {
            ...options,
            headers: { ...options.headers, "Accept": "application/json" }
        }))
        .catch(error => {
            // No explanation for this code or artifact type: that answer is kept too.
            if (isErrorStatus(error, 404)) {
                return undefined;
            }
            // Any other failure is not kept, so a later request can try again.
            explanations.delete(key);
            return Promise.reject(error);
        });
    explanations.set(key, explanation);
    return explanation;
};

/** Forgets the fetched explanations. For tests. */
export const clearDifferenceExplanations = (): void => {
    explanations.clear();
};

export interface CompatibilityService {
    /** The explanation of a kind of difference, or undefined when the server has none for it. */
    getDifferenceExplanation(artifactType: string, code: string): Promise<DifferenceExplanation | undefined>;
}

export const useCompatibilityService: () => CompatibilityService = (): CompatibilityService => {
    const config: ConfigService = useConfigService();
    const auth: AuthService = useAuth();

    return {
        getDifferenceExplanation(artifactType: string, code: string): Promise<DifferenceExplanation | undefined> {
            return getDifferenceExplanation(config, auth, artifactType, code);
        }
    };
};
