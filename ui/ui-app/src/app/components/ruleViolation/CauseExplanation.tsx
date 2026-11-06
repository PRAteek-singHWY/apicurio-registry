import { FunctionComponent, useEffect, useState } from "react";
import { ExpandableSection, Label, Spinner } from "@patternfly/react-core";
import { DiffView } from "@app/components/common/DiffView.tsx";
import { CompatibilityExample, DifferenceExplanation } from "@services/useCompatibilityService.ts";
import { newLoaderGuard } from "@utils/loader.utils.ts";
import { markdownToSafeHtml } from "@utils/markdown.utils.ts";

/**
 * Properties
 */
export type CauseExplanationProps = {
    code: string;
    /** Loads the explanation of a kind of difference, or undefined when there is none. */
    loadExplanation: (code: string) => Promise<DifferenceExplanation | undefined>;
};

const DIRECTIONS: Record<string, string> = {
    BACKWARD: "backward",
    FORWARD: "forward",
    BOTH: "backward and forward"
};

const exampleTitle = (example: CompatibilityExample): string => {
    const direction: string | undefined = example.direction === undefined ? undefined :
        DIRECTIONS[example.direction] ?? example.direction.toLowerCase();
    const verdict: string = example.compatible ? "Compatible" : "Incompatible";
    return direction === undefined ? verdict : `${verdict} (${direction})`;
};

/**
 * The explanation of one cause's kind of difference, loaded the first time it is expanded. When the
 * server has no explanation for the code, nothing is shown.
 */
export const CauseExplanation: FunctionComponent<CauseExplanationProps> = (props: CauseExplanationProps) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [explanation, setExplanation] = useState<DifferenceExplanation>();
    const [isMissing, setIsMissing] = useState(false);
    const [loadError, setLoadError] = useState<string>();

    useEffect(() => {
        if (!isExpanded || explanation !== undefined || isMissing) {
            return;
        }
        const guard = newLoaderGuard();
        setLoadError(undefined);
        props.loadExplanation(props.code)
            .then(guard.wrap((loaded: DifferenceExplanation | undefined) => {
                if (loaded === undefined) {
                    setIsMissing(true);
                } else {
                    setExplanation(loaded);
                }
            }))
            .catch(guard.wrap(() => setLoadError("The explanation could not be loaded.")));
        return () => guard.cancel();
    }, [isExpanded, props.code]);

    if (isMissing) {
        return null;
    }

    const isLoading: boolean = isExpanded && explanation === undefined && loadError === undefined;

    return (
        <ExpandableSection
            className="compatibility-report-explanation"
            data-testid="compatibility-report-explanation"
            toggleText={isExpanded ? "Hide explanation" : "Explain"}
            isExpanded={isExpanded}
            onToggle={(_event, expanded: boolean) => setIsExpanded(expanded)}
            isIndented={true}
        >
            {isLoading && <Spinner size="md" aria-label="Loading the explanation" />}
            {loadError !== undefined && <p className="compatibility-report-explanation-error">{loadError}</p>}
            {explanation?.help !== undefined && (
                <div className="compatibility-report-explanation-help" data-testid="compatibility-report-explanation-help"
                    dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(explanation.help) }} />
            )}
            {(explanation?.examples ?? []).map((example, idx) => (
                <div key={idx} className="compatibility-report-example" data-testid="compatibility-report-example">
                    <Label isCompact={true} color={example.compatible ? "green" : "red"}>{exampleTitle(example)}</Label>
                    <div className="compatibility-report-example-diff">
                        <DiffView original={example.original} originalLabel="Original"
                            modified={example.updated} modifiedLabel="Updated" />
                    </div>
                </div>
            ))}
        </ExpandableSection>
    );
};
