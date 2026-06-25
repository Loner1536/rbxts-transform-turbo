import type ts from "typescript";

// --!strict and --!optimize directives are now injected by annotatePass
// directly into the emitted .luau files, where ordering can be controlled
// correctly. This pass is intentionally a no-op.
export function nativePass(
    _ts: typeof import("typescript"),
    _ctx: ts.TransformationContext,
    sourceFile: ts.SourceFile,
    _optimize: boolean,
    _strict: boolean,
): ts.SourceFile {
    return sourceFile;
}
