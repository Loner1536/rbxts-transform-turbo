import type ts from "typescript";
import { hasOptimizeDirective, hasStrictDirective } from "../util";

export function nativePass(
    ts: typeof import("typescript"),
    ctx: ts.TransformationContext,
    sourceFile: ts.SourceFile,
    optimize: boolean,
    strict: boolean,
): ts.SourceFile {
    const factory = ctx.factory;
    const prepend: ts.Statement[] = [];

    if (strict && !hasStrictDirective(sourceFile)) {
        prepend.push(ts.addSyntheticLeadingComment(
            factory.createNotEmittedStatement(sourceFile),
            ts.SyntaxKind.SingleLineCommentTrivia,
            "!strict",
            true,
        ));
    }

    if (optimize && !hasOptimizeDirective(sourceFile)) {
        prepend.push(ts.addSyntheticLeadingComment(
            factory.createNotEmittedStatement(sourceFile),
            ts.SyntaxKind.SingleLineCommentTrivia,
            "!optimize 2",
            true,
        ));
    }

    if (prepend.length === 0) return sourceFile;
    return factory.updateSourceFile(sourceFile, [...prepend, ...Array.from(sourceFile.statements)]);
}
