import type ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import type { Debugger } from "../debug";

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
    optimize: boolean;
    optimizeLevel: 0 | 1 | 2;
    strict: boolean;
};

const sidecar = new Map<string, FileSidecar>();

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

    // roblox-ts renames index.ts/index.client.ts/index.server.ts to
    // init.luau/init.client.luau/init.server.luau respectively, so that the
    // containing directory itself becomes the ModuleScript with the file's
    // siblings as its children (Rojo convention for "script with children").
    // Every other filename is emitted as-is, just with its .ts/.tsx swapped
    // for .luau — this rename only applies to the literal basename "index".
    const dir = path.dirname(rel);
    const base = path.basename(rel).replace(/\.tsx?$/, "");
    const renamedBase = base.replace(/^index(?=$|\.)/, "init");

    return path.join(outDir, dir, `${renamedBase}.luau`);
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
    optimize: boolean,
    optimizeLevel: 0 | 1 | 2,
    strict: boolean,
): void {
    const entry = sidecar.get(outPath) ?? {
        fns: new Map<string, FnAnnotation>(),
        consts: new Set<string>(),
        optimize,
        optimizeLevel,
        strict,
    };
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

function organizePreamble(src: string): string {
    const lines = src.split("\n");
    let i = 0;

    const shebang: string[] = [];
    const compiledLines: string[] = [];
    const otherHeader: string[] = [];
    const services: string[] = [];
    const runtime: string[] = [];
    const imports: string[] = [];
    const bindings: string[] = [];

    // Classify every line at the top of the file until we hit real code
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === "") { i++; continue; }

        if (/^--!/.test(line)) {
            shebang.push(line); i++;
        } else if (/^-- Compiled/.test(line)) {
            compiledLines.push(line); i++;
        } else if (/^--/.test(line)) {
            // Skip existing section labels — we'll regenerate them
            i++;
        } else if (/^local \w+ = game:GetService\(/.test(line)) {
            services.push(line); i++;
        } else if (/^local \w+ = require\(/.test(line)) {
            runtime.push(line); i++;
        } else if (/^local \w+ = TS\.import\(/.test(line)) {
            imports.push(line); i++;
        } else if (/^TS\.import\(/.test(line)) {
            // Side-effect import with no assignment
            imports.push(line); i++;
        } else if (/^local \w+ = \w+[\.\[]/.test(line) && !/^local function/.test(line)) {
            bindings.push(line); i++;
        } else {
            // Real code — stop classifying
            break;
        }
    }

    shebang.sort(byLengthDesc);
    services.sort(byLengthDesc);
    imports.sort(byLengthDesc);
    bindings.sort(byLengthDesc);

    // Order: --! directives, -- Compiled, other headers, then sections
    const out: string[] = [...shebang];
    if (compiledLines.length > 0) out.push("", ...compiledLines);
    if (otherHeader.length > 0) out.push("", ...otherHeader);
    if (services.length > 0) out.push("", "-- Services", ...services);
    if (runtime.length > 0) out.push("", "-- Runtime", ...runtime);
    if (imports.length > 0) out.push("", "-- Imports", ...imports);
    if (bindings.length > 0) out.push("", "-- Bindings", ...bindings);
    if (i < lines.length) out.push("", ...lines.slice(i));

    return out.join("\n");
}

function hoistGetService(src: string): string {
    const re = /game:GetService\("([^"]+)"\)/g;
    const counts = new Map<string, number>();
    for (const m of src.matchAll(re)) {
        counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }

    const toHoist = [...counts.entries()].filter(([, n]) => n >= 2).map(([svc]) => svc);
    if (toHoist.length === 0) return src;

    const decls = toHoist
        .map(svc => `local _${svc} = game:GetService("${svc}")`)
        .join("\n");

    for (const svc of toHoist) {
        src = src.split(`game:GetService("${svc}")`).join(`_${svc}`);
    }

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
            if (/^local function /.test(trimmed)) {
                out.push("");
            } else if (
                /^return\b/.test(trimmed) &&
                !/\b(then|do|repeat)$/.test(prevTrimmed) &&
                !/function\s*\([^)]*\)$/.test(prevTrimmed) &&
                !/^local function /.test(prevTrimmed)
            ) {
                out.push("");
            } else if (/^(do\b|while |for |if |repeat\b)/.test(trimmed) && /^(local |const )/.test(prevTrimmed)) {
                out.push("");
            } else if (/^local /.test(trimmed) && /^const /.test(prevTrimmed)) {
                out.push("");
            }
        }

        out.push(line);

        if (trimmed === "end") {
            const next = lines[i + 1]?.trim() ?? "";
            if (next !== "" && !/^(end\b|else\b|elseif\b|until\b)/.test(next)) {
                out.push("");
            }
        }
    }

    return out.join("\n");
}

const writingFiles = new Set<string>();

function promoteConstIfUnmutated(src: string, name: string): string {
    const lines = src.split("\n");
    const escaped = escapeRegex(name);
    const declRe = new RegExp(`^(\\t*)local (${escaped}) =`);
    const reassignRe = new RegExp(
        `^\\t*${escaped}\\s*(?:\\+|-|\\*|/{1,2}|%|\\^|\\.\\.)?=(?!=)`,
    );

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(declRe);
        if (!m) continue;

        const declIndent = m[1].length;
        let mutated = false;

        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            const trimmed = line.replace(/^\t*/, "");
            if (trimmed === "") continue;
            const indent = line.length - trimmed.length;
            if (indent < declIndent) break;
            if (reassignRe.test(line)) { mutated = true; break; }
        }

        if (!mutated) {
            lines[i] = lines[i].replace(declRe, `$1const $2 =`);
        }
    }

    return lines.join("\n");
}

function injectAnnotations(luauPath: string, entry: FileSidecar, dbg: Debugger): void {
    if (writingFiles.has(luauPath)) return;
    if (!fs.existsSync(luauPath)) {
        // Expected for sidecar entries whose source compiled to nothing
        // (pure type-only files, etc.) — not every entry has emitted output.
        dbg.warn("annotate", `no emitted file at ${luauPath}, skipping`);
        return;
    }

    let src = fs.readFileSync(luauPath, "utf8");
    let changed = false;

    // Inject --! directives at the very top if missing.
    // nativePass no longer does this — we handle it here so the ordering
    // is always correct regardless of where roblox-ts emits other content.
    if (entry.strict && !src.includes("--!strict")) {
        src = "--!strict\n" + src;
        changed = true;
    }
    if (entry.optimize && !src.includes("--!optimize")) {
        src = `--!optimize ${entry.optimizeLevel}\n` + src;
        changed = true;
    }

    for (const [fnName, ann] of entry.fns) {
        if (ann.params.every(p => p === null) && ann.ret === null) continue;

        const re = new RegExp(
            `(local function ${escapeRegex(fnName)}\\()([^)]*)(\\.\\.\\.)?(\\))(?:\\s*:\\s*[^\\r\\n]+)?`,
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

    for (const name of entry.consts) {
        const next = promoteConstIfUnmutated(src, name);
        if (next !== src) { src = next; changed = true; }
    }

    const hoisted = hoistGetService(src);
    if (hoisted !== src) { src = hoisted; changed = true; }

    const organized = organizePreamble(src);
    if (organized !== src) { src = organized; changed = true; }

    const spaced = addSpacing(src);
    if (spaced !== src) { src = spaced; changed = true; }

    if (changed) {
        writingFiles.add(luauPath);
        try {
            fs.writeFileSync(luauPath, src, "utf8");
        } finally {
            // Release quickly — this is just to avoid reacting to our own
            // write if anything else happens to be watching this path too.
            setTimeout(() => {
                writingFiles.delete(luauPath);
            }, 50).unref();
        }
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * roblox-ts hasn't written the .luau file to disk yet at the point our
 * transformer runs on the .ts source — emit happens after the *entire*
 * compilation's transform pipeline finishes, not shortly after each file's
 * transformer call returns. There is no reliable per-file signal for "this
 * specific .luau now exists and is final": not a directory watcher (raced
 * against a shared quiet-period timer and could starve later files — see
 * git history) and not polling either (caused every file's wait-loop to
 * keep the process alive with ref'd timers, hanging the whole build, while
 * still frequently losing the race against emit timing).
 *
 * Instead we register everything we know into `sidecar` as each source file
 * is transformed (cheap, synchronous, no I/O), and run a single formatting
 * pass over every entry once, after the whole compilation's emit step has
 * actually finished — see flushPending below.
 */
function flushPending(dbg: Debugger): void {
    for (const [luauPath, entry] of sidecar) {
        try {
            injectAnnotations(luauPath, entry, dbg);
        } catch (err) {
            dbg.warn("annotate", `failed to format ${luauPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    sidecar.clear();
}

let finalizeRegistered = false;

function registerFinalizer(dbg: Debugger): void {
    if (finalizeRegistered) return;
    finalizeRegistered = true;

    // Covers one-shot builds (`rbxtsc` with no -w): this is the only
    // finalization point, and it's guaranteed to run after the compiler's
    // synchronous emit-to-disk work is done, since Node can't reach the
    // exit phase until that work has completed.
    process.on("exit", () => flushPending(dbg));
}

/**
 * Covers watch mode (`rbxtsc -w`): the transformer's outer factory function
 * is re-invoked once per incremental compilation. By the time a *new*
 * compilation starts, the *previous* one has already finished writing its
 * output to disk — so flushing here, before processing the new batch of
 * source files, formats everything from the prior run that the process-exit
 * hook hasn't had a chance to run yet.
 */
export function flushPendingFromPreviousRun(dbg: Debugger): void {
    flushPending(dbg);
}

export function annotatePass(
    ts: typeof import("typescript"),
    program: ts.Program,
    sourceFile: ts.SourceFile,
    optimize: boolean,
    optimizeLevel: 0 | 1 | 2,
    strict: boolean,
    dbg: Debugger,
): void {
    const outPath = outPathForSource(sourceFile, program);
    if (!outPath) return;
    collectAnnotations(ts, program.getTypeChecker(), sourceFile, outPath, optimize, optimizeLevel, strict);
    registerFinalizer(dbg);
}
