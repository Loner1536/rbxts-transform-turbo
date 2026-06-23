import type ts from "typescript";

export function hasOptimizeDirective(sourceFile: ts.SourceFile): boolean {
    return /^--!optimize\b/m.test(sourceFile.text) || /^\/\/!optimize\b/m.test(sourceFile.text);
}

export function hasStrictDirective(sourceFile: ts.SourceFile): boolean {
    return /^--!strict\b/m.test(sourceFile.text) || /^\/\/!strict\b/m.test(sourceFile.text);
}

export function chainKey(ts: typeof import("typescript"), node: ts.Expression): string | undefined {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) {
        const left = chainKey(ts, node.expression);
        if (left === undefined) return undefined;
        return `${left}.${node.name.text}`;
    }
    return undefined;
}

export function walk(ts: typeof import("typescript"), node: ts.Node, visitor: (n: ts.Node) => void): void {
    if (!node) return;
    visitor(node);
    ts.forEachChild(node, child => { if (child) walk(ts, child, visitor); });
}

export function isAssignmentTarget(ts: typeof import("typescript"), node: ts.Node): boolean {
    const parent = node.parent;
    if (!parent) return false;
    if (ts.isBinaryExpression(parent)) {
        return parent.left === node &&
            parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
    }
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) return true;
    return false;
}

