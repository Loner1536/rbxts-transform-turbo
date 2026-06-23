import type ts from "typescript";
import * as fs from "fs";
import * as path from "path";

const LUAU_TYPE: Record<string, string> = {
    number: "number",
    string: "string",
    boolean: "boolean",
    Vector3: "Vector3",
    Vector2: "Vector2",
    Vector2int16: "Vector2int16",
    Vector3int16: "Vector3int16",
    CFrame: "CFrame",
    UDim: "UDim",
    UDim2: "UDim2",
    Color3: "Color3",
    BrickColor: "BrickColor",
    TweenInfo: "TweenInfo",
    NumberRange: "NumberRange",
    NumberSequence: "NumberSequence",
    ColorSequence: "ColorSequence",
    Rect: "Rect",
    Region3: "Region3",
    Ray: "Ray",
    buffer: "buffer",
    Instance: "Instance",
    BasePart: "BasePart",
    Part: "Part",
    Model: "Model",
    Player: "Player",
    Camera: "Camera",
    Workspace: "Workspace",
    RunService: "RunService",
    Players: "Players",
};

type FnAnnotation = {
    params: Array<string | null>;
    ret: string | null;
};

type FileSidecar = {
    fns: Map<string, FnAnnotation>;
    consts: Set<string>;
};

const sidecar = new Map<string, FileSidecar>();
let hooked = false;

function mapTypeNode(ts: typeof import("typescript"), typeNode: ts.TypeNode): string | null {
    if (ts.isTypeReferenceNode(typeNode)) {
        const name = ts.isIdentifier(typeNode.typeName) ? typeNode.typeName.text : null;
        if (!name) return null;
        if (LUAU_TYPE[name]) return LUAU_TYPE[name];
        if ((name === "Array" || name === "ReadonlyArray") && typeNode.typeArguments?.length === 1) {
            const inner = mapTypeNode(ts, typeNode.typeArguments[0]);
            return inner ? `{${inner}}` : "{any}";
        }
        return null;
    }
    if (ts.isArrayTypeNode(typeNode)) {
        const inner = mapTypeNode(ts, typeNode.elementType);
        return inner ? `{${inner}}` : "{any}";
    }
    const kw: Partial<Record<number, string>> = {
        [ts.SyntaxKind.NumberKeyword]: "number",
        [ts.SyntaxKind.StringKeyword]: "string",
        [ts.SyntaxKind.BooleanKeyword]: "boolean",
    };
    if (typeNode.kind in kw) return kw[typeNode.kind]!;
    return null;
}

function luauTypeForParam(
    ts: typeof import("typescript"),
    checker: ts.TypeChecker,
    node: ts.ParameterDeclaration,
): string | null {
    if (node.type) {
        const mapped = mapTypeNode(ts, node.type);
        if (mapped) return mapped;
    }
    const name = checker.typeToString(checker.getTypeAtLocation(node));
    return LUAU_TYPE[name] ?? null;
}

function luauTypeForReturn(
    ts: typeof import("typescript"),
    checker: ts.TypeChecker,
    node: ts.FunctionDeclaration,
): string | null {
    if (node.type) {
        const mapped = mapTypeNode(ts, node.type);
        if (mapped) return mapped;
    }
    const sig = checker.getSignatureFromDeclaration(node);
    if (!sig) return null;
    const ret = checker.getReturnTypeOfSignature(sig);
    const name = checker.typeToString(ret);
    return LUAU_TYPE[name] ?? null;
}

function outPathForSource(sourceFile: ts.SourceFile, program: ts.Program): string | null {
    const options = program.getCompilerOptions();
    const outDir = options.outDir;
    if (!outDir) return null;
    const rootDir = options.rootDir ?? commonRoot(program.getRootFileNames());
    if (!rootDir) return null;
    const rel = path.relative(rootDir, sourceFile.fileName);
    if (rel.startsWith("..")) return null;
    return path.join(outDir, rel.replace(/\.tsx?$/, ".luau"));
}

function commonRoot(files: readonly string[]): string | undefined {
    if (files.length === 0) return undefined;
    const parts = files[0].split(path.sep);
    let root = parts.slice(0, parts.length - 1);
    for (const f of files.slice(1)) {
        const fp = f.split(path.sep);
        let i = 0;
        while (i < root.length && i < fp.length - 1 && root[i] === fp[i]) i++;
        root = root.slice(0, i);
    }
    return root.join(path.sep) || undefined;
}

function collectAnnotations(
    ts: typeof import("typescript"),
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
    outPath: string,
): void {
    const entry = sidecar.get(outPath) ?? { fns: new Map<string, FnAnnotation>(), consts: new Set<string>() };
    sidecar.set(outPath, entry);

    function visit(node: ts.Node): void {
        if (ts.isFunctionDeclaration(node) && node.name) {
            const params = node.parameters.map(p => luauTypeForParam(ts, checker, p));
            const ret = luauTypeForReturn(ts, checker, node);
            if (params.some(p => p !== null) || ret !== null) {
                entry.fns.set(node.name.text, { params, ret });
            }
        }
        if (ts.isVariableStatement(node)) {
            const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
            if (isConst) {
                for (const decl of node.declarationList.declarations) {
                    if (ts.isIdentifier(decl.name)) {
                        entry.consts.add(decl.name.text);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
}

function byLengthDesc(a: string, b: string): number {
    return b.length - a.length;
}

type ImportGroup = { label: string; lines: string[] };

function organizePreamble(src: string): string {
    const lines = src.split("\n");
    let i = 0;

    // Collect --! directives separately from other leading comments
    const shebang: string[] = [];
    const header: string[] = [];
    while (i < lines.length && lines[i].startsWith("--")) {
        if (lines[i].startsWith("--!")) {
            shebang.push(lines[i++]);
        } else {
            header.push(lines[i++]);
        }
    }
    shebang.sort(byLengthDesc);

    const services: string[] = [];
    const runtime: string[] = [];
    const importGroups: ImportGroup[] = [];
    const bindings: string[] = [];

    let pendingLabel: string | null = null;
    let currentImports: string[] = [];

    function flushImports(): void {
        if (currentImports.length > 0) {
            importGroups.push({ label: pendingLabel ?? "-- Imports", lines: [...currentImports] });
            currentImports = [];
        }
        pendingLabel = null;
    }

    while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === "") {
            // Blank line = end of current import group
            flushImports();
            i++;
            continue;
        }

        if (/^--!/.test(line)) {
            // Rotor can emit --!native after preamble locals — hoist it up
            shebang.push(line); shebang.sort(byLengthDesc); i++;
        } else if (/^--/.test(line)) {
            // User comment becomes the label for the next import group
            flushImports();
            pendingLabel = line; i++;
        } else if (/^local \w+ = game:GetService\(/.test(line)) {
            flushImports();
            services.push(line); i++;
        } else if (/^local \w+ = require\(/.test(line)) {
            flushImports();
            runtime.push(line); i++;
        } else if (/^local \w+ = TS\.import\(/.test(line)) {
            currentImports.push(line); i++;
        } else if (/^local \w+ = \w+[\.\[]/.test(line) && !/^local function/.test(line)) {
            flushImports();
            bindings.push(line); i++;
        } else {
            break;
        }
    }
    flushImports();

    services.sort(byLengthDesc);
    bindings.sort(byLengthDesc);

    const out: string[] = [...shebang];
    if (header.length > 0) out.push("", ...header);
    if (runtime.length > 0) out.push("", "-- Runtime", ...runtime);
    if (services.length > 0) out.push("", "-- Services", ...services);
    for (const group of importGroups) {
        group.lines.sort(byLengthDesc);
        out.push("", group.label, ...group.lines);
    }
    if (bindings.length > 0) out.push("", "-- Bindings", ...bindings);
    if (i < lines.length) out.push("", ...lines.slice(i));

    return out.join("\n");
}

function hoistGetService(src: string): string {
    // Count occurrences of each game:GetService("X") call
    const re = /game:GetService\("([^"]+)"\)/g;
    const counts = new Map<string, number>();
    for (const m of src.matchAll(re)) {
        counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }

    const toHoist = [...counts.entries()].filter(([, n]) => n >= 2).map(([svc]) => svc);
    if (toHoist.length === 0) return src;

    // Build locals and replace
    const decls = toHoist
        .map(svc => `local _${svc} = game:GetService("${svc}")`)
        .join("\n");

    for (const svc of toHoist) {
        src = src.split(`game:GetService("${svc}")`).join(`_${svc}`);
    }

    // Insert after any leading --! directives and the rotor header comment
    const insertAt = src.search(/^(?!--[!\s]|--\s*Compiled)/m);
    if (insertAt === -1) return decls + "\n" + src;
    return src.slice(0, insertAt) + decls + "\n" + src.slice(insertAt);
}

function addSpacing(src: string): string {
    const lines = src.split("\n");
    const out: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const prevOut = out.length > 0 ? out[out.length - 1] : "";
        const prevTrimmed = prevOut.trim();
        const alreadyBlank = prevTrimmed === "";

        if (!alreadyBlank) {
            // Blank before top-level local function
            if (/^local function /.test(trimmed)) {
                out.push("");
            }
            // Blank before return when it's not the first statement in its block
            else if (
                /^return\b/.test(trimmed) &&
                !/\b(then|do|repeat)$/.test(prevTrimmed) &&
                !/function\s*\([^)]*\)$/.test(prevTrimmed) &&
                !/^local function /.test(prevTrimmed)
            ) {
                out.push("");
            }
            // Blank before a block starter (do/while/for/if/repeat) when prev is local/const
            else if (/^(do\b|while |for |if |repeat\b)/.test(trimmed) && /^(local |const )/.test(prevTrimmed)) {
                out.push("");
            }
            // Blank on const → local transition
            else if (/^local /.test(trimmed) && /^const /.test(prevTrimmed)) {
                out.push("");
            }
        }

        out.push(line);

        // Blank after `end` when next non-blank line is not end/else/elseif/until
        if (trimmed === "end") {
            const next = lines[i + 1]?.trim() ?? "";
            if (next !== "" && !/^(end\b|else\b|elseif\b|until\b)/.test(next)) {
                out.push("");
            }
        }
    }

    return out.join("\n");
}

function injectAnnotations(luauPath: string, entry: FileSidecar): void {
    if (!fs.existsSync(luauPath)) return;
    let src = fs.readFileSync(luauPath, "utf8");
    let changed = false;

    // Inject param + return type annotations
    for (const [fnName, ann] of entry.fns) {
        if (ann.params.every(p => p === null) && ann.ret === null) continue;

        const re = new RegExp(
            `(local function ${escapeRegex(fnName)}\\()([^)]*)(\\.\\.\\.)?(\\))`,
        );
        src = src.replace(re, (_m, open: string, rawParams: string, vararg: string | undefined, close: string) => {
            const names = rawParams.split(",").map((s: string) => s.trim()).filter(Boolean);
            const annotated = names.map((name: string, i: number) => {
                const bare = name.split(":")[0].trim();
                const typ = ann.params[i];
                return typ ? `${bare}: ${typ}` : bare;
            });
            if (vararg) annotated.push("...");
            const retSuffix = ann.ret ? `: ${ann.ret}` : "";
            changed = true;
            return `${open}${annotated.join(", ")}${close}${retSuffix}`;
        });
    }

    // Replace local → const for TypeScript const declarations
    for (const name of entry.consts) {
        const re = new RegExp(`^(\\t*)local (${escapeRegex(name)}) =`, "m");
        const next = src.replace(re, `$1const $2 =`);
        if (next !== src) { src = next; changed = true; }
    }

    // Hoist any repeated game:GetService() calls injected by the compiler
    const hoisted = hoistGetService(src);
    if (hoisted !== src) { src = hoisted; changed = true; }

    // Organize preamble into labeled sections
    const organized = organizePreamble(src);
    if (organized !== src) { src = organized; changed = true; }

    // Add blank lines between top-level blocks for readability
    const spaced = addSpacing(src);
    if (spaced !== src) { src = spaced; changed = true; }

    if (changed) fs.writeFileSync(luauPath, src, "utf8");
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function installWatcher(outDir: string): void {
    if (hooked) return;
    hooked = true;
    const seen = new Set<string>();
    const watcher = fs.watch(outDir, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.endsWith(".luau")) return;
        const full = path.join(outDir, filename);
        if (seen.has(full)) return;
        const entry = sidecar.get(full);
        if (!entry) return;
        seen.add(full);
        try { injectAnnotations(full, entry); } catch { /* ignore */ }
    });
    watcher.unref();
}

export function annotatePass(
    ts: typeof import("typescript"),
    program: ts.Program,
    sourceFile: ts.SourceFile,
): void {
    const outPath = outPathForSource(sourceFile, program);
    if (!outPath) return;
    collectAnnotations(ts, program.getTypeChecker(), sourceFile, outPath);
    installWatcher(program.getCompilerOptions().outDir!);
}
